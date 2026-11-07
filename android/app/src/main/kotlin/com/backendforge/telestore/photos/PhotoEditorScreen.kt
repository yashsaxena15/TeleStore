package com.backendforge.telestore.photos

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Crop
import androidx.compose.material.icons.outlined.Rotate90DegreesCw
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.exifinterface.media.ExifInterface
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.CropAspect
import com.backendforge.telestore.core.CropRect
import com.backendforge.telestore.core.PhotoEdits
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.PhotoSource
import com.backendforge.telestore.transfers.PickedFile
import com.backendforge.telestore.ui.photos.PhotosTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.math.roundToInt

/** Opens the photo editor or, for a video, the trimmer. Either saves a new copy; the original stays. */
@Composable
fun EditorScreen(source: PhotoSource, container: AppContainer, onDone: () -> Unit) = PhotosTheme {
    // The file to edit, on this phone (a TeleStore-only one is fetched first)
    val context = LocalContext.current
    var input by remember(source) { mutableStateOf(source.localUri) }
    var fetchProgress by remember { mutableFloatStateOf(0f) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(source) {
        if (input == null) {
            val item = source.item ?: return@LaunchedEffect onDone()
            try {
                input = container.files.fetch(item) { fetchProgress = it }.uri
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = (e as? ApiException)?.message ?: "Couldn't get ${source.name}."
            }
        }
    }
    val ready = input
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            error != null -> Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(error.orEmpty(), color = Color.White)
                TextButton(onClick = onDone) { Text("Close") }
            }
            ready == null -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(progress = { fetchProgress }, color = Color.White)
                Text("Getting ${source.name}…", color = Color.White, modifier = Modifier.padding(top = 12.dp))
            }
            source.video -> VideoTrimmer(source, ready, container, onDone)
            else -> PhotoEditor(source, ready, container, onDone)
        }
    }
    LaunchedEffect(error) { error?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() } }
}

/** The bar on top of both editors: close on the left, "Save copy" on the right. */
@Composable
private fun EditorBar(title: String, saving: Boolean, onClose: () -> Unit, onSave: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close without saving", tint = Color.White) }
        Text(title, color = Color.White, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        if (saving) CircularProgressIndicator(Modifier.padding(end = 16.dp).size(24.dp), color = Color.White)
        else Button(onClick = onSave, modifier = Modifier.padding(end = 8.dp)) { Text("Save copy") }
    }
}

private enum class Tool { CROP, ADJUST }

/**
 * Crop (with rotate and a few shapes) and Adjust (brightness, contrast, saturation). Saving makes
 * a JPEG copy next to the original.
 */
