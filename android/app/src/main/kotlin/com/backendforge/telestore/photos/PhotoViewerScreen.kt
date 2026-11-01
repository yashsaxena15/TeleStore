package com.backendforge.telestore.photos

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MobileOff
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PhotoAlbum
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.print.PrintHelper
import coil3.compose.SubcomposeAsyncImage
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FolderPaths
import com.backendforge.telestore.core.PhotoHeadings
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.FileCache
import com.backendforge.telestore.data.PhotoSource
import com.backendforge.telestore.ui.components.pullDownOffset
import com.backendforge.telestore.ui.components.pullDownToClose
import com.backendforge.telestore.ui.components.rememberOpenElsewhere
import com.backendforge.telestore.ui.components.rememberPullDownState
import com.backendforge.telestore.ui.photos.PhotosTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The photo and video viewer, laid out like Google Photos: "Nov 1 ›" with the time and place at
 * the top, star and ⋮; Share, Edit, Add to and Trash at the bottom. Tap to hide them; swipe
 * between photos and videos; pinch or double-tap to zoom; pull down to close; swipe up (or
 * About) for the details. A photo on this phone shows from there; one only in TeleStore from the
 * server.
 */
@Composable
fun PhotoViewerScreen(
    photos: List<PhotoSource>,
    startIndex: Int,
    container: AppContainer,
    onBack: () -> Unit,
    /** A downloaded copy on the phone, shown instead of fetching it again. */
    offlineCopy: (FileItem) -> Uri? = { null },
) = PhotosTheme {
    // Trashed or deleted photos leave the viewer; star and archive changes show straight away
    var list by remember { mutableStateOf(photos) }
    if (list.isEmpty()) {
        LaunchedEffect(Unit) { onBack() }
        return@PhotosTheme
    }
    val api = container.api()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val opener = rememberOpenElsewhere(container)
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, list.lastIndex)) { list.size }
    var zoomed by remember { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    var menu by remember { mutableStateOf(false) }
    var addTo by remember { mutableStateOf<PhotoSource?>(null) }
    var slideshow by remember { mutableStateOf(false) }
    // Swipe up (or About) shows when and where it was taken, the camera and the file
    var details by remember { mutableStateOf<PhotoSource?>(null) }
    val pull = rememberPullDownState(onBack, onPullUp = { if (!zoomed) details = list.getOrNull(pager.currentPage) })
    val current = list[pager.currentPage.coerceIn(0, list.lastIndex)]

    fun changed() = container.photosChanged.tryEmit(Unit)
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    fun replace(old: PhotoSource, new: PhotoSource?) {
        list = if (new == null) list.filter { it != old } else list.map { if (it == old) new else it }
    }
    fun serverAction(source: PhotoSource, action: suspend (FileItem) -> Unit) {
        val item = source.item ?: return toast("Back this up first: it's only on this phone.")
        scope.launch {
            try {
                action(item)
                changed()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast((e as? ApiException)?.message ?: "That didn't work. Try again.")
            }
        }
    }

    // Android asks "move to trash?" or "delete?" itself for photos on this phone
    var pendingRemoval by remember { mutableStateOf<Pair<PhotoSource, Boolean>?>(null) }
    val phoneRequest = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val (source, keepServerCopy) = pendingRemoval ?: return@rememberLauncherForActivityResult
        pendingRemoval = null
        if (result.resultCode == Activity.RESULT_OK) {
            // Deleted from the phone: still in TeleStore it stays, shown from there
            replace(source, if (keepServerCopy && source.item != null) source.copy(localUri = null) else null)
            changed()
        }
    }
    fun askPhone(source: PhotoSource, trash: Boolean) {
        val uri = source.localUri ?: return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return toast("Needs Android 11 or newer.")
        val request = if (trash) MediaStore.createTrashRequest(context.contentResolver, listOf(uri), true)
        else MediaStore.createDeleteRequest(context.contentResolver, listOf(uri))
        pendingRemoval = source to !trash
        phoneRequest.launch(IntentSenderRequest.Builder(request.intentSender).build())
    }

    fun trash(source: PhotoSource) {
        val item = source.item
        when {
            item?.isProtected == true -> toast("This photo is protected from deletion.")
            item != null -> scope.launch {
                try {
                    api.trash(item)
                    replace(source, null)
                    changed()
                    toast("Moved to Trash")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    toast((e as? ApiException)?.message ?: "Couldn't move it to Trash.")
                }
            }
            else -> askPhone(source, trash = true)
        }
    }

    fun share(source: PhotoSource) {
        val mime = FileCache.mimeOf(source.name)
        val local = source.localUri
        if (local != null) opener.shareMany(listOf(local), emptyList(), mime) else source.item?.let(opener::share)
    }

    /** Runs [use] with a content address for the photo (fetching a TeleStore-only one first). */
    fun withUri(source: PhotoSource, use: (Uri, String) -> Unit) {
        val local = source.localUri
        val mime = FileCache.mimeOf(source.name)
        when {
            local != null -> try { use(local, mime) } catch (_: ActivityNotFoundException) { toast("No app on this phone can do that.") }
            source.item != null -> opener.withLocalFile(source.item) { use(it.uri, it.mime) }
        }
    }

    fun edit(source: PhotoSource) = withUri(source) { uri, mime ->
        context.startActivity(
            Intent.createChooser(
                Intent(Intent.ACTION_EDIT).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION),
                "Edit with",
            ),
        )
    }

    // Slideshow: a new photo every 4 seconds until the last one (a tap stops it)
    LaunchedEffect(slideshow, pager.currentPage) {
        if (!slideshow) return@LaunchedEffect
        delay(4_000)
        if (pager.currentPage < list.lastIndex) pager.animateScrollToPage(pager.currentPage + 1) else slideshow = false
    }

    // The black fades as the photo is pulled down, showing it's about to close
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 1f - 0.6f * pull.progress)).pullDownToClose(pull, enabled = !zoomed)) {
        HorizontalPager(
            state = pager, userScrollEnabled = !zoomed, beyondViewportPageCount = 1,
            key = { list[it].item?.id ?: list[it].localUri.toString() },
            modifier = Modifier.fillMaxSize().pullDownOffset(pull),
        ) { page ->
            val source = list[page]
            val onTap = { if (slideshow) slideshow = false else chrome = !chrome }
            if (source.video) {
                VideoPage(
                    url = remember(source) { mediaUrl(source, api, offlineCopy) },
                    api = api,
                    active = page == pager.currentPage,
                    showControls = chrome && !slideshow,
                    onTap = onTap,
                )
            } else {
                ZoomableImage(
                    url = remember(source) { mediaUrl(source, api, offlineCopy) },
                    active = page == pager.currentPage,
                    onZoomChanged = { if (page == pager.currentPage) zoomed = it },
                    onTap = onTap,
                )
            }
        }

        val shown = chrome && !slideshow && pull.offset == 0f
        // Top: back, "Nov 1 ›" over "6:35 PM • place", star and ⋮
        AnimatedVisibility(visible = shown, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter)) {
            Row(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent)))
                    .statusBarsPadding().padding(start = 4.dp, end = 4.dp, top = 8.dp, bottom = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White) }
                Column(
                    Modifier.weight(1f).clickable { details = current }.padding(vertical = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(PhotoHeadings.viewerDay(current.takenAtMillis) ?: current.name, color = Color.White, style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Details", tint = Color.White, modifier = Modifier.size(22.dp))
                    }
                    val line = PhotoHeadings.viewerLine(current.takenAtMillis, current.place)
                    if (line.isNotEmpty()) Text(line, color = Color(0xFFD6D6DC), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val starred = current.item?.starred == true
                IconButton(onClick = {
                    serverAction(current) { item ->
                        val now = api.setStarred(item, !item.starred)
                        replace(current, current.copy(item = item.copy(starred = now)))
                    }
                }) {
                    Icon(if (starred) Icons.Filled.Star else Icons.Outlined.StarOutline, contentDescription = if (starred) "Remove from Favourites" else "Add to Favourites", tint = Color.White)
                }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More", tint = Color.White) }
                    ViewerMenu(
                        expanded = menu,
                        source = current,
                        onDismiss = { menu = false },
                        onAbout = { details = current },
                        onArchive = {
                            serverAction(current) { item ->
                                api.setArchived(item, !item.archived)
                                replace(current, current.copy(item = item.copy(archived = !item.archived)))
                                toast(if (item.archived) "Back in Photos" else "Moved to Archive")
                            }
                        },
                        onUseAs = {
                            withUri(current) { uri, mime ->
                                context.startActivity(
                                    Intent.createChooser(
                                        Intent(Intent.ACTION_ATTACH_DATA).setDataAndType(uri, mime).putExtra("mimeType", mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                                        "Use as",
                                    ),
                                )
                            }
                        },
                        onSlideshow = { slideshow = true },
                        onCast = { cast(context) },
                        onDeleteFromDevice = { askPhone(current, trash = false) },
                        onPrint = { withUri(current) { uri, _ -> print(context, current.name, uri) } },
                    )
                }
            }
        }

        // Bottom: Share, Edit, Add to, Trash
        AnimatedVisibility(visible = shown, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter)) {
            Row(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000))))
                    .navigationBarsPadding().padding(top = 16.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                BarAction(Icons.Outlined.Share, "Share") { share(current) }
                BarAction(Icons.Outlined.Tune, "Edit") { edit(current) }
                BarAction(Icons.Filled.Add, "Add to") { if (current.item != null) addTo = current else toast("Back this up first: it's only on this phone.") }
                BarAction(Icons.Outlined.Delete, "Trash") { trash(current) }
            }
        }
    }

    details?.let { source ->
        PhotoDetailsSheet(
            source = source, api = api, onDismiss = { details = null },
            onChanged = { item ->
                val updated = source.copy(
                    item = item,
                    place = item.place ?: source.place,
                    takenAtMillis = com.backendforge.telestore.core.PhotoMerge.millisOf(item) ?: source.takenAtMillis,
                )
                replace(source, updated)
                details = updated
                changed()
            },
        )
    }
    addTo?.let { source ->
        AddToSheet(
            container = container,
            starred = source.item?.starred == true,
            onFavourite = {
                addTo = null
                serverAction(source) { item ->
                    val now = api.setStarred(item, !item.starred)
                    replace(source, source.copy(item = item.copy(starred = now)))
                }
            },
            onAlbum = { name, path ->
                addTo = null
                serverAction(source) { item ->
                    api.move(item, path)
                    replace(source, source.copy(item = item.copy(path = path)))
                    toast("Added to $name")
                }
            },
            onDismiss = { addTo = null },
        )
    }
}

