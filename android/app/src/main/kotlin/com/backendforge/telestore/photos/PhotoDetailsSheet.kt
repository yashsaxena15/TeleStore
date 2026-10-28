package com.backendforge.telestore.photos

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.exifinterface.media.ExifInterface
import com.backendforge.telestore.backup.PhoneMedia
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.Bytes
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.PhotoDetails
import com.backendforge.telestore.core.PhotoInfo
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.PhotoSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The photo's details: when, which camera, exposure, where (with "Open in Maps") and the file.
 * A photo on this phone is read here (EXIF); one only in TeleStore asks the server.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotoDetailsSheet(source: PhotoSource, api: TeleStoreApi, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var info by remember(source) { mutableStateOf<PhotoInfo?>(null) }
    var error by remember(source) { mutableStateOf<String?>(null) }

    LaunchedEffect(source) {
        try {
            info = loadPhotoInfo(context, source, api)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = (e as? ApiException)?.message ?: "Couldn't read this photo's details."
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Details", style = MaterialTheme.typography.titleMedium)
            val shown = info
            when {
                error != null -> Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                shown == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(28.dp))
                }
                else -> PhotoDetailsContent(shown, context)
            }
        }
    }
}

@Composable
private fun PhotoDetailsContent(info: PhotoInfo, context: Context) {
    val taken = PhotoDetails.takenLabel(info.takenAt)
    if (taken != null) DetailLine(Icons.Filled.CalendarToday, taken)

    val camera = PhotoDetails.camera(info.cameraMake, info.cameraModel)
    if (camera != null || info.lens != null) {
        DetailLine(Icons.Filled.CameraAlt, camera ?: info.lens.orEmpty(), if (camera != null) info.lens else null)
    }

    val resolution = PhotoDetails.resolution(info)
    val exposure = PhotoDetails.exposureLine(info)
    if (resolution != null || exposure != null) {
        DetailLine(Icons.Filled.Tune, resolution ?: exposure.orEmpty(), if (resolution != null) exposure else null)
    }

    info.flash?.let { DetailLine(Icons.Filled.FlashOn, it) }

    val lat = info.latitude
    val lng = info.longitude
    if (info.hasLocation && lat != null && lng != null) {
        Column {
            DetailLine(
                Icons.Filled.LocationOn,
                PhotoDetails.coordinates(lat, lng),
                info.altitude?.let { "Altitude ${"%.0f".format(java.util.Locale.US, it)} m" },
            )
            OutlinedButton(
                onClick = { openInMaps(context, lat, lng) },
                modifier = Modifier.padding(start = 40.dp, top = 8.dp),
            ) {
                Icon(Icons.Filled.Map, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Open in Maps")
            }
        }
    }

    val fileLine = listOfNotNull(info.fileSize?.takeIf { it > 0 }?.let { Bytes.short(it) }, info.format).joinToString(" · ")
    if (info.fileName != null || fileLine.isNotEmpty()) {
        DetailLine(Icons.AutoMirrored.Filled.InsertDriveFile, info.fileName ?: fileLine, if (info.fileName != null) fileLine.ifEmpty { null } else null)
    }
    info.folder?.let { DetailLine(Icons.Filled.Image, it) }

    if (taken == null && camera == null && exposure == null && !info.hasLocation) {
        Text(
            "This photo has no camera details.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun DetailLine(icon: ImageVector, title: String, subtitle: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (!subtitle.isNullOrBlank()) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private fun openInMaps(context: Context, latitude: Double, longitude: Double) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(PhotoDetails.mapsUri(latitude, longitude)))
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No maps app: the web map instead
        val web = Uri.parse("https://www.google.com/maps/search/?api=1&query=$latitude,$longitude")
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, web)) }
    }
}

