package com.backendforge.telestore.photos

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.location.Geocoder
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Camera
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

/**
 * The photo's details, as in Google Photos: when (with a pencil to change it), a caption, then
 * "Details": backed up or not, the camera and its settings, the file, where it is on the phone,
 * and where it was taken ("Add a location" when unknown). Changes need the photo in TeleStore.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotoDetailsSheet(source: PhotoSource, api: TeleStoreApi, onDismiss: () -> Unit, onChanged: (FileItem) -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var info by remember(source) { mutableStateOf<PhotoInfo?>(null) }
    var error by remember(source) { mutableStateOf<String?>(null) }
    var placeName by remember(source) { mutableStateOf<String?>(null) }
    var pickLocation by remember { mutableStateOf(false) }

    LaunchedEffect(source) {
        try {
            val read = loadPhotoInfo(context, source, api)
            info = read
            // The owner's place, else the phone's name for the photo's own GPS
            placeName = read.place ?: source.item?.place ?: read.latitude?.let { lat -> read.longitude?.let { lon -> geocodeName(context, lat, lon) } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = (e as? ApiException)?.message ?: "Couldn't read this photo's details."
        }
    }

    /** Saves a change in TeleStore and tells the viewer (or says why it can't). */
    fun save(change: suspend (FileItem) -> FileItem) {
        val item = source.item ?: return Toast.makeText(context, "Back this up first: it's only on this phone.", Toast.LENGTH_SHORT).show()
        scope.launch {
            try {
                onChanged(change(item))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Toast.makeText(context, (e as? ApiException)?.message ?: "Couldn't save that.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 28.dp)) {
            val shown = info
            when {
                error != null -> Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(20.dp))
                shown == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(28.dp)) }
                else -> {
                    // When, with the pencil to change it
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            PhotoDetails.takenLabel(source.item?.takenAt ?: shown.takenAt) ?: "Date unknown",
                            style = MaterialTheme.typography.titleLarge.copy(fontSize = 21.sp), modifier = Modifier.weight(1f),
                        )
                        if (source.item != null) {
                            IconButton(onClick = {
                                pickDateTime(context, source.takenAtMillis) { picked ->
                                    save { item ->
                                        val iso = picked.toOffsetDateTime().toString()
                                        api.setTakenAt(item, iso)
                                        item.copy(takenAt = iso)
                                    }
                                }
                            }) { Icon(Icons.Outlined.Edit, contentDescription = "Change date and time") }
                        }
                    }
                    if (source.item != null) {
                        CaptionField(initial = source.item.caption ?: shown.caption.orEmpty()) { text ->
                            save { item ->
                                api.setCaption(item, text)
                                item.copy(caption = text.trim().ifEmpty { null })
                            }
                        }
                    }
                    Text("Details", style = MaterialTheme.typography.titleMedium.copy(fontSize = 19.sp), modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 14.dp))
                    DetailsCards(shown, source)
                    LocationRow(
                        place = placeName,
                        info = shown,
                        canEdit = source.item != null,
                        onOpen = { lat, lon -> openInMaps(context, lat, lon) },
                        onAdd = { pickLocation = true },
                    )
                }
            }
        }
    }

    if (pickLocation) {
        LocationPicker(
            onPick = { name, lat, lon ->
                pickLocation = false
                placeName = name
                save { item ->
                    api.setPhotoLocation(item, name, lat, lon)
                    item.copy(place = name)
                }
            },
            onDismiss = { pickLocation = false },
        )
    }
}

/** "Add a caption…": saved when the keyboard's Done is pressed or the field is left. */
@Composable
private fun CaptionField(initial: String, onSave: (String) -> Unit) {
    var text by remember(initial) { mutableStateOf(initial) }
    var saved by remember(initial) { mutableStateOf(initial) }
    val focus = LocalFocusManager.current
    fun commit() {
        if (text.trim() != saved.trim()) {
            saved = text
            onSave(text)
        }
    }
    Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp)) {
        if (text.isEmpty()) Text("Add a caption…", style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        BasicTextField(
            value = text,
            onValueChange = { text = it },
            textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp, color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { commit(); focus.clearFocus() }),
            modifier = Modifier.fillMaxWidth().onFocusChanged { if (!it.isFocused) commit() },
        )
    }
}

