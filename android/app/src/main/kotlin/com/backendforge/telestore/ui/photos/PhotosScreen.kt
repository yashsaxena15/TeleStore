package com.backendforge.telestore.ui.photos

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PauseCircleOutline
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.automirrored.outlined.PlaylistAdd
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.MobileOff
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.Collections
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.automirrored.outlined.ViewQuilt
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PhotoAlbum
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.backendforge.telestore.core.PhotoHeadings
import com.backendforge.telestore.core.PhotoStacks
import com.backendforge.telestore.core.PhotoTiles
import com.backendforge.telestore.core.PhotosLayout
import com.backendforge.telestore.core.TileBlock
import com.backendforge.telestore.core.Timeline
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.PhotoSource
import com.backendforge.telestore.ui.components.AnimatedShow
import com.backendforge.telestore.ui.components.FileThumbnail
import com.backendforge.telestore.ui.components.SelectionMotion
import com.backendforge.telestore.ui.components.rememberHaptics
import com.backendforge.telestore.ui.home.AppLogo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import kotlin.math.roundToInt

/** A row of the timeline: a month title, a day heading, or a row of photo tiles. */
private sealed interface Cell {
    val key: String
    data class Month(val title: String, val dayIndex: Int) : Cell { override val key get() = "month-$dayIndex" }
    /** Carries its own day: looking it up by position in the (changing) list of days crashed on refresh. */
    data class Header(val dayIndex: Int, val day: PhotoDay) : Cell { override val key get() = "day-$dayIndex-${day.label}" }
    data class Tiles(val block: TileBlock<Tile>, val dayIndex: Int, val date: LocalDate?, override val key: String) : Cell
}

/** One tile: a photo, or a stack of similar ones shown by its first. */
private data class Tile(val entry: PhotoEntry, val stack: List<PhotoEntry>)

/** The ring's colour when backup is fine. */
private val BackedUpGreen = Color(0xFF34A853)

/** White words over photos keep a soft shadow so they read on bright pictures too. */
private val OverPhoto = Shadow(Color(0x99000000), blurRadius = 10f)

/**
 * Photos, laid out like Google Photos: the backup pill and the +, bell and account buttons float
 * over the timeline; memories as tall cards; each day with its places, a select tick and a menu;
 * month titles; edge-to-edge photos; and a round handle on the right to fly through the dates.
 */
