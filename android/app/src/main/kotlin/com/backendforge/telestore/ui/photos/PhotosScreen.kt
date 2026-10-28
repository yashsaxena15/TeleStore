package com.backendforge.telestore.ui.photos

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.PhotoAlbum
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.backendforge.telestore.backup.BackupWorker
import com.backendforge.telestore.core.BackupRing
import com.backendforge.telestore.core.BackupSummary
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.Memory
import com.backendforge.telestore.core.PhotoDay
import com.backendforge.telestore.core.PhotoEntry
import com.backendforge.telestore.core.Timeline
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.PhotoSource
import com.backendforge.telestore.ui.components.FileThumbnail
import com.backendforge.telestore.ui.components.AnimatedShow
import com.backendforge.telestore.ui.components.SelectionMotion
import com.backendforge.telestore.ui.home.AppLogo
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** A row of the timeline grid: a day heading or one photo. */
private sealed interface Cell {
    /** Carries its own day: looking it up by position in the (changing) list of days crashed on refresh. */
    data class Header(val dayIndex: Int, val day: PhotoDay) : Cell
    data class Photo(val entry: PhotoEntry, val dayIndex: Int, val date: java.time.LocalDate?) : Cell
}

/** The ring's colour when backup is fine. */
private val BackedUpGreen = Color(0xFF34A853)