@Composable
private fun PhotoEditor(source: PhotoSource, input: Uri, container: AppContainer, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var original by remember { mutableStateOf<Bitmap?>(null) }
    var rotation by remember { mutableStateOf(0) }
    var crop by remember { mutableStateOf(CropRect.FULL) }
    var aspect by remember { mutableStateOf(CropAspect.FREE) }
    var tool by remember { mutableStateOf(Tool.CROP) }
    var brightness by remember { mutableFloatStateOf(0f) }
    var contrast by remember { mutableFloatStateOf(0f) }
    var saturation by remember { mutableFloatStateOf(0f) }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(input) { original = withContext(Dispatchers.IO) { decodeForEditing(context, input) } }
    // The photo turned by the rotate button (in quarter turns)
    val bitmap = remember(original, rotation) { original?.let { rotate(it, rotation) } }
    val matrix = remember(brightness, contrast, saturation) { PhotoEdits.colorMatrix(brightness, contrast, saturation) }

    fun save() {
        val src = bitmap ?: return
        saving = true
        scope.launch {
            try {
                val file = withContext(Dispatchers.Default) {
                    val (x, y, w, h) = PhotoEdits.pixels(crop, src.width, src.height).toList()
                    val cut = Bitmap.createBitmap(src, x, y, w, h)
                    val out = Bitmap.createBitmap(cut.width, cut.height, Bitmap.Config.ARGB_8888)
                    Canvas(out).drawBitmap(cut, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(android.graphics.ColorMatrix(matrix)) })
                    val f = File(context.cacheDir, "edits/${editedName(source.name, "jpg")}").apply { parentFile?.mkdirs() }
                    f.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 95, it) }
                    f
                }
                val where = saveCopy(context, container, source, file, "image/jpeg")
                Toast.makeText(context, "Saved a copy $where", Toast.LENGTH_SHORT).show()
                container.photosChanged.tryEmit(Unit)
                onDone()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                saving = false
                Toast.makeText(context, (e as? ApiException)?.message ?: "Couldn't save the copy: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        EditorBar("Edit", saving, onClose = onDone, onSave = ::save)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
            val shown = bitmap
            if (shown == null) {
                CircularProgressIndicator(color = Color.White)
            } else {
                // Where the photo sits inside the box (fitted), so the crop frame lines up with it
                val density = LocalDensity.current
                val boxW = with(density) { maxWidth.toPx() }
                val boxH = with(density) { maxHeight.toPx() }
                val scale = minOf(boxW / shown.width, boxH / shown.height)
                val drawW = shown.width * scale
                val drawH = shown.height * scale
                val image = remember(shown) { shown.asImageBitmap() }
                Box(Modifier.size(with(density) { drawW.toDp() }, with(density) { drawH.toDp() })) {
                    Image(
                        image, contentDescription = source.name, contentScale = ContentScale.FillBounds,
                        colorFilter = ColorFilter.colorMatrix(ColorMatrix(matrix)), modifier = Modifier.fillMaxSize(),
                    )
                    if (tool == Tool.CROP) {
                        CropFrame(crop, drawW, drawH, aspect.ratio, shown.width.toFloat() / shown.height) { crop = it }
                    }
                }
            }
        }
        // The tool's controls, then the two tools
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp)) {
            when (tool) {
                Tool.CROP -> Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    IconButton(onClick = {
                        rotation = (rotation + 90) % 360
                        crop = CropRect.FULL
                        aspect = CropAspect.FREE
                    }) { Icon(Icons.Outlined.Rotate90DegreesCw, contentDescription = "Rotate", tint = Color.White) }
                    CropAspect.entries.forEach { a ->
                        FilterChip(
                            selected = aspect == a,
                            onClick = {
                                aspect = a
                                bitmap?.let { crop = PhotoEdits.centredCrop(a, it.width, it.height) }
                            },
                            label = { Text(a.label) },
                        )
                    }
                }
                Tool.ADJUST -> Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                    AdjustSlider("Brightness", brightness) { brightness = it }
                    AdjustSlider("Contrast", contrast) { contrast = it }
                    AdjustSlider("Saturation", saturation) { saturation = it }
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                ToolButton(Icons.Outlined.Crop, "Crop", tool == Tool.CROP) { tool = Tool.CROP }
                ToolButton(Icons.Outlined.Tune, "Adjust", tool == Tool.ADJUST) { tool = Tool.ADJUST }
            }
        }
    }
}

@Composable
private fun AdjustSlider(label: String, value: Float, onChange: (Float) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(end = 12.dp).size(width = 88.dp, height = 20.dp))
        Slider(value = value, onValueChange = onChange, valueRange = -1f..1f, modifier = Modifier.weight(1f))
        Text("${(value * 100).roundToInt()}", color = Color.White, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 8.dp).size(width = 32.dp, height = 18.dp))
    }
}

@Composable
private fun ToolButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = CircleShape, color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = if (selected) MaterialTheme.colorScheme.onPrimary else Color.White)
            Text(label, color = if (selected) MaterialTheme.colorScheme.onPrimary else Color.White, modifier = Modifier.padding(start = 8.dp))
        }
    }
}