@kotlin.OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun PhotosScreen(
    vm: PhotosViewModel,
    container: AppContainer,
    onOpenFile: (FileItem, List<FileItem>) -> Boolean,
    /** The photo viewer, with the timeline's photos (phone and backed-up) and where to start. */
    onOpenPhotos: (List<PhotoSource>, Int) -> Unit,
    onAlbums: () -> Unit,
    onBackup: () -> Unit,
    onNotifications: () -> Unit,
    /** Opens a folder (a new album) in Photos. */
    onOpenFolder: (String) -> Unit,
    /** The Files tab ("Import from Files"). */
    onOpenFiles: () -> Unit,
    /** The "Photos view" page (layout, stacks, other apps). */
    onPhotosView: () -> Unit,
) = PhotosTheme {
    val state by vm.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()
    val context = LocalContext.current
    val density = LocalDensity.current
    val backupSettings by container.backup.settings.collectAsStateWithLifecycle()
    val backup by container.backup.status.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val api = container.api()
    val grid = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var accountSheet by remember { mutableStateOf(false) }
    var createSheet by remember { mutableStateOf(false) }
    var newAlbum by remember { mutableStateOf(false) }
    var panelOpen by rememberSaveable { mutableStateOf(false) }
    var accessCardClosed by rememberSaveable { mutableStateOf(false) }
    var headerPx by remember { mutableIntStateOf(0) }
    val headerHeight = with(density) { headerPx.toDp() }
    val askAccess = rememberPhotoAccessRequest { vm.scanPhone() }
    val opener = com.backendforge.telestore.ui.components.rememberOpenElsewhere(container)
    val deleteFromPhone = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            vm.clearSelection()
            vm.scanPhone()
        }
    }
    var allAlbums by remember { mutableStateOf(false) }
    var newAlbumForSelection by remember { mutableStateOf(false) }
    var sheetPx by remember { mutableIntStateOf(0) }
    val sheetHeight = with(density) { sheetPx.toDp() }
    val pickToUpload = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> vm.uploadFromPhone(uris) }
    val ring = BackupSummary.ring(backupSettings.enabled, backup.running, backup.message)
    val initial = session?.username?.firstOrNull()?.uppercase() ?: "?"

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

    val view by container.settings.photosView.collectAsStateWithLifecycle()
    val monthView = view.layout == PhotosLayout.MONTH
    val cells = remember(state.days, view.layout, view.stackSimilar) {
        fun tiles(entries: List<PhotoEntry>) =
            if (view.stackSimilar) PhotoStacks.group(entries, { it.takenAtMillis }, { it.video }).map { Tile(it.first(), it) }
            else entries.map { Tile(it, listOf(it)) }
        buildList {
            if (monthView) {
                // Month: one title per month and small rows of 5, no day headings
                var start = 0
                while (start < state.days.size) {
                    val first = state.days[start].date
                    var end = start + 1
                    while (end < state.days.size && sameMonth(state.days[end].date, first)) end++
                    add(Cell.Month(PhotoHeadings.monthLabel(first), start))
                    PhotoTiles.grid(tiles(state.days.subList(start, end).flatMap { it.entries }), 5).forEachIndexed { n, block ->
                        add(Cell.Tiles(block, start, first, "rows-$start-$n"))
                    }
                    start = end
                }
            } else {
                var previous: LocalDate? = null
                state.days.forEachIndexed { d, day ->
                    PhotoHeadings.monthTitle(previous, day.date)?.let { add(Cell.Month(it, d)) }
                    add(Cell.Header(d, day))
                    val dayTiles = tiles(day.entries)
                    val blocks = if (view.layout == PhotosLayout.COMFORTABLE) PhotoTiles.comfortable(dayTiles) else PhotoTiles.grid(dayTiles, 3)
                    blocks.forEachIndexed { n, block -> add(Cell.Tiles(block, d, day.date, "rows-$d-$n")) }
                    if (day.date != null) previous = day.date
                }
            }
        }
    }
    // Which day each row belongs to (for the date shown while scrolling)
    val dayOfKey = remember(cells) { cells.associate { it.key to it.dayIndex() } }
    val nearEnd by remember { derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > grid.layoutInfo.totalItemsCount - 15 } }
    LaunchedEffect(nearEnd, state.items.size) { if (nearEnd) vm.loadMore() }
    val scrolled by remember { derivedStateOf { grid.firstVisibleItemIndex > 0 || grid.firstVisibleItemScrollOffset > 0 } }

    // The scroll handle and the floating date show while scrolling, and fade a moment after
    var scrubbing by remember { mutableStateOf(false) }
    var recentlyScrolled by remember { mutableStateOf(false) }
    LaunchedEffect(grid.isScrollInProgress, scrubbing) {
        if (grid.isScrollInProgress || scrubbing) {
            recentlyScrolled = true
        } else {
            delay(1500)
            recentlyScrolled = false
        }
    }

    // What the selection holds: server actions apply to photos in TeleStore, "Back up" to the rest
    val picked = remember(state.selected, state.entries) { state.entries.filter { it.id in state.selected } }
    val inTeleStore = picked.count { it.server != null }
    val notBackedUp = picked.count { it.phoneOnly && !it.backedUp }
    val protectedCount = picked.count { it.server?.isProtected == true }
    val freeableSelected = picked.count { it.backedUp && it.local != null }
    // The albums for "Add to album" load as a selection starts
    LaunchedEffect(state.selecting) { if (state.selecting) vm.loadAlbums() }

    // Photos and videos open in the same viewer, swiping through the whole timeline as in Google Photos
    fun open(entry: PhotoEntry) {
        val all = state.entries
        val index = all.indexOfFirst { it.id == entry.id }.coerceAtLeast(0)
        val placeOf = state.places
        onOpenPhotos(all.map { e -> e.toSource(placeOf) }, index)
    }

    fun backUpNow() {
        if (backupSettings.enabled) BackupWorker.runNow(context, backupSettings) else onBackup()
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        val ptr = rememberPullToRefreshState()
        val refreshing = state.loading && state.page == 0
        PullToRefreshBox(
            isRefreshing = refreshing, onRefresh = { haptics.confirm(); vm.refresh() }, state = ptr, modifier = Modifier.fillMaxSize(),
            indicator = {
                PullToRefreshDefaults.Indicator(state = ptr, isRefreshing = refreshing, modifier = Modifier.align(Alignment.TopCenter).padding(top = headerHeight))
            },
        ) {
            // (The merged list follows the two lists a moment later: checking them too avoids a flash of "No photos")
            if (state.entries.isEmpty() && state.items.isEmpty() && state.local.isEmpty() && !state.loading) {
                when {
                    state.error != null -> EmptyPhotos(
                        headerHeight, Icons.Filled.CloudOff, "Couldn't load your photos", state.error ?: "", isError = true,
                        action = "Retry", onAction = { vm.refresh() },
                    )
                    !state.canReadPhone -> EmptyPhotos(
                        headerHeight, Icons.Filled.PhotoLibrary, "Show photos on this phone",
                        "Allow TeleStore to see your photos and videos to show them here, next to the ones you've backed up.",
                        action = "Allow", onAction = askAccess,
                    )
                    else -> EmptyPhotos(
                        headerHeight, Icons.Filled.PhotoLibrary, "No photos yet",
                        if (backupSettings.enabled) "Photos you take, and the ones you back up, appear here." else "Photos you take appear here. Turn on backup to keep them safe in TeleStore.",
                        action = if (backupSettings.enabled) null else "Turn on backup", onAction = onBackup,
                    )
                }
            } else {
                BoxWithConstraints(Modifier.fillMaxSize()) {
                    LazyColumn(
                        state = grid,
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                        contentPadding = PaddingValues(top = headerHeight, bottom = if (state.selecting) sheetHeight + 8.dp else 24.dp),
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
                            item(key = "phone-access") {
                                Notice(
                                    icon = Icons.Filled.PhotoLibrary,
                                    title = "Show photos on this phone",
                                    text = "See everything on this phone here, next to what you've backed up.",
                                    action = "Allow", onAction = askAccess, onClose = { accessCardClosed = true },
                                )
                            }
                        }
                        state.error?.let { error ->
                            item(key = "server-error") {
                                Notice(
                                    icon = Icons.Filled.CloudOff, title = "Couldn't load your backed-up photos", text = error,
                                    action = "Retry", onAction = { vm.loadMore() }, onClose = null, isError = true,
                                )
                            }
                        }
                        if (state.memories.isNotEmpty()) {
                            item(key = "memories") { Memories(state.memories, api, onOpenFile) }
                        }
                        cells.forEach { cell ->
                            when (cell) {
                                is Cell.Month -> item(key = cell.key) { MonthTitle(cell.title, big = !monthView) }
                                is Cell.Header -> item(key = cell.key) {
                                    val day = cell.day
                                    LaunchedEffect(day.date, day.entries.size) { vm.loadPlaces(day) }
                                    DayHeader(
                                        label = day.label,
                                        places = day.date?.let { state.places[it] }.orEmpty(),
                                        allSelected = day.entries.all { it.id in state.selected },
                                        canDownload = day.entries.any { it.server != null },
                                        onSelectDay = { haptics.tick(); vm.toggleDay(day) },
                                        onDownloadDay = { vm.downloadDay(day) },
                                    )
                                }
                                is Cell.Tiles -> item(key = cell.key) {
                                    TileRow(cell.block) { tile, modifier ->
                                        PhotoCell(
                                            tile = tile,
                                            modifier = modifier,
                                            api = api,
                                            backupOn = backupSettings.enabled,
                                            selecting = state.selecting,
                                            selected = tile.stack.all { it.id in state.selected },
                                            onClick = { if (state.selecting) vm.toggleStack(tile.stack) else open(tile.entry) },
                                            onLongClick = { vm.toggleStack(tile.stack) },
                                        )
                                    }
                                }
                            }
                        }
                        if (state.loading) item {
                            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) }
                        }
                    }

                    // The day being scrolled through, floating at the top left (as in Google Photos)
                    val topKey = grid.layoutInfo.visibleItemsInfo.firstOrNull { it.offset >= with(density) { headerHeight.roundToPx() } - it.size / 2 }?.key
                    val floatingDay = (topKey as? String)?.let { dayOfKey[it] }?.let { state.days.getOrNull(it) }
                    // Not while the day's own heading (or its month) is the top row: it says the same
                    val topIsPhoto = (topKey as? String)?.startsWith("rows-") == true
                    AnimatedVisibility(
                        visible = recentlyScrolled && scrolled && floatingDay != null && topIsPhoto,
                        enter = fadeIn(), exit = fadeOut(),
                        modifier = Modifier.padding(top = headerHeight + 4.dp, start = 16.dp),
                    ) {
                        floatingDay?.let { day ->
                            Column {
                                Text(
                                    if (monthView) PhotoHeadings.monthLabel(day.date) else day.label,
                                    color = Color.White, style = MaterialTheme.typography.titleLarge.copy(shadow = OverPhoto, fontSize = 20.sp),
                                )
                                if (!monthView) day.date?.let { state.places[it] }?.takeIf { it.isNotEmpty() }?.let {
                                    Text(it, color = Color.White.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyLarge.copy(shadow = OverPhoto), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }

                    if (grid.layoutInfo.totalItemsCount > 25) {
                        AnimatedVisibility(visible = recentlyScrolled || scrubbing, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopEnd)) {
                            DateScrubber(
                                top = headerHeight,
                                height = maxHeight,
                                fraction = if (grid.layoutInfo.totalItemsCount > 0) grid.firstVisibleItemIndex.toFloat() / grid.layoutInfo.totalItemsCount else 0f,
                                label = { f ->
                                    val i = (f * cells.size).toInt().coerceIn(0, (cells.size - 1).coerceAtLeast(0))
                                    Timeline.month(cells.getOrNull(i)?.let { state.days.getOrNull(it.dayIndex())?.date })
                                },
                                onScrub = { f -> scope.launch { grid.scrollToItem((f * grid.layoutInfo.totalItemsCount).toInt().coerceAtLeast(0)) } },
                                onDragging = { scrubbing = it },
                            )
                        }
                    }
                }
            }
        }

        // The bar floats over the photos: solid at the top, fading into them once scrolled
        val barBackground = when {
            panelOpen && !state.selecting -> Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh)
            scrolled -> Modifier.background(Brush.verticalGradient(listOf(MaterialTheme.colorScheme.background.copy(alpha = 0.92f), MaterialTheme.colorScheme.background.copy(alpha = 0.55f), Color.Transparent)))
            else -> Modifier.background(MaterialTheme.colorScheme.background)
        }
        Column(Modifier.fillMaxWidth().then(barBackground).onSizeChanged { headerPx = it.height }) {
            if (state.selecting) {
                // "✕ 253" in a pill, nothing else: the actions are in the sheet at the bottom
                Row(Modifier.statusBarsPadding().fillMaxWidth().height(64.dp).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(onClick = vm::clearSelection, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                        Row(Modifier.padding(start = 12.dp, end = 22.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Close, contentDescription = "Cancel selection", modifier = Modifier.size(26.dp))
                            Text("${state.selected.size}", style = MaterialTheme.typography.titleLarge.copy(fontSize = 22.sp), modifier = Modifier.padding(start = 16.dp))
                        }
                    }
                }
            } else {
                Column(Modifier.statusBarsPadding().animateContentSize()) {
                    TopBar(
                        ring = ring, panelOpen = panelOpen, initial = initial,
                        onPanel = { panelOpen = !panelOpen },
                        onCollections = onAlbums,
                        onCreate = { createSheet = true },
                        onNotifications = onNotifications,
                        onAccount = { accountSheet = true },
                    )
                    if (panelOpen) {
                        BackupPanel(
                            ring = ring,
                            pending = backup.pending,
                            line = BackupSummary.line(backupSettings.enabled, backup.running, backup.done, backup.pending, backup.lastRun, backup.message, System.currentTimeMillis()),
                            remaining = if (backup.running) PhotoHeadings.remaining(backup.done, backup.pending, backup.startedAt, System.currentTimeMillis()) else null,
                            onBackUpNow = ::backUpNow,
                            onSettings = { panelOpen = false; onBackup() },
                        )
                    }
                }
            }
        }
        AnimatedVisibility(
            visible = state.selecting,
            enter = androidx.compose.animation.slideInVertically { it } + fadeIn(),
            exit = androidx.compose.animation.slideOutVertically { it } + fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            SelectionSheet(
                albums = state.albums,
                api = api,
                inTeleStore = inTeleStore,
                notBackedUp = notBackedUp,
                protectedCount = protectedCount,
                canFree = freeableSelected > 0 && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R,
                onShare = {
                    val (phone, server) = vm.selectionToShare()
                    val mime = when {
                        picked.all { !it.video } -> "image/*"
                        picked.all { it.video } -> "video/*"
                        else -> "*/*"
                    }
                    opener.shareMany(phone, server, mime)
                },
                onAddTo = { album -> vm.addSelectedToAlbum(album.path, album.name) },
                onNewAlbum = { newAlbumForSelection = true },
                onViewAllAlbums = { allAlbums = true },
                onStar = vm::starSelected,
                onDownload = vm::downloadSelected,
                onTrash = vm::trashSelected,
                onBackUp = {
                    if (!vm.backUpSelected()) {
                        Toast.makeText(context, "Backup is off. Turn it on to back up these photos.", Toast.LENGTH_LONG).show()
                        onBackup()
                    }
                },
                onDeleteFromDevice = {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        // Android asks "delete these?" itself
                        val request = android.provider.MediaStore.createDeleteRequest(context.contentResolver, vm.selectionFreeable())
                        deleteFromPhone.launch(androidx.activity.result.IntentSenderRequest.Builder(request.intentSender).build())
                    }
                },
                onNeedsBackup = { Toast.makeText(context, "Back these up first: they're only on this phone.", Toast.LENGTH_SHORT).show() },
                modifier = Modifier.onSizeChanged { sheetPx = it.height },
            )
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = if (state.selecting) sheetHeight + 8.dp else 16.dp))
    }

    if (allAlbums) {
        AllAlbumsSheet(
            albums = state.albums,
            onPick = { album -> allAlbums = false; vm.addSelectedToAlbum(album.path, album.name) },
            onNewAlbum = { allAlbums = false; newAlbumForSelection = true },
            onDismiss = { allAlbums = false },
        )
    }
    if (newAlbumForSelection) {
        NewAlbumDialog(
            onCreate = { name ->
                newAlbumForSelection = false
                vm.newAlbum(name) { path -> vm.addSelectedToAlbum(path, name.trim()) }
            },
            onDismiss = { newAlbumForSelection = false },
        )
    }

    if (accountSheet) {
        AccountSheet(
            initial = initial,
            username = session?.username.orEmpty(),
            ring = ring,
            line = BackupSummary.line(backupSettings.enabled, backup.running, backup.done, backup.pending, backup.lastRun, backup.message, System.currentTimeMillis()),
            backupOn = backupSettings.enabled,
            running = backup.running,
            freeable = state.freeable,
            onBackUpNow = { accountSheet = false; BackupWorker.runNow(context, backupSettings) },
            onAlbums = { accountSheet = false; onAlbums() },
            onPhotosView = { accountSheet = false; onPhotosView() },
            onSettings = { accountSheet = false; onBackup() },
            onDismiss = { accountSheet = false },
        )
    }
    if (createSheet) {
        CreateSheet(
            backupOn = backupSettings.enabled,
            onNewAlbum = { createSheet = false; newAlbum = true },
            onUpload = { createSheet = false; pickToUpload.launch(arrayOf("image/*", "video/*")) },
            onBackUpNow = { createSheet = false; backUpNow() },
            onImport = { createSheet = false; onOpenFiles() },
            onDismiss = { createSheet = false },
        )
    }
    if (newAlbum) {
        NewAlbumDialog(onCreate = { name -> newAlbum = false; vm.newAlbum(name, onOpenFolder) }, onDismiss = { newAlbum = false })
    }
}