/** The rounded sections: backup, camera (opens to its settings), file, and where it is. */
@Composable
private fun DetailsCards(info: PhotoInfo, source: PhotoSource) {
    var cameraOpen by remember { mutableStateOf(true) }
    val camera = PhotoDetails.camera(info.cameraMake, info.cameraModel)
    val cells = PhotoDetails.exposureCells(info)
    val chips = PhotoDetails.fileChips(info)
    val section = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer)
    // Grey sections 3 dp apart inside one rounded card, as in Google Photos
    Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            // Backed up (or not yet)
            Row(section.padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.Top) {
                Icon(if (source.item != null) Icons.Outlined.CloudDone else Icons.Outlined.CloudOff, contentDescription = null, modifier = Modifier.padding(top = 2.dp).size(28.dp))
                Column(Modifier.padding(start = 18.dp)) {
                    if (source.item != null) {
                        Text("Backed up", style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp))
                        Text("Original quality", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline)
                        Text("Stored in TeleStore on Telegram. It doesn't use space on this phone or the server.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Text("Not backed up yet", style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp))
                        Text("Only on this phone. Back it up to keep it safe in TeleStore.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            // The camera, opening to its settings
            if (camera != null || cells.isNotEmpty()) {
                Row(
                    section.clickable(enabled = cells.isNotEmpty()) { cameraOpen = !cameraOpen }.padding(horizontal = 20.dp, vertical = 18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Camera, contentDescription = null, modifier = Modifier.size(28.dp))
                    Text(camera ?: "Camera", style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp), modifier = Modifier.weight(1f).padding(start = 18.dp))
                    if (cells.isNotEmpty()) Icon(if (cameraOpen) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = if (cameraOpen) "Hide camera settings" else "Show camera settings")
                }
                if (cameraOpen && cells.isNotEmpty()) {
                    Row(section.padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                        cells.forEachIndexed { i, cell ->
                            if (i > 0) Box(Modifier.padding(horizontal = 4.dp).width(1.5.dp).height(12.dp).background(MaterialTheme.colorScheme.outline))
                            Text(cell, style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp), modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        }
                    }
                }
            }
            // The file
            Column(section.padding(horizontal = 20.dp, vertical = 18.dp)) {
                Text(info.fileName ?: source.name, style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                val allChips = chips + listOfNotNull(info.format?.takeIf { it in setOf("HEIC", "HEIF", "PNG", "GIF", "WEBP", "RAW", "DNG") })
                if (allChips.isNotEmpty()) {
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        allChips.forEach { chip ->
                            Text(
                                chip, style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 6.dp),
                            )
                        }
                    }
                }
            }
            // Where it is: on this phone, or in TeleStore
            val size = info.fileSize?.takeIf { it > 0 }?.let { Bytes.short(it) }
            Column(section.padding(horizontal = 20.dp, vertical = 18.dp)) {
                val where = if (source.localUri != null) "On device" else "In TeleStore"
                Text(listOfNotNull(where, size).joinToString(" • "), style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp))
                info.folder?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/** The place (opens Maps), or "Add a location". */
@Composable
private fun LocationRow(place: String?, info: PhotoInfo, canEdit: Boolean, onOpen: (Double, Double) -> Unit, onAdd: () -> Unit) {
    val lat = info.latitude
    val lon = info.longitude
    val known = place != null || (info.hasLocation && lat != null && lon != null)
    Row(
        Modifier.fillMaxWidth()
            .clickable(enabled = known && lat != null && lon != null || (!known && canEdit)) {
                if (known && lat != null && lon != null) onOpen(lat, lon) else onAdd()
            }
            .padding(horizontal = 28.dp, vertical = 22.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.LocationOn, contentDescription = null, tint = if (known) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
        Column(Modifier.weight(1f).padding(start = 30.dp)) {
            when {
                known -> {
                    Text(place ?: PhotoDetails.coordinates(lat!!, lon!!), style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp))
                    if (place != null && lat != null && lon != null) Text(PhotoDetails.coordinates(lat, lon), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                canEdit -> Text("Add a location", style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp), color = MaterialTheme.colorScheme.primary)
                else -> Text("No location", style = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (known && canEdit) TextButton(onClick = onAdd) { Text("Change") }
    }
}

/** Search for a place by name (the phone's geocoder) and pick one. */
@Composable
private fun LocationPicker(onPick: (String, Double, Double) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Triple<String, Double, Double>>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    fun search() {
        val q = query.trim()
        if (q.isEmpty()) return
        searching = true
        scope.launch {
            results = withContext(Dispatchers.IO) { findPlaces(context, q) }
            searching = false
            note = if (results.isEmpty()) "No places found. Try another name." else null
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add a location") },
        text = {
            Column {
                OutlinedTextField(
                    value = query, onValueChange = { query = it }, singleLine = true, label = { Text("Search for a place") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { search() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (searching) CircularProgressIndicator(Modifier.padding(top = 12.dp).size(24.dp))
                note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp)) }
                results.forEach { (name, lat, lon) ->
                    Text(
                        name, style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.fillMaxWidth().clickable { onPick(name, lat, lon) }.padding(vertical = 12.dp),
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = { search() }, enabled = query.isNotBlank()) { Text("Search") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Suppress("DEPRECATION")
private fun findPlaces(context: Context, query: String): List<Triple<String, Double, Double>> {
    if (!Geocoder.isPresent()) return emptyList()
    return runCatching { Geocoder(context, Locale.getDefault()).getFromLocationName(query, 5) }.getOrNull().orEmpty().map { a ->
        val name = listOfNotNull(a.featureName?.takeIf { it != a.locality && !it.all(Char::isDigit) }, a.locality ?: a.subAdminArea, a.adminArea)
            .distinct().joinToString(", ").ifEmpty { query }
        Triple(name, a.latitude, a.longitude)
    }
}

/** "Gandhinagar, Gujarat" for a position (null offline or unknown). */
@Suppress("DEPRECATION")
private suspend fun geocodeName(context: Context, lat: Double, lon: Double): String? = withContext(Dispatchers.IO) {
    if (!Geocoder.isPresent()) return@withContext null
    runCatching { Geocoder(context, Locale.getDefault()).getFromLocation(lat, lon, 1)?.firstOrNull() }.getOrNull()?.let { a ->
        listOfNotNull(a.locality ?: a.subAdminArea, a.adminArea).distinct().joinToString(", ").ifEmpty { null }
    }
}

/** Android's date picker, then its time picker; [onPicked] gets the moment in this phone's zone. */
private fun pickDateTime(context: Context, millis: Long?, onPicked: (ZonedDateTime) -> Unit) {
    val zone = ZoneId.systemDefault()
    val start = millis?.let { java.time.Instant.ofEpochMilli(it).atZone(zone) } ?: ZonedDateTime.now(zone)
    DatePickerDialog(context, { _, year, month, day ->
        TimePickerDialog(context, { _, hour, minute ->
            onPicked(LocalDateTime.of(year, month + 1, day, hour, minute, start.second).atZone(zone))
        }, start.hour, start.minute, android.text.format.DateFormat.is24HourFormat(context)).show()
    }, start.year, start.monthValue - 1, start.dayOfMonth).show()
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
    var fromServer: PhotoInfo? = null
    if (item != null && !source.video) {
        fromServer = try {
            api.photoInfo(item)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // An older server without photo details, or a phone copy to read instead
            if (local != null || (e is ApiException && e.status in setOf(404, 422))) null else throw e
        }
    }
    if (local != null) {
        val read = withContext(Dispatchers.IO) { runCatching { PhotoExif.read(context, local) }.getOrNull() }
        if (read != null) {
            // The owner's caption and place live on the server; the phone knows the rest best
            return read.copy(
                folder = read.folder ?: item?.path ?: "On this phone",
                caption = fromServer?.caption ?: item?.caption,
                place = fromServer?.place ?: item?.place,
            )
        }
    }
    if (item != null) return (fromServer ?: PhotoInfo()).withFile(item)
    return PhotoInfo(fileName = source.name)
}

private fun PhotoInfo.withFile(item: FileItem): PhotoInfo = copy(
    fileName = fileName ?: item.name,
    fileSize = fileSize ?: item.size,
    folder = folder ?: item.path,
    takenAt = takenAt ?: item.takenAt,
    caption = caption ?: item.caption,
    place = place ?: item.place,
)

/** Reads a phone photo's EXIF (with its location when Android allows it), and where it is kept. */
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
        var folder: String? = null
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
        // "/storage/emulated/0/DCIM/Camera", as Google Photos shows it
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            runCatching {
                context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.RELATIVE_PATH), null, null, null)?.use { c ->
                    if (c.moveToFirst() && !c.isNull(0)) folder = "/storage/emulated/0/" + c.getString(0).trimEnd('/')
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
            folder = folder,
        )
    }

    private fun firstPositive(exif: ExifInterface, vararg tags: String): Int? =
        tags.firstNotNullOfOrNull { tag -> exif.getAttributeInt(tag, 0).takeIf { it > 0 } }
}