@kotlin.OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun PhotosScreen(
    vm: PhotosViewModel,
    container: AppContainer,
    onOpenFile: (FileItem, List<FileItem>) -> Boolean,
    /** The photo viewer, with the timeline's photos (phone and backed-up) and where to start. */
    onOpenPhotos: (List<PhotoSource>, Int) -> Unit,
    onAlbums: () -> Unit,
    onBackup: () -> Unit,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()
    val context = LocalContext.current
    val backupSettings by container.backup.settings.collectAsStateWithLifecycle()
    val backup by container.backup.status.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val api = container.api()
    val grid = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var backupSheet by remember { mutableStateOf(false) }
    var accessCardClosed by rememberSaveable { mutableStateOf(false) }
    val askAccess = rememberPhotoAccessRequest { vm.scanPhone() }

    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }

    // Coming back (from the camera, or after allowing access in Settings) shows the phone's new photos
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) vm.scanPhone() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }

    val cells = remember(state.days) {
        buildList {
            state.days.forEachIndexed { d, day ->
                add(Cell.Header(d, day))
                day.entries.forEach { add(Cell.Photo(it, d, day.date)) }
            }
        }
    }
    val nearEnd by remember { derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > grid.layoutInfo.totalItemsCount - 40 } }
    LaunchedEffect(nearEnd, state.items.size) { if (nearEnd) vm.loadMore() }

    // What the selection holds: server actions apply to photos in TeleStore, "Back up" to the rest
    val picked = remember(state.selected, state.entries) { state.entries.filter { it.id in state.selected } }
    val inTeleStore = picked.count { it.server != null }
    val notBackedUp = picked.count { it.phoneOnly && !it.backedUp }
    val protectedCount = picked.count { it.server?.isProtected == true }

    fun open(entry: PhotoEntry) {
        val server = entry.server
        when {
            entry.video && server != null -> onOpenFile(server, state.items)
            // A video only on the phone: the phone's own player
            entry.video -> entry.local?.let { openOnPhone(context, it.uri) }
            else -> {
                val photos = state.entries.filter { !it.video }
                val index = photos.indexOfFirst { it.id == entry.id }.coerceAtLeast(0)
                onOpenPhotos(photos.map { it.toSource() }, index)
            }
        }
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize()) {
            if (state.selecting) {
                SelectionBar(
                    count = state.selected.size, inTeleStore = inTeleStore, notBackedUp = notBackedUp, protectedCount = protectedCount,
                    onClose = vm::clearSelection, onDownload = vm::downloadSelected, onStar = vm::starSelected, onTrash = vm::trashSelected,
                    onBackUp = {
                        if (!vm.backUpSelected()) {
                            Toast.makeText(context, "Backup is off. Turn it on to back up these photos.", Toast.LENGTH_LONG).show()
                            onBackup()
                        }
                    },
                )
            } else {
                Header(
                    initial = session?.username?.firstOrNull()?.uppercase() ?: "?",
                    ring = BackupSummary.ring(backupSettings.enabled, backup.running, backup.message),
                    onClick = { backupSheet = true },
                )
            }
            PullToRefreshBox(isRefreshing = state.loading && state.page == 0, onRefresh = { haptics.confirm(); vm.refresh() }, modifier = Modifier.fillMaxSize()) {
                // (The merged list follows the two lists a moment later: checking them too avoids a flash of "No photos")
                if (state.entries.isEmpty() && state.items.isEmpty() && state.local.isEmpty() && !state.loading) {
                    when {
                        state.error != null -> EmptyPhotos(
                            Icons.Filled.CloudOff, "Couldn't load your photos", state.error ?: "", isError = true,
                            action = "Retry", onAction = { vm.refresh() },
                        )
                        !state.canReadPhone -> EmptyPhotos(
                            Icons.Filled.PhotoLibrary, "Show photos on this phone",
                            "Allow TeleStore to see your photos and videos to show them here, next to the ones you've backed up.",
                            action = "Allow", onAction = askAccess,
                        )
                        else -> EmptyPhotos(
                            Icons.Filled.PhotoLibrary, "No photos yet",
                            if (backupSettings.enabled) "Photos you take, and the ones you back up, appear here." else "Photos you take appear here. Turn on backup to keep them safe in TeleStore.",
                            action = if (backupSettings.enabled) null else "Turn on backup", onAction = onBackup,
                        )
                    }
                } else {
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(state.columns),
                            state = grid,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                            contentPadding = PaddingValues(bottom = 24.dp),
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
                            if (!state.canReadPhone && !accessCardClosed && !state.selecting) {
                                item(span = { GridItemSpan(maxLineSpan) }, key = "phone-access") {
                                    Notice(
                                        icon = Icons.Filled.PhotoLibrary,
                                        title = "Show photos on this phone",
                                        text = "See everything on this phone here, next to what you've backed up.",
                                        action = "Allow", onAction = askAccess, onClose = { accessCardClosed = true },
                                    )
                                }
                            }
                            state.error?.let { error ->
                                item(span = { GridItemSpan(maxLineSpan) }, key = "server-error") {
                                    Notice(
                                        icon = Icons.Filled.CloudOff, title = "Couldn't load your backed-up photos", text = error,
                                        action = "Retry", onAction = { vm.loadMore() }, onClose = null, isError = true,
                                    )
                                }
                            }
                            if (state.memories.isNotEmpty() && !state.selecting) {
                                item(span = { GridItemSpan(maxLineSpan) }, key = "memories") { Memories(state.memories, api, onOpenFile) }
                            }
                            cells.forEach { cell ->
                                when (cell) {
                                    is Cell.Header -> item(span = { GridItemSpan(maxLineSpan) }, key = "day-${cell.dayIndex}-${cell.day.label}") {
                                        val day = cell.day
                                        val all = day.entries.all { it.id in state.selected }
                                        DayHeader(day.label, state.selecting, all) { vm.toggleDay(day) }
                                    }
                                    is Cell.Photo -> item(key = cell.entry.id) {
                                        PhotoCell(
                                            entry = cell.entry,
                                            api = api,
                                            selecting = state.selecting,
                                            selected = cell.entry.id in state.selected,
                                            onClick = { if (state.selecting) vm.toggle(cell.entry) else open(cell.entry) },
                                            onLongClick = { vm.toggle(cell.entry) },
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
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
    }

    if (backupSheet) {
        BackupSheet(
            initial = session?.username?.firstOrNull()?.uppercase() ?: "?",
            username = session?.username.orEmpty(),
            ring = BackupSummary.ring(backupSettings.enabled, backup.running, backup.message),
            line = BackupSummary.line(backupSettings.enabled, backup.running, backup.done, backup.pending, backup.lastRun, backup.message, System.currentTimeMillis()),
            backupOn = backupSettings.enabled,
            running = backup.running,
            freeable = state.freeable,
            onBackUpNow = { backupSheet = false; BackupWorker.runNow(context, backupSettings) },
            onAlbums = { backupSheet = false; onAlbums() },
            onSettings = { backupSheet = false; onBackup() },
            onDismiss = { backupSheet = false },
        )
    }
}

private fun PhotoEntry.toSource() = PhotoSource(item = server, localUri = local?.let { Uri.parse(it.uri) }, name = name)

/** Plays a video that's only on the phone in the phone's own player. */
private fun openOnPhone(context: Context, uri: String) {
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), "video/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
        context.startActivity(intent)
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(context, "No app on this phone can play this video.", Toast.LENGTH_SHORT).show()
    }
}

@Composable
private fun Header(initial: String, ring: BackupRing, onClick: () -> Unit) {
    Row(Modifier.statusBarsPadding().fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        AppLogo(24)
        Text("Photos", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 10.dp))
        Avatar(initial, ring, onClick)
    }
}

/** The account's initial in a circle, ringed by the backup's state: spinning, green, amber, red or grey. */
@Composable
private fun Avatar(initial: String, ring: BackupRing, onClick: (() -> Unit)?) {
    val label = when (ring) {
        BackupRing.RUNNING -> "Backing up"
        BackupRing.OK -> "Backed up"
        BackupRing.WAITING -> "Backup paused"
        BackupRing.PROBLEM -> "Backup has a problem"
        BackupRing.OFF -> "Backup is off"
    }
    val base = Modifier.size(44.dp).clip(CircleShape)
    Box(
        (if (onClick != null) base.clickable(onClick = onClick) else base).semantics { contentDescription = "Account and backup: $label" },
        contentAlignment = Alignment.Center,
    ) {
        if (ring == BackupRing.RUNNING) {
            CircularProgressIndicator(Modifier.size(42.dp), strokeWidth = 2.5.dp)
        } else {
            val color = when (ring) {
                BackupRing.OK -> BackedUpGreen
                BackupRing.WAITING -> MaterialTheme.colorScheme.tertiary
                BackupRing.PROBLEM -> MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.outline
            }
            Box(Modifier.size(42.dp).border(2.5.dp, color, CircleShape))
        }
        Box(Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
            Text(initial, color = MaterialTheme.colorScheme.onSecondaryContainer, fontWeight = FontWeight.Bold)
        }
    }
}

/** Opened from the account circle: how the backup is doing, and the way to Albums and Backup. */
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BackupSheet(
    initial: String,
    username: String,
    ring: BackupRing,
    line: String,
    backupOn: Boolean,
    running: Boolean,
    freeable: Int,
    onBackUpNow: () -> Unit,
    onAlbums: () -> Unit,
    onSettings: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(initial, ring, onClick = null)
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    if (username.isNotEmpty()) Text(username, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        line, style = MaterialTheme.typography.bodyMedium,
                        color = if (ring == BackupRing.PROBLEM) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (backupOn) SheetRow(Icons.Filled.CloudUpload, "Back up now", enabled = !running, onClick = onBackUpNow)
            SheetRow(Icons.Filled.PhotoAlbum, "Albums", onClick = onAlbums)
            SheetRow(Icons.Filled.Settings, if (backupOn) "Backup settings" else "Turn on backup", onClick = onSettings)
            // Backup settings has the "Remove from this phone" button
            if (freeable > 0) SheetRow(Icons.Filled.PhoneAndroid, "Free up space · $freeable on this phone are backed up", onClick = onSettings)
        }
    }
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
            Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 16.dp))
        }
    }
}