private fun PhotoEntry.toSource(places: Map<LocalDate, String>) = PhotoSource(
    item = server,
    localUri = local?.let { Uri.parse(it.uri) },
    name = name,
    takenAtMillis = takenAtMillis,
    // The owner's own place for the photo first, else the day's places
    place = server?.place ?: takenAtMillis?.let { java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneId.systemDefault()).toLocalDate() }?.let { places[it] },
    video = video,
    backedUp = backedUp,
)

private fun Cell.dayIndex(): Int = when (this) {
    is Cell.Month -> dayIndex
    is Cell.Header -> dayIndex
    is Cell.Tiles -> dayIndex
}

private fun sameMonth(a: LocalDate?, b: LocalDate?): Boolean =
    a == b || (a != null && b != null && a.year == b.year && a.month == b.month)

/** Backup pill (or the logo when all is backed up) on the left; +, bell and account on the right. */
@Composable
private fun TopBar(
    ring: BackupRing,
    panelOpen: Boolean,
    initial: String,
    onPanel: () -> Unit,
    onCollections: () -> Unit,
    onCreate: () -> Unit,
    onNotifications: () -> Unit,
    onAccount: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().height(64.dp).padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        when {
            panelOpen -> Surface(onClick = onPanel, shape = CircleShape, color = MaterialTheme.colorScheme.background, modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Filled.KeyboardArrowUp, contentDescription = "Close backup details") }
            }
            ring == BackupRing.OK -> Row(
                Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onPanel).padding(vertical = 6.dp, horizontal = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AppLogo(26)
                Text("Photos", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 10.dp))
            }
            else -> BackupPill(ring, onPanel)
        }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onCollections) { Icon(Icons.Outlined.Collections, contentDescription = "Collections", modifier = Modifier.size(26.dp)) }
        IconButton(onClick = onCreate) { Icon(Icons.Outlined.Add, contentDescription = "Create", modifier = Modifier.size(28.dp)) }
        IconButton(onClick = onNotifications) { Icon(Icons.Outlined.Notifications, contentDescription = "Notifications", modifier = Modifier.size(26.dp)) }
        Avatar(initial, ring, onAccount)
    }
}

