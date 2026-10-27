package com.backendforge.telestore.ui.photos

import com.backendforge.telestore.ui.components.rememberHaptics
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.backup.BackupStatus
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKind
import com.backendforge.telestore.core.Memory
import com.backendforge.telestore.core.Timeline
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.FileThumbnail
import com.backendforge.telestore.ui.components.SelectionMotion
import com.backendforge.telestore.ui.home.AppLogo
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** A row of the timeline grid: a day heading or one photo. */
private sealed interface Cell {
    /** Carries its own day: looking it up by position in the (changing) list of days crashed on refresh. */
    data class Header(val dayIndex: Int, val day: com.backendforge.telestore.core.TimelineDay) : Cell
    data class Photo(val item: FileItem, val dayIndex: Int, val date: java.time.LocalDate?) : Cell
}

@kotlin.OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun PhotosScreen(
    vm: PhotosViewModel,
    container: AppContainer,
    onOpenFile: (FileItem, List<FileItem>) -> Boolean,
    onAlbums: () -> Unit,
    onBackup: () -> Unit,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()
    val backupSettings by container.backup.settings.collectAsStateWithLifecycle()
    val backup by container.backup.status.collectAsStateWithLifecycle()
    val api = container.api()
    val grid = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }

    val cells = remember(state.days) {
        buildList {
            state.days.forEachIndexed { d, day ->
                add(Cell.Header(d, day))
                day.items.forEach { add(Cell.Photo(it, d, day.date)) }
            }
        }
    }
    val nearEnd by remember { derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > grid.layoutInfo.totalItemsCount - 40 } }
    LaunchedEffect(nearEnd, state.items.size) { if (nearEnd) vm.loadMore() }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize()) {
            if (state.selecting) {
                SelectionBar(state.selected.size, vm::clearSelection, vm::downloadSelected, vm::starSelected, vm::trashSelected)
            } else {
                Header(backupSettings.enabled, backup, onBackup)
            }
            PullToRefreshBox(isRefreshing = state.loading && state.page == 0, onRefresh = { haptics.confirm(); vm.refresh() }, modifier = Modifier.fillMaxSize()) {
                if (state.items.isEmpty() && !state.loading) {
                    EmptyPhotos(state.error, backupSettings.enabled, onBackup)
                } else {
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(state.columns),
                            state = grid,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                            contentPadding = PaddingValues(bottom = 96.dp),
                            modifier = Modifier.fillMaxSize().pointerInput(Unit) {
                                // Pinch to show bigger or smaller photos (one step per pinch)
                                awaitEachGesture {
                                    awaitFirstDown(requireUnconsumed = false)
                                    var zoom = 1f
                                    var done = false
                                    do {
                                        val event = awaitPointerEvent()
                                        if (event.changes.count { it.pressed } > 1 && !done) {
                                            zoom *= event.calculateZoom()
                                            if (zoom > 1.3f) { vm.zoom(bigger = true); done = true }
                                            if (zoom < 0.77f) { vm.zoom(bigger = false); done = true }
                                        }
                                    } while (event.changes.any { it.pressed })
                                }
                            },
                        ) {
                            if (state.memories.isNotEmpty() && !state.selecting) {
                                item(span = { GridItemSpan(maxLineSpan) }, key = "memories") { Memories(state.memories, api, onOpenFile) }
                            }
                            cells.forEach { cell ->
                                when (cell) {
                                    is Cell.Header -> item(span = { GridItemSpan(maxLineSpan) }, key = "day-${cell.dayIndex}-${cell.day.label}") {
                                        val day = cell.day
                                        val all = day.items.all { it.id in state.selected }
                                        DayHeader(day.label, state.selecting, all) { vm.toggleDay(day) }
                                    }
                                    is Cell.Photo -> item(key = cell.item.id) {
                                        PhotoCell(
                                            item = cell.item,
                                            api = api,
                                            selecting = state.selecting,
                                            selected = cell.item.id in state.selected,
                                            onClick = { if (state.selecting) vm.toggle(cell.item) else onOpenFile(cell.item, state.items) },
                                            onLongClick = { vm.toggle(cell.item) },
                                        )
                                    }
                                }
                            }
                            if (state.loading) item(span = { GridItemSpan(maxLineSpan) }) {
                                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) }
                            }
                        }
                        DateScrubber(
                            height = maxHeight,
                            fraction = if (grid.layoutInfo.totalItemsCount > 0) grid.firstVisibleItemIndex.toFloat() / grid.layoutInfo.totalItemsCount else 0f,
                            label = { f ->
                                val i = (f * cells.size).toInt().coerceIn(0, (cells.size - 1).coerceAtLeast(0))
                                Timeline.month(when (val c = cells.getOrNull(i)) { is Cell.Header -> c.day.date; is Cell.Photo -> c.date; null -> null })
                            },
                            onScrub = { f -> scope.launch { grid.scrollToItem((f * grid.layoutInfo.totalItemsCount).toInt().coerceAtLeast(0)) } },
                            modifier = Modifier.align(Alignment.TopEnd),
                        )
                    }
                }
            }
        }
        if (!state.selecting) {
            Switcher(onAlbums = onAlbums, onBackup = onBackup, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp))
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 80.dp))
    }
}

