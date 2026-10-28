package com.backendforge.telestore.photos

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.PhotoSource
import com.backendforge.telestore.ui.components.FileInfoSheet
import com.backendforge.telestore.ui.components.pullDownOffset
import com.backendforge.telestore.ui.components.pullDownToClose
import com.backendforge.telestore.ui.components.rememberPullDownState

/**
 * Swipe through the folder's photos; pinch or double-tap to zoom, drag to look around, pull down to close.
 * A photo on this phone shows from there; one only in TeleStore from the server.
 */
@Composable
fun PhotoViewerScreen(
    photos: List<PhotoSource>,
    startIndex: Int,
    api: TeleStoreApi,
    onBack: () -> Unit,
    /** A downloaded copy on the phone, shown instead of fetching it again. */
    offlineCopy: (FileItem) -> android.net.Uri? = { null },
) {
    if (photos.isEmpty()) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, photos.lastIndex)) { photos.size }
    var zoomed by remember { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    var info by remember { mutableStateOf<FileItem?>(null) }
    val pull = rememberPullDownState(onBack)

    // The black fades as the photo is pulled down, showing it's about to close
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 1f - 0.6f * pull.progress)).pullDownToClose(pull, enabled = !zoomed)) {
        HorizontalPager(
            state = pager, userScrollEnabled = !zoomed, beyondViewportPageCount = 1,
            modifier = Modifier.fillMaxSize().pullDownOffset(pull),
        ) { page ->
            ZoomableImage(
                url = remember(page) { photoUrl(photos[page], api, offlineCopy) },
                active = page == pager.currentPage,
                onZoomChanged = { if (page == pager.currentPage) zoomed = it },
                onTap = { chrome = !chrome },
            )
        }
        if (chrome && pull.offset == 0f) {
            val current = photos[pager.currentPage]
            Row(
                Modifier.fillMaxWidth().background(Color(0x99000000)).statusBarsPadding().padding(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White) }
                Column(Modifier.weight(1f)) {
                    Text(current.name, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                    Text("${pager.currentPage + 1} of ${photos.size}", color = Color(0xFFD4D4D8), style = MaterialTheme.typography.bodySmall)
                }
                // Details come from the server: a photo only on this phone has none to show
                current.item?.let { item ->
                    IconButton(onClick = { info = item }) { Icon(Icons.Outlined.Info, contentDescription = "Info", tint = Color.White) }
                }
            }
        }
    }
    info?.let { FileInfoSheet(item = it, api = api, onDismiss = { info = null }) }
}

/** The phone's copy first, then a downloaded one, then the server. */
private fun photoUrl(source: PhotoSource, api: TeleStoreApi, offlineCopy: (FileItem) -> android.net.Uri?): String =
    source.localUri?.toString()
        ?: source.item?.let { offlineCopy(it)?.toString() ?: api.media.file(it).toString() }
        ?: ""

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