/** "Backing up photos" with a spinner (or paused, problem, off): tap for the details. */
@Composable
private fun BackupPill(ring: BackupRing, onClick: () -> Unit) {
    val label = when (ring) {
        BackupRing.RUNNING -> "Backing up photos"
        BackupRing.WAITING -> "Backup paused"
        BackupRing.PROBLEM -> "Backup problem"
        BackupRing.OFF -> "Backup is off"
        BackupRing.OK -> "Backed up"
    }
    Surface(onClick = onClick, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.padding(start = 12.dp, end = 18.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            when (ring) {
                BackupRing.RUNNING -> CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onSurface)
                BackupRing.WAITING -> Icon(Icons.Filled.PauseCircleOutline, contentDescription = null, modifier = Modifier.size(22.dp))
                BackupRing.PROBLEM -> Icon(Icons.Filled.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(22.dp))
                else -> Icon(Icons.Filled.CloudOff, contentDescription = null, modifier = Modifier.size(22.dp))
            }
            Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp))
        }
    }
}

/** The details under the pill: "Backing up 11 photos", the time left, and a tip or a way to fix it. */
@Composable
private fun BackupPanel(ring: BackupRing, pending: Int, line: String, remaining: String?, onBackUpNow: () -> Unit, onSettings: () -> Unit) {
    val title = when (ring) {
        BackupRing.RUNNING -> PhotoHeadings.backupTitle(pending)
        BackupRing.OK -> "Backup complete"
        BackupRing.WAITING -> "Backup paused"
        BackupRing.PROBLEM -> "Backup stopped"
        BackupRing.OFF -> "Backup is off"
    }
    Column(Modifier.fillMaxWidth()) {
        Text(title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 18.dp))
        Column(Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(24.dp)), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 20.dp, vertical = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                when (ring) {
                    BackupRing.RUNNING -> CircularProgressIndicator(Modifier.size(36.dp), strokeWidth = 3.dp, color = MaterialTheme.colorScheme.primary)
                    BackupRing.OK -> Icon(Icons.Outlined.CloudDone, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp))
                    BackupRing.PROBLEM -> Icon(Icons.Filled.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(36.dp))
                    BackupRing.WAITING -> Icon(Icons.Filled.PauseCircleOutline, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp))
                    BackupRing.OFF -> Icon(Icons.Filled.CloudOff, contentDescription = null, modifier = Modifier.size(36.dp))
                }
                Text(
                    if (ring == BackupRing.RUNNING) remaining ?: "Working out the time left…" else line,
                    style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp),
                    color = if (ring == BackupRing.PROBLEM) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(start = 18.dp),
                )
            }
            val (hint, action) = when (ring) {
                BackupRing.RUNNING -> "Keep the app open for faster backup" to null
                BackupRing.OK -> "Photos you take are backed up to TeleStore" to ("Back up now" to onBackUpNow)
                BackupRing.WAITING -> "It carries on by itself when the phone is ready" to ("Backup settings" to onSettings)
                BackupRing.PROBLEM -> "Check the backup settings, then try again" to ("Backup settings" to onSettings)
                BackupRing.OFF -> "Turn on backup to keep your photos safe in TeleStore" to ("Turn on backup" to onSettings)
            }
            Row(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(start = 20.dp, end = 8.dp, top = 6.dp, bottom = 6.dp).height(52.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(hint, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                action?.let { (label, onAction) -> TextButton(onClick = onAction) { Text(label) } }
            }
        }
        Spacer(Modifier.height(28.dp))
        // The timeline starts in a rounded sheet under the panel
        Box(Modifier.fillMaxWidth().height(28.dp).background(MaterialTheme.colorScheme.background, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)))
    }
}