/** The ⋮ menu (Google Photos' order): About, then Archive, Use as, Slideshow, Cast, Delete from device, Print. */
@Composable
private fun ViewerMenu(
    expanded: Boolean,
    source: PhotoSource,
    onDismiss: () -> Unit,
    onAbout: () -> Unit,
    onArchive: () -> Unit,
    onUseAs: () -> Unit,
    onSlideshow: () -> Unit,
    onCast: () -> Unit,
    onDeleteFromDevice: () -> Unit,
    onPrint: () -> Unit,
) {
    fun pick(action: () -> Unit) = { onDismiss(); action() }
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss, containerColor = Color.Black) {
        MenuRow(Icons.Outlined.Info, "About", pick(onAbout))
        HorizontalDivider(color = Color(0xFF46464F))
        if (source.item != null) {
            if (source.item.archived) MenuRow(Icons.Outlined.Unarchive, "Unarchive", pick(onArchive))
            else MenuRow(Icons.Outlined.Archive, "Archive", pick(onArchive))
        }
        if (!source.video) MenuRow(Icons.AutoMirrored.Outlined.OpenInNew, "Use as", pick(onUseAs))
        MenuRow(Icons.Outlined.Slideshow, "Slideshow", pick(onSlideshow))
        MenuRow(Icons.Outlined.Cast, "Cast", pick(onCast))
        // Only a phone copy that is safe in TeleStore (Trash covers the rest)
        if (source.localUri != null && source.backedUp) MenuRow(Icons.Outlined.MobileOff, "Delete from device", pick(onDeleteFromDevice))
        if (!source.video) MenuRow(Icons.Outlined.Print, "Print", pick(onPrint))
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, color = Color.White, style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp)) },
        leadingIcon = { Icon(icon, contentDescription = null, tint = Color.White) },
        onClick = onClick,
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** An action at the bottom: icon over its name. */
@Composable
private fun BarAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(
        Modifier.width(84.dp).clickable(onClick = onClick).padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp))
        Text(label, color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
    }
}