/** The crop frame: dims outside it; drag a corner to resize, inside to move. */
@Composable
private fun CropFrame(crop: CropRect, width: Float, height: Float, ratio: Float?, photoAspect: Float, onChange: (CropRect) -> Unit) {
    val handle = with(LocalDensity.current) { 28.dp.toPx() }
    val current by androidx.compose.runtime.rememberUpdatedState(crop)
    val change by androidx.compose.runtime.rememberUpdatedState(onChange)
    Canvas(
        Modifier.fillMaxSize().pointerInput(width, height, ratio) {
            var corner = -1
            detectDragGestures(
                onDragStart = { at ->
                    val c = current
                    val corners = listOf(Offset(c.left * width, c.top * height), Offset(c.right * width, c.top * height), Offset(c.right * width, c.bottom * height), Offset(c.left * width, c.bottom * height))
                    corner = corners.indexOfFirst { (it - at).getDistance() < handle * 1.5f }
                },
                onDrag = { change, drag ->
                    change.consume()
                    val dx = drag.x / width
                    val dy = drag.y / height
                    change(if (corner >= 0) PhotoEdits.dragCorner(current, corner, dx, dy, ratio, photoAspect) else PhotoEdits.move(current, dx, dy))
                },
            )
        },
    ) {
        val l = crop.left * size.width
        val t = crop.top * size.height
        val r = crop.right * size.width
        val b = crop.bottom * size.height
        val dim = Color(0x99000000)
        drawRect(dim, Offset.Zero, Size(size.width, t))
        drawRect(dim, Offset(0f, b), Size(size.width, size.height - b))
        drawRect(dim, Offset(0f, t), Size(l, b - t))
        drawRect(dim, Offset(r, t), Size(size.width - r, b - t))
        drawRect(Color.White, Offset(l, t), Size(r - l, b - t), style = Stroke(width = 2.dp.toPx()))
        // Thirds, as cameras show them
        for (i in 1..2) {
            drawLine(Color(0x66FFFFFF), Offset(l + (r - l) * i / 3, t), Offset(l + (r - l) * i / 3, b), 1.dp.toPx())
            drawLine(Color(0x66FFFFFF), Offset(l, t + (b - t) * i / 3), Offset(r, t + (b - t) * i / 3), 1.dp.toPx())
        }
        listOf(Offset(l, t), Offset(r, t), Offset(r, b), Offset(l, b)).forEach { drawCircle(Color.White, 8.dp.toPx(), it) }
    }
}

/**
 * Trim: the video plays with a two-ended bar to pick the part to keep. Saving makes an MP4 copy
 * next to the original.
 */