/** The account's initial, ringed by the backup's state; spinning with an upload arrow while it runs. */
@Composable
private fun Avatar(initial: String, ring: BackupRing, onClick: (() -> Unit)?) {
    val label = when (ring) {
        BackupRing.RUNNING -> "Backing up"
        BackupRing.OK -> "Backed up"
        BackupRing.WAITING -> "Backup paused"
        BackupRing.PROBLEM -> "Backup has a problem"
        BackupRing.OFF -> "Backup is off"
    }
    val base = Modifier.size(48.dp).clip(CircleShape)
    Box(
        (if (onClick != null) base.clickable(onClick = onClick) else base).semantics { contentDescription = "Account and backup: $label" },
        contentAlignment = Alignment.Center,
    ) {
        if (ring == BackupRing.RUNNING) {
            CircularProgressIndicator(Modifier.size(44.dp), strokeWidth = 2.5.dp, color = MaterialTheme.colorScheme.primary)
        } else {
            val color = when (ring) {
                BackupRing.OK -> BackedUpGreen
                BackupRing.WAITING -> MaterialTheme.colorScheme.tertiary
                BackupRing.PROBLEM -> MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.outline
            }
            Box(Modifier.size(44.dp).border(2.5.dp, color, CircleShape))
        }
        Box(Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
            Text(initial, color = MaterialTheme.colorScheme.onSecondaryContainer, fontWeight = FontWeight.Bold)
        }
        if (ring == BackupRing.RUNNING) {
            Box(
                Modifier.align(Alignment.BottomEnd).size(18.dp).background(MaterialTheme.colorScheme.primary, CircleShape)
                    .border(1.5.dp, MaterialTheme.colorScheme.background, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.ArrowUpward, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(12.dp)) }
        }
    }
}