@Composable
private fun Header(backupOn: Boolean, status: BackupStatus, onBackup: () -> Unit) {
    Row(Modifier.statusBarsPadding().fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        AppLogo(24)
        Text("Photos", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 10.dp))
        IconButton(onClick = onBackup) {
            when {
                !backupOn -> Icon(Icons.Filled.CloudOff, contentDescription = "Backup is off", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                status.running -> Box(contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 2.dp)
                    Icon(Icons.Filled.CloudUpload, contentDescription = "Backing up, ${status.pending} left", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                }
                status.message != null -> Icon(Icons.Filled.CloudUpload, contentDescription = status.message, tint = MaterialTheme.colorScheme.error)
                else -> Icon(Icons.Filled.Cloud, contentDescription = "Backed up", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun SelectionBar(count: Int, onClose: () -> Unit, onDownload: () -> Unit, onStar: () -> Unit, onTrash: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.statusBarsPadding().fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Cancel selection") }
            Text("$count selected", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = onDownload) { Icon(Icons.Filled.Download, contentDescription = "Download") }
            IconButton(onClick = onStar) { Icon(Icons.Filled.Star, contentDescription = "Star") }
            IconButton(onClick = onTrash) { Icon(Icons.Filled.Delete, contentDescription = "Move to Trash") }
        }
    }
}

@Composable
private fun Memories(memories: List<Memory>, api: com.backendforge.telestore.core.TeleStoreApi, onOpenFile: (FileItem, List<FileItem>) -> Boolean) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items(memories) { memory ->
            Box(
                Modifier.width(110.dp).height(150.dp).clip(RoundedCornerShape(14.dp))
                    .clickable { memory.items.firstOrNull()?.let { onOpenFile(it, memory.items) } },
            ) {
                FileThumbnail(item = memory.items.first(), api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 14.dp, iconSize = 30.dp)
                Box(Modifier.fillMaxSize().background(Color(0x33000000)))
                Text(
                    memory.title, color = Color.White, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
                )
            }
        }
    }
}

@Composable
private fun DayHeader(label: String, selecting: Boolean, allSelected: Boolean, onSelectDay: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        IconButton(onClick = onSelectDay, modifier = Modifier.size(36.dp)) {
            Icon(
                if (allSelected) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked,
                contentDescription = "Select this day",
                tint = if (allSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (selecting) 1f else 0.6f),
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@kotlin.OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun PhotoCell(item: FileItem, api: com.backendforge.telestore.core.TeleStoreApi, selecting: Boolean, selected: Boolean, onClick: () -> Unit, onLongClick: () -> Unit) {
    val haptics = rememberHaptics()
    val inset by SelectionMotion.inset(selected)
    val highlight by SelectionMotion.background(selected)
    Box(Modifier.aspectRatio(1f).background(highlight).combinedClickable(onClick = onClick, onLongClick = { haptics.longPress(); onLongClick() })) {
        // The photo shrinks into a rounded tile when selected, and back out with a spring
        Box(Modifier.fillMaxSize().padding(inset).clip(RoundedCornerShape(inset))) {
            FileThumbnail(item = item, api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 0.dp, iconSize = 26.dp)
        }
        if (item.kind == FileKind.VIDEO) {
            Icon(Icons.Filled.PlayCircle, contentDescription = "Video", tint = Color.White, modifier = Modifier.align(Alignment.TopEnd).padding(5.dp).size(20.dp))
        }
        if (item.starred && !selecting) {
            Icon(Icons.Filled.Star, contentDescription = "Starred", tint = Color.White, modifier = Modifier.align(Alignment.BottomStart).padding(5.dp).size(16.dp))
        }
        androidx.compose.animation.AnimatedVisibility(
            visible = selecting,
            enter = SelectionMotion.markEnter,
            exit = SelectionMotion.markExit,
            modifier = Modifier.align(Alignment.TopStart),
        ) {
            androidx.compose.animation.Crossfade(targetState = selected, label = "photo check") { isOn ->
                Icon(
                    if (isOn) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked,
                    contentDescription = if (isOn) "Selected" else "Not selected",
                    tint = if (isOn) MaterialTheme.colorScheme.primary else Color.White,
                    modifier = Modifier.padding(5.dp).size(22.dp).background(if (isOn) Color.White else Color.Transparent, CircleShape),
                )
            }
        }
    }
}

/** The thumb on the right edge: drag it to fly through the years, with the month shown beside it. */
@Composable
private fun DateScrubber(height: androidx.compose.ui.unit.Dp, fraction: Float, label: (Float) -> String, onScrub: (Float) -> Unit, modifier: Modifier) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val density = LocalDensity.current
    val trackPx = with(density) { (height - 140.dp).toPx() }.coerceAtLeast(1f)
    val shown = dragging ?: fraction.coerceIn(0f, 1f)
    Box(modifier.width(140.dp).height(height)) {
        Box(
            Modifier
                .offset { IntOffset(0, (shown * trackPx).roundToInt() + with(density) { 40.dp.roundToPx() }) }
                .align(Alignment.TopEnd)
                .pointerInput(trackPx) {
                    detectVerticalDragGestures(
                        onDragStart = { dragging = fraction.coerceIn(0f, 1f) },
                        onDragEnd = { dragging = null },
                        onDragCancel = { dragging = null },
                    ) { change, dy ->
                        change.consume()
                        val next = ((dragging ?: 0f) + dy / trackPx).coerceIn(0f, 1f)
                        dragging = next
                        onScrub(next)
                    }
                },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (dragging != null) {
                    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.padding(end = 8.dp)) {
                        Text(label(shown), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
                Box(
                    Modifier.width(26.dp).height(44.dp)
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(topStart = 14.dp, bottomStart = 14.dp))
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(topStart = 14.dp, bottomStart = 14.dp)),
                    contentAlignment = Alignment.Center,
                ) { Text("⇕", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/** The floating "Photos · Albums · Backup" switch at the bottom. */
@Composable
private fun Switcher(onAlbums: () -> Unit, onBackup: () -> Unit, modifier: Modifier) {
    Surface(shape = RoundedCornerShape(26.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest, shadowElevation = 8.dp, modifier = modifier) {
        Row(Modifier.padding(4.dp)) {
            Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                Text("Photos", color = MaterialTheme.colorScheme.onSecondaryContainer, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp))
            }
            Text("Albums", style = MaterialTheme.typography.labelLarge, modifier = Modifier.clip(RoundedCornerShape(22.dp)).clickable(onClick = onAlbums).padding(horizontal = 18.dp, vertical = 10.dp))
            Text("Backup", style = MaterialTheme.typography.labelLarge, modifier = Modifier.clip(RoundedCornerShape(22.dp)).clickable(onClick = onBackup).padding(horizontal = 18.dp, vertical = 10.dp))
        }
    }
}

@Composable
private fun EmptyPhotos(error: String?, backupOn: Boolean, onBackup: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Filled.CloudUpload, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(56.dp))
        Text(
            error ?: if (backupOn) "Your backed-up photos will appear here." else "Back up your phone's photos and videos to see them here.",
            style = MaterialTheme.typography.bodyLarge, color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 12.dp),
        )
        if (!backupOn && error == null) {
            Surface(onClick = onBackup, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.padding(top = 16.dp)) {
                Text("Turn on backup", color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
            }
        }
    }
}