/** "Add to": Favourites, or one of the albums (folders in the backup folder). */
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddToSheet(container: AppContainer, starred: Boolean, onFavourite: () -> Unit, onAlbum: (String, String) -> Unit, onDismiss: () -> Unit) {
    var albums by remember { mutableStateOf<List<FileItem>?>(null) }
    LaunchedEffect(Unit) {
        albums = try {
            container.api().listFiles(path = container.backup.settings.value.destination, pageSize = 200).files.filter { it.isFolder }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            emptyList()
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surfaceContainer) {
        LazyColumn(Modifier.fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
            item { Text("Add to", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, bottom = 8.dp)) }
            item { SheetLine(if (starred) Icons.Filled.Star else Icons.Outlined.StarOutline, if (starred) "Remove from Favourites" else "Favourites", onFavourite) }
            item { Text("Albums", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 4.dp)) }
            val list = albums
            if (list == null) item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) } }
            else items(list, key = { it.id }) { folder -> SheetLine(Icons.Outlined.PhotoAlbum, folder.name) { onAlbum(folder.name, FolderPaths.childPath(folder)) } }
        }
    }
}

@Composable
private fun SheetLine(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null)
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 20.dp))
    }
}

/** Screen mirroring to a TV or other screen (Android's own cast). */
private fun cast(context: Context) {
    val intents = listOf(Intent("android.settings.CAST_SETTINGS"), Intent(android.provider.Settings.ACTION_DISPLAY_SETTINGS))
    for (intent in intents) {
        try {
            context.startActivity(intent)
            Toast.makeText(context, "Choose a screen to show your photos on", Toast.LENGTH_SHORT).show()
            return
        } catch (_: ActivityNotFoundException) {
        }
    }
    Toast.makeText(context, "This phone can't cast.", Toast.LENGTH_SHORT).show()
}