/** Opened from the account circle: how the backup is doing, and the way to Albums and Backup. */
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountSheet(
    initial: String,
    username: String,
    ring: BackupRing,
    line: String,
    backupOn: Boolean,
    running: Boolean,
    freeable: Int,
    onBackUpNow: () -> Unit,
    onAlbums: () -> Unit,
    onPhotosView: () -> Unit,
    onSettings: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surfaceContainer) {
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
            SheetRow(Icons.Outlined.Collections, "Collections", onClick = onAlbums)
            SheetRow(Icons.AutoMirrored.Outlined.ViewQuilt, "Photos view", onClick = onPhotosView)
            SheetRow(Icons.Filled.Settings, if (backupOn) "Backup settings" else "Turn on backup", onClick = onSettings)
            // Backup settings has the "Remove from this phone" button
            if (freeable > 0) SheetRow(Icons.Filled.PhoneAndroid, "Free up space · $freeable on this phone are backed up", onClick = onSettings)
        }
    }
}

/** The + button's menu. */
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateSheet(backupOn: Boolean, onNewAlbum: () -> Unit, onUpload: () -> Unit, onBackUpNow: () -> Unit, onImport: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Text("Create", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, bottom = 8.dp))
            SheetRow(Icons.Outlined.PhotoAlbum, "New album", onClick = onNewAlbum)
            SheetRow(Icons.Outlined.Upload, "Upload from phone", onClick = onUpload)
            SheetRow(Icons.Outlined.CloudUpload, if (backupOn) "Back up now" else "Turn on backup", onClick = onBackUpNow)
            SheetRow(Icons.Outlined.Folder, "Import from Files", onClick = onImport)
        }
    }
}

@Composable
private fun NewAlbumDialog(onCreate: (String) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New album") },
        text = { OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true, label = { Text("Album name") }) },
        confirmButton = { TextButton(onClick = { onCreate(name) }, enabled = name.isNotBlank()) { Text("Create") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurface)
            Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(start = 16.dp))
        }
    }
}

/**
 * The sheet at the bottom while photos are selected: a row of actions (Share, Add to album,
 * Favourite, Download, Trash, Back up, Delete from device), then "Add to album" with the albums.
 */
@Composable
private fun SelectionSheet(
    albums: List<AlbumChoice>,
    api: com.backendforge.telestore.core.TeleStoreApi,
    inTeleStore: Int,
    notBackedUp: Int,
    /** Selected photos protected from deletion: Trash then looks off (tapping it says why). */
    protectedCount: Int,
    canFree: Boolean,
    onShare: () -> Unit,
    onAddTo: (AlbumChoice) -> Unit,
    onNewAlbum: () -> Unit,
    onViewAllAlbums: () -> Unit,
    onStar: () -> Unit,
    onDownload: () -> Unit,
    onTrash: () -> Unit,
    onBackUp: () -> Unit,
    onDeleteFromDevice: () -> Unit,
    /** Tapped an action that needs the photos in TeleStore while none of them is. */
    onNeedsBackup: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val inCloud = inTeleStore > 0
    Surface(
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(bottom = 12.dp)) {
            Box(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.width(32.dp).height(4.dp).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f), CircleShape))
            }
            LazyRow(contentPadding = PaddingValues(horizontal = 8.dp)) {
                item { SheetAction(Icons.Outlined.Share, "Share", onClick = onShare) }
                item { SheetAction(Icons.AutoMirrored.Outlined.PlaylistAdd, "Add to album", dimmed = !inCloud) { if (inCloud) onViewAllAlbums() else onNeedsBackup() } }
                item { SheetAction(Icons.Outlined.StarOutline, "Favourite", dimmed = !inCloud) { if (inCloud) onStar() else onNeedsBackup() } }
                item { SheetAction(Icons.Outlined.Download, "Download", dimmed = !inCloud) { if (inCloud) onDownload() else onNeedsBackup() } }
                item { SheetAction(Icons.Outlined.Delete, "Trash", dimmed = !inCloud || protectedCount > 0) { if (inCloud) onTrash() else onNeedsBackup() } }
                if (notBackedUp > 0) item { SheetAction(Icons.Outlined.CloudUpload, "Back up", onClick = onBackUp) }
                if (canFree) item { SheetAction(Icons.Outlined.MobileOff, "Delete from device", onClick = onDeleteFromDevice) }
            }
            HorizontalDivider(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Add to album", style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp), modifier = Modifier.weight(1f))
                TextButton(onClick = { if (inCloud) onViewAllAlbums() else onNeedsBackup() }) { Text("View all", style = MaterialTheme.typography.titleMedium) }
            }
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                item { AlbumCard(name = "New album", cover = null, api = api, icon = Icons.Outlined.Add) { if (inCloud) onNewAlbum() else onNeedsBackup() } }
                items(albums, key = { it.path }) { album ->
                    AlbumCard(name = album.name, cover = album.cover, api = api, icon = Icons.Outlined.PhotoAlbum) { if (inCloud) onAddTo(album) else onNeedsBackup() }
                }
            }
        }
    }
}