/** The phone's copy when there is one (its EXIF), else the server's reading of the uploaded photo. */
private suspend fun loadPhotoInfo(context: Context, source: PhotoSource, api: TeleStoreApi): PhotoInfo {
    val local = source.localUri
    val item = source.item
    if (local != null) {
        val read = withContext(Dispatchers.IO) { runCatching { PhotoExif.read(context, local) }.getOrNull() }
        if (read != null) return read.copy(folder = read.folder ?: item?.path ?: "On this phone")
    }
    if (item != null) {
        val fromServer = try {
            api.photoInfo(item)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // An older server without photo details: what the file list already says
            if (e is ApiException && e.status == 404) PhotoInfo() else throw e
        }
        return fromServer.withFile(item)
    }
    return PhotoInfo(fileName = source.name)
}

private fun PhotoInfo.withFile(item: FileItem): PhotoInfo = copy(
    fileName = fileName ?: item.name,
    fileSize = fileSize ?: item.size,
    folder = folder ?: item.path,
    takenAt = takenAt ?: item.takenAt,
)

/** Reads a phone photo's EXIF (with its location when Android allows it). */
object PhotoExif {
    fun read(context: Context, uri: Uri): PhotoInfo {
        // Formats ExifInterface can't read from a stream still get their size, name and dimensions
        val exif: ExifInterface? = runCatching { PhoneMedia.openPhoto(context, uri)?.use { ExifInterface(it) } }.getOrNull()
        var width = exif?.let { firstPositive(it, ExifInterface.TAG_PIXEL_X_DIMENSION, ExifInterface.TAG_IMAGE_WIDTH) }
        var height = exif?.let { firstPositive(it, ExifInterface.TAG_PIXEL_Y_DIMENSION, ExifInterface.TAG_IMAGE_LENGTH) }
        if (width == null || height == null) {
            // No sizes in EXIF (PNG, screenshots): ask the decoder for just the bounds
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            runCatching { context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } }
            if (bounds.outWidth > 0 && bounds.outHeight > 0) {
                width = bounds.outWidth
                height = bounds.outHeight
            }
        }
        var name: String? = null
        var size: Long? = null
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val s = c.getColumnIndex(OpenableColumns.SIZE)
                    if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                    if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
                }
            }
        }
        val mime = runCatching { context.contentResolver.getType(uri) }.getOrNull()
        val latLong: DoubleArray? = exif?.latLong
        return PhotoInfo(
            width = width,
            height = height,
            cameraMake = exif?.getAttribute(ExifInterface.TAG_MAKE)?.trim()?.ifBlank { null },
            cameraModel = exif?.getAttribute(ExifInterface.TAG_MODEL)?.trim()?.ifBlank { null },
            lens = exif?.getAttribute(ExifInterface.TAG_LENS_MODEL)?.trim()?.ifBlank { null },
            aperture = exif?.getAttributeDouble(ExifInterface.TAG_F_NUMBER, 0.0)?.takeIf { it > 0 },
            exposure = exif?.getAttributeDouble(ExifInterface.TAG_EXPOSURE_TIME, 0.0)?.takeIf { it > 0 },
            iso = exif?.getAttributeInt(ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY, 0)?.takeIf { it > 0 },
            focalLength = exif?.getAttributeDouble(ExifInterface.TAG_FOCAL_LENGTH, 0.0)?.takeIf { it > 0 },
            flash = exif?.getAttribute(ExifInterface.TAG_FLASH)?.toIntOrNull()?.let { PhotoDetails.flashLabel(it) },
            takenAt = PhotoDetails.exifDate(exif?.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL))
                ?: PhotoDetails.exifDate(exif?.getAttribute(ExifInterface.TAG_DATETIME)),
            latitude = latLong?.getOrNull(0),
            longitude = latLong?.getOrNull(1),
            altitude = if (exif != null && exif.getAttribute(ExifInterface.TAG_GPS_ALTITUDE) != null) exif.getAltitude(0.0) else null,
            format = mime?.substringAfter('/')?.uppercase()?.removePrefix("X-"),
            fileSize = size,
            fileName = name,
        )
    }

    private fun firstPositive(exif: ExifInterface, vararg tags: String): Int? =
        tags.firstNotNullOfOrNull { tag -> exif.getAttributeInt(tag, 0).takeIf { it > 0 } }
}