/** Android's print dialog for the photo. */
private fun print(context: Context, name: String, uri: Uri) {
    try {
        PrintHelper(context).apply { scaleMode = PrintHelper.SCALE_MODE_FIT }.printBitmap(name, uri)
    } catch (_: Exception) {
        Toast.makeText(context, "Couldn't print this photo.", Toast.LENGTH_SHORT).show()
    }
}

/** The phone's copy first, then a downloaded one, then the server. */
private fun mediaUrl(source: PhotoSource, api: TeleStoreApi, offlineCopy: (FileItem) -> Uri?): String =
    source.localUri?.toString()
        ?: source.item?.let { offlineCopy(it)?.toString() ?: api.media.file(it).toString() }
        ?: ""

/** "0:38", "12:05", "1:02:03". */
private fun clock(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

/**
 * A video in the viewer: it plays while it's the page shown, with Google Photos' controls (play or
 * pause, "0:02 / 0:38", sound, and the bar to move through it) while the bars are shown.
 */
@OptIn(UnstableApi::class)
@Composable
private fun VideoPage(url: String, api: TeleStoreApi, active: Boolean, showControls: Boolean, onTap: () -> Unit) {
    val context = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(context, OkHttpDataSource.Factory(api.http))))
            .build()
            .apply {
                setMediaItem(MediaItem.fromUri(url))
                prepare()
            }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    LaunchedEffect(active) {
        player.playWhenReady = active
        if (!active) player.seekTo(0)
    }
    var playing by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var muted by remember { mutableStateOf(false) }
    var dragging by remember { mutableFloatStateOf(-1f) }
    LaunchedEffect(player) {
        while (true) {
            playing = player.isPlaying
            position = player.currentPosition
            duration = player.duration.takeIf { it > 0 } ?: 0L
            if (player.playbackState == Player.STATE_ENDED) player.playWhenReady = false
            delay(250)
        }
    }

    Box(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures(onTap = { onTap() }) }) {
        AndroidView(
            factory = { PlayerView(it).apply { useController = false; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT; this.player = player } },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize(),
        )
        AnimatedVisibility(
            visible = showControls, enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 92.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = {
                        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
                        player.playWhenReady = !player.playWhenReady
                    }) {
                        Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (playing) "Pause" else "Play", tint = Color.White, modifier = Modifier.size(30.dp))
                    }
                    Spacer(Modifier.weight(1f))
                    Text("${clock(position)} / ${clock(duration)}", color = Color.White, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { muted = !muted; player.volume = if (muted) 0f else 1f }) {
                        Icon(if (muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp, contentDescription = if (muted) "Sound on" else "Mute", tint = Color.White, modifier = Modifier.size(28.dp))
                    }
                }
                Slider(
                    value = if (dragging >= 0f) dragging else if (duration > 0) position.toFloat() / duration else 0f,
                    onValueChange = { dragging = it },
                    onValueChangeFinished = {
                        if (duration > 0 && dragging >= 0f) player.seekTo((dragging * duration).toLong())
                        dragging = -1f
                    },
                    colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Color.White, inactiveTrackColor = Color(0xFF9E9E9E)),
                    modifier = Modifier.fillMaxWidth().height(36.dp),
                )
            }
        }
    }
}