/** An action in the selection sheet: an icon over its name. */
@Composable
private fun SheetAction(icon: ImageVector, label: String, dimmed: Boolean = false, onClick: () -> Unit) {
    Column(
        Modifier.width(92.dp).clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(vertical = 10.dp).alpha(if (dimmed) 0.45f else 1f),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(26.dp))
        Text(
            label, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, maxLines = 2,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

/** An album in "Add to album": its newest photo (or an icon) with the name under it. */
@Composable
private fun AlbumCard(name: String, cover: FileItem?, api: com.backendforge.telestore.core.TeleStoreApi, icon: ImageVector, onClick: () -> Unit) {
    Column(Modifier.width(112.dp).clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick)) {
        Box(
            Modifier.size(112.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center,
        ) {
            if (cover != null) FileThumbnail(item = cover, api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 16.dp, iconSize = 28.dp)
            else Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
        }
        Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp, start = 2.dp))
    }
}

/** "View all": every album, to add the selection to one (or a new one). */
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AllAlbumsSheet(albums: List<AlbumChoice>, onPick: (AlbumChoice) -> Unit, onNewAlbum: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surfaceContainer) {
        LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item { Text("Add to album", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, bottom = 8.dp)) }
            item { SheetRow(Icons.Outlined.Add, "New album", onClick = onNewAlbum) }
            items(albums, key = { it.path }) { album -> SheetRow(Icons.Outlined.PhotoAlbum, album.name) { onPick(album) } }
        }
    }
}

/** A card at the top of the timeline: phone access to allow, or a server list that failed. */
@Composable
private fun Notice(icon: ImageVector, title: String, text: String, action: String, onAction: () -> Unit, onClose: (() -> Unit)?, isError: Boolean = false) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
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

/** Tall rounded cards with the memory's name at the bottom ("1 year ago", "Recent highlights"). */
@Composable
private fun Memories(memories: List<Memory>, api: com.backendforge.telestore.core.TeleStoreApi, onOpenFile: (FileItem, List<FileItem>) -> Boolean) {
    val width = (LocalConfiguration.current.screenWidthDp * 0.425f).dp
    LazyRow(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items(memories) { memory ->
            Box(
                Modifier.width(width).aspectRatio(0.75f).clip(RoundedCornerShape(20.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable { memory.items.firstOrNull()?.let { onOpenFile(it, memory.items) } },
            ) {
                FileThumbnail(item = memory.items.first(), api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 20.dp, iconSize = 34.dp)
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0x99000000))))
                Text(
                    memory.title, color = Color.White, style = MaterialTheme.typography.titleLarge.copy(shadow = OverPhoto, fontSize = 21.sp, lineHeight = 26.sp),
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.align(Alignment.BottomStart).padding(start = 14.dp, end = 12.dp, bottom = 16.dp),
                )
            }
        }
    }
}

/** "October", "March 2025": big above the first day of each earlier month; smaller in Month view. */
@Composable
private fun MonthTitle(title: String, big: Boolean) {
    Text(
        title,
        style = if (big) MaterialTheme.typography.displaySmall.copy(fontSize = 34.sp) else MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp),
        fontWeight = FontWeight.Normal,
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = if (big) 28.dp else 20.dp, bottom = if (big) 2.dp else 10.dp),
    )
}

/** "Today" with the day's places under it, the tick that selects the whole day, and the day's menu. */
@Composable
private fun DayHeader(label: String, places: String, allSelected: Boolean, canDownload: Boolean, onSelectDay: () -> Unit, onDownloadDay: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 2.dp, top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp), fontWeight = FontWeight.Normal)
            if (places.isNotEmpty()) {
                Text(
                    places, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        IconButton(onClick = onSelectDay) {
            if (allSelected) {
                Box(Modifier.size(26.dp).background(MaterialTheme.colorScheme.primary, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Check, contentDescription = "Unselect this day", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(18.dp))
                }
            } else {
                Icon(Icons.Outlined.CheckCircle, contentDescription = "Select this day", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(28.dp))
            }
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More for this day") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(if (allSelected) "Unselect all" else "Select all") },
                    leadingIcon = { Icon(Icons.Outlined.CheckCircle, contentDescription = null) },
                    onClick = { menu = false; onSelectDay() },
                )
                if (canDownload) DropdownMenuItem(
                    text = { Text("Download all") },
                    leadingIcon = { Icon(Icons.Filled.Download, contentDescription = null) },
                    onClick = { menu = false; onDownloadDay() },
                )
            }
        }
    }
}

/** Lays out one row of tiles: even squares, one wide photo, or a big square beside two small ones. */
@Composable
private fun TileRow(block: TileBlock<Tile>, tile: @Composable (Tile, Modifier) -> Unit) {
    val gap = 2.dp
    when (block) {
        is TileBlock.Row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
            block.items.forEach { tile(it, Modifier.weight(1f).aspectRatio(1f)) }
            repeat(block.columns - block.items.size) { Spacer(Modifier.weight(1f)) }
        }
        is TileBlock.Hero -> tile(block.item, Modifier.fillMaxWidth().aspectRatio(1.5f))
        is TileBlock.Feature -> BoxWithConstraints(Modifier.fillMaxWidth()) {
            val small = (maxWidth - gap * 2) / 3
            val big = small * 2 + gap
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                if (block.bigOnLeft) tile(block.big, Modifier.size(big))
                Column(verticalArrangement = Arrangement.spacedBy(gap)) { block.small.forEach { tile(it, Modifier.size(small)) } }
                if (!block.bigOnLeft) tile(block.big, Modifier.size(big))
            }
        }
    }
}