@OptIn(UnstableApi::class)
@Composable
private fun VideoTrimmer(source: PhotoSource, input: Uri, container: AppContainer, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val player = remember(input) { ExoPlayer.Builder(context).setLoadControl(com.backendforge.telestore.player.PlayerMemory.video()).build().apply { setMediaItem(MediaItem.fromUri(input)); prepare() } }
    DisposableEffect(player) { onDispose { player.release() } }
    var duration by remember { mutableLongStateOf(0L) }
    var range by remember { mutableStateOf(0f..1f) }
    var playing by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    LaunchedEffect(player) {
        while (true) {
            if (player.duration > 0) duration = player.duration
            playing = player.isPlaying
            // Playback stays inside the chosen part
            if (duration > 0 && player.currentPosition > range.endInclusive * duration) {
                player.pause()
                player.seekTo((range.start * duration).toLong())
            }
            delay(100)
        }
    }

    fun save() {
        if (duration <= 0) return
        saving = true
        player.pause()
        val out = File(context.cacheDir, "edits/${editedName(source.name, "mp4")}").apply { parentFile?.mkdirs(); delete() }
        scope.launch {
            try {
                val ok = trim(context, input, (range.start * duration).toLong(), (range.endInclusive * duration).toLong(), out)
                if (!ok) error("the phone couldn't make the video")
                val where = saveCopy(context, container, source, out, "video/mp4")
                Toast.makeText(context, "Saved a copy $where", Toast.LENGTH_SHORT).show()
                container.photosChanged.tryEmit(Unit)
                onDone()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                saving = false
                Toast.makeText(context, (e as? ApiException)?.message ?: "Couldn't save the copy: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        EditorBar("Trim", saving, onClose = onDone, onSave = ::save)
        AndroidView(
            factory = { PlayerView(it).apply { useController = false; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT; this.player = player } },
            modifier = Modifier.weight(1f).fillMaxWidth(),
        )
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = {
                    if (playing) player.pause() else {
                        if (duration > 0 && (player.currentPosition < range.start * duration || player.currentPosition >= range.endInclusive * duration)) {
                            player.seekTo((range.start * duration).toLong())
                        }
                        player.play()
                    }
                }) { Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (playing) "Pause" else "Play", tint = Color.White) }
                val keep = ((range.endInclusive - range.start) * duration).toLong()
                Text(
                    "${clockText((range.start * duration).toLong())} – ${clockText((range.endInclusive * duration).toLong())}  ·  ${clockText(keep)} kept",
                    color = Color.White, style = MaterialTheme.typography.bodyMedium,
                )
            }
            RangeSlider(
                value = range,
                onValueChange = { new ->
                    // At least half a second kept
                    val min = if (duration > 0) 500f / duration else 0.01f
                    if (new.endInclusive - new.start >= min) {
                        if (new.start != range.start) player.seekTo((new.start * duration).toLong()) else player.seekTo((new.endInclusive * duration).toLong())
                        range = new
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

private fun clockText(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

/** Cuts [input] to [startMs]..[endMs] into [out] with Media3's Transformer (on the main thread, as it needs). */
@OptIn(UnstableApi::class)
private suspend fun trim(context: Context, input: Uri, startMs: Long, endMs: Long, out: File): Boolean =
    withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
            val item = MediaItem.Builder().setUri(input)
                .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs(startMs).setEndPositionMs(endMs).build())
                .build()
            val transformer = Transformer.Builder(context)
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) { if (cont.isActive) cont.resume(true) }
                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) { if (cont.isActive) cont.resume(false) }
                })
                .build()
            transformer.start(EditedMediaItem.Builder(item).build(), out.absolutePath)
            cont.invokeOnCancellation { Handler(Looper.getMainLooper()).post { transformer.cancel() } }
        }
    }

/** "IMG_20261101_180143-edited.jpg" */
private fun editedName(name: String, extension: String): String {
    val base = name.substringBeforeLast('.', name)
    return "$base-edited-${System.currentTimeMillis() / 1000}.$extension"
}

/**
 * Keeps the edited copy: on this phone next to the original (Android 10+, when the original is on
 * the phone; the backup then takes it to TeleStore), otherwise uploaded to TeleStore beside it.
 * Returns where, for the message ("on this phone" / "in TeleStore").
 */
private suspend fun saveCopy(context: Context, container: AppContainer, source: PhotoSource, file: File, mime: String): String {
    if (source.localUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        withContext(Dispatchers.IO) {
            val video = mime.startsWith("video")
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "DCIM/Camera")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val collection = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            val uri = context.contentResolver.insert(collection, values) ?: error("the phone refused the new file")
            context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            file.delete()
        }
        return "on this phone"
    }
    val folder = source.item?.path ?: (container.backup.settings.value.destination.trimEnd('/') + "/Edited")
    container.api().createFolderPath(folder)
    container.transfers.upload(listOf(PickedFile(Uri.fromFile(file), file.name, file.length())), folder)
    return "in TeleStore (uploading, see Transfers)"
}

/** The photo turned the right way (EXIF orientation), at most 4096 px on its long side. */
private fun decodeForEditing(context: Context, uri: Uri): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 4096) sample *= 2
    val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
    val orientation = runCatching {
        context.contentResolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
    val degrees = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
    }
    return rotate(bitmap, degrees)
}

private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap =
    if (degrees % 360 == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