@Composable
private fun SelectionBar(
    count: Int,
    inTeleStore: Int,
    notBackedUp: Int,
    /** Selected photos protected from deletion: Trash then looks off (tapping it says why). */
    protectedCount: Int,
    onClose: () -> Unit,
    onDownload: () -> Unit,
    onStar: () -> Unit,
    onTrash: () -> Unit,
    onBackUp: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.statusBarsPadding().fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Cancel selection") }
            Text("$count selected", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            // Photos only on the phone can't be starred or trashed in TeleStore yet: back them up first
            if (notBackedUp > 0) IconButton(onClick = onBackUp) { Icon(Icons.Filled.CloudUpload, contentDescription = "Back up") }
            if (inTeleStore > 0) {
                IconButton(onClick = onDownload) { Icon(Icons.Filled.Download, contentDescription = "Download") }
                IconButton(onClick = onStar) { Icon(Icons.Filled.Star, contentDescription = "Star") }
                IconButton(onClick = onTrash) {
                    Icon(Icons.Filled.Delete, contentDescription = "Move to Trash", modifier = Modifier.alpha(if (protectedCount > 0) 0.38f else 1f))
                }
            }
        }
    }
}

/** A card at the top of the timeline: phone access to allow, or a server list that failed. */
@Composable
private fun Notice(icon: ImageVector, title: String, text: String, action: String, onAction: () -> Unit, onClose: (() -> Unit)?, isError: Boolean = false) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f).padding(start = 14.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface)
                Text(
                    text, style = MaterialTheme.typography.bodySmall,
                    color = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onAction) { Text(action) }
            if (onClose != null) IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Dismiss", modifier = Modifier.size(18.dp)) }
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
private fun PhotoCell(entry: PhotoEntry, api: com.backendforge.telestore.core.TeleStoreApi, selecting: Boolean, selected: Boolean, onClick: () -> Unit, onLongClick: () -> Unit) {
    val haptics = rememberHaptics()
    val inset by SelectionMotion.inset(selected)
    val highlight by SelectionMotion.background(selected)
    val local = entry.local
    val server = entry.server
    Box(Modifier.aspectRatio(1f).background(highlight).combinedClickable(onClick = onClick, onLongClick = { haptics.longPress(); onLongClick() })) {
        // The photo shrinks into a rounded tile when selected, and back out with a spring
        Box(Modifier.fillMaxSize().padding(inset).clip(RoundedCornerShape(inset)).background(MaterialTheme.colorScheme.surfaceContainerHigh)) {
            // The phone's copy when there is one: no download, and it works offline
            if (local != null) {
                AsyncImage(model = local.uri, contentDescription = entry.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else if (server != null) {
                FileThumbnail(item = server, api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 0.dp, iconSize = 26.dp)
            }
        }
        if (entry.video) {
            Icon(Icons.Filled.PlayCircle, contentDescription = "Video", tint = Color.White, modifier = Modifier.align(Alignment.TopEnd).padding(5.dp).size(20.dp))
        }
        if (entry.starred && !selecting) {
            Icon(Icons.Filled.Star, contentDescription = "Starred", tint = Color.White, modifier = Modifier.align(Alignment.BottomStart).padding(5.dp).size(16.dp))
        }
        // In TeleStore: a small cloud; only on the phone: no mark
        if (entry.backedUp) {
            Box(
                Modifier.align(Alignment.BottomEnd).padding(4.dp).size(20.dp).background(Color(0x73000000), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.CloudDone, contentDescription = "Backed up", tint = Color.White, modifier = Modifier.size(14.dp))
            }
        }
        AnimatedShow(visible = selecting, modifier = Modifier.align(Alignment.TopStart)) {
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

/**
 * Every empty Photos screen looks the same: an icon, what's going on, and one thing to do about it.
 * It scrolls (a single page) so pull-to-refresh works on it too.
 */
@Composable
private fun EmptyPhotos(icon: ImageVector, title: String, text: String, isError: Boolean = false, action: String? = null, onAction: () -> Unit = {}) {
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Column(
                Modifier.fillParentMaxSize().padding(32.dp),
                verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(icon, contentDescription = null, tint = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, modifier = Modifier.size(56.dp))
                Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
                Text(
                    text, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                    color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
                if (action != null) {
                    Surface(onClick = onAction, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.padding(top = 16.dp)) {
                        Text(action, color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
                    }
                }
            }
        }
    }
}