@kotlin.OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun PhotoCell(
    tile: Tile,
    modifier: Modifier,
    api: com.backendforge.telestore.core.TeleStoreApi,
    backupOn: Boolean,
    selecting: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val entry = tile.entry
    val haptics = rememberHaptics()
    // Selected: the photo shrinks into a rounded tile on a grey square (with a spring), as in Google Photos
    val inset by SelectionMotion.inset(selected, 14.dp)
    val highlight by androidx.compose.animation.animateColorAsState(
        if (selected) MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent, label = "selected tile",
    )
    val local = entry.local
    val server = entry.server
    Box(modifier.background(highlight).combinedClickable(onClick = onClick, onLongClick = { haptics.longPress(); onLongClick() })) {
        Box(Modifier.fillMaxSize().padding(inset).clip(RoundedCornerShape(inset * 1.2f)).background(MaterialTheme.colorScheme.surfaceContainerHigh)) {
            // The phone's copy when there is one: no download, and it works offline
            if (local != null) {
                AsyncImage(model = local.uri, contentDescription = entry.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else if (server != null) {
                FileThumbnail(item = server, api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 0.dp, iconSize = 26.dp)
            }
        }
        if (entry.video) {
            Icon(
                Icons.Outlined.PlayCircle, contentDescription = "Video", tint = Color.White,
                modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).size(24.dp),
            )
        } else if (tile.stack.size > 1) {
            // A stack of similar photos: how many are in it
            Row(
                Modifier.align(Alignment.TopEnd).padding(6.dp).background(Color(0x66000000), RoundedCornerShape(10.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Layers, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
                Text(
                    "${tile.stack.size}", color = Color.White, style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(start = 3.dp).semantics { contentDescription = "${tile.stack.size} similar photos" },
                )
            }
        }
        if (entry.starred && !selecting) {
            Icon(Icons.Filled.Star, contentDescription = "Starred", tint = Color.White, modifier = Modifier.align(Alignment.BottomStart).padding(6.dp).size(18.dp))
        }
        // As in Google Photos, only what still waits for the backup is marked
        if (backupOn && entry.phoneOnly && !entry.backedUp && !selecting) {
            Box(
                Modifier.align(Alignment.BottomEnd).padding(5.dp).size(22.dp).background(Color(0x66000000), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.CloudUpload, contentDescription = "Not backed up yet", tint = Color.White, modifier = Modifier.size(15.dp))
            }
        }
        AnimatedShow(visible = selecting, modifier = Modifier.align(Alignment.TopStart)) {
            androidx.compose.animation.Crossfade(targetState = selected, label = "photo check") { isOn ->
                if (isOn) {
                    Box(
                        Modifier.padding(6.dp).size(26.dp).background(MaterialTheme.colorScheme.primary, CircleShape)
                            .border(2.dp, MaterialTheme.colorScheme.surfaceContainerHighest, CircleShape)
                            .semantics { contentDescription = "Selected" },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Check, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(17.dp)) }
                } else {
                    Icon(
                        Icons.Filled.RadioButtonUnchecked, contentDescription = "Not selected", tint = Color.White,
                        modifier = Modifier.padding(6.dp).size(26.dp),
                    )
                }
            }
        }
    }
}

/**
 * The round handle half off the right edge: drag it to fly through the years, with the month
 * shown beside it. It shows while scrolling.
 */
@Composable
private fun DateScrubber(top: Dp, height: Dp, fraction: Float, label: (Float) -> String, onScrub: (Float) -> Unit, onDragging: (Boolean) -> Unit) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val density = LocalDensity.current
    val trackPx = with(density) { (height - top - 140.dp).toPx() }.coerceAtLeast(1f)
    val shown = dragging ?: fraction.coerceIn(0f, 1f)
    Box(Modifier.width(170.dp).height(height)) {
        Row(
            Modifier
                .align(Alignment.TopEnd)
                .offset { IntOffset(with(density) { 16.dp.roundToPx() }, (shown * trackPx).roundToInt() + with(density) { (top + 24.dp).roundToPx() }) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (dragging != null) {
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.padding(end = 10.dp)) {
                    Text(label(shown), style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
                }
            }
            Box(
                Modifier.size(56.dp)
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = 0.94f), CircleShape)
                    .pointerInput(trackPx) {
                        detectVerticalDragGestures(
                            onDragStart = { dragging = fraction.coerceIn(0f, 1f); onDragging(true) },
                            onDragEnd = { dragging = null; onDragging(false) },
                            onDragCancel = { dragging = null; onDragging(false) },
                        ) { change, dy ->
                            change.consume()
                            val next = ((dragging ?: 0f) + dy / trackPx).coerceIn(0f, 1f)
                            dragging = next
                            onScrub(next)
                        }
                    }
                    .semantics { contentDescription = "Scroll through dates" },
                contentAlignment = Alignment.CenterStart,
            ) {
                Icon(Icons.Filled.UnfoldMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 10.dp).size(24.dp))
            }
        }
    }
}

/**
 * Every empty Photos screen looks the same: an icon, what's going on, and one thing to do about it.
 * It scrolls (a single page) so pull-to-refresh works on it too.
 */
@Composable
private fun EmptyPhotos(top: Dp, icon: ImageVector, title: String, text: String, isError: Boolean = false, action: String? = null, onAction: () -> Unit = {}) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = top)) {
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