@Composable
private fun ZoomableImage(url: String, active: Boolean, onZoomChanged: (Boolean) -> Unit, onTap: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var bounds by remember { mutableStateOf(IntSize.Zero) }

    // Swiping to another photo resets this one
    LaunchedEffect(active) {
        if (!active) {
            scale = 1f
            offset = Offset.Zero
        }
    }

    fun clamp(o: Offset, s: Float): Offset {
        val maxX = bounds.width * (s - 1) / 2
        val maxY = bounds.height * (s - 1) / 2
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }

    fun setZoom(newScale: Float, newOffset: Offset) {
        scale = newScale.coerceIn(1f, 5f)
        offset = if (scale <= 1f) Offset.Zero else clamp(newOffset, scale)
        onZoomChanged(scale > 1f)
    }

    Box(
        Modifier
            .fillMaxSize()
            .onSizeChanged { bounds = it }
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { tap ->
                        if (scale > 1f) setZoom(1f, Offset.Zero) else {
                            // Zoom in on the tapped spot
                            val center = Offset(size.width / 2f, size.height / 2f)
                            setZoom(2.5f, (center - tap) * 1.5f)
                        }
                    },
                )
            }
            .pointerInput(Unit) {
                // Two fingers zoom; one finger pans only while zoomed (otherwise the pager swipes)
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val fingers = event.changes.count { it.pressed }
                        if (fingers > 1 || scale > 1f) {
                            val zoom = event.calculateZoom()
                            val pan = event.calculatePan()
                            setZoom(scale * zoom, offset + pan)
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        SubcomposeAsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            loading = { CircularProgressIndicator(Modifier.size(40.dp), color = Color.White) },
            error = { Text("Couldn't load this photo.", color = Color.White) },
            modifier = Modifier.fillMaxSize().graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
        )
    }
}
