package com.backendforge.telestore.backup

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import java.time.Instant

/** A photo or video on the phone. */
data class PhoneItem(
    val uri: Uri,
    val id: Long,
    val name: String,
    val size: Long,
    val takenAt: Long,
    val modifiedSec: Long,
    val bucketId: String,
    val bucket: String,
    val video: Boolean,
) {
    /** Changes when the file is edited, so an edited photo is backed up again. */
    val key: String get() = "$id:$size:$modifiedSec"
    val takenIso: String? get() = takenAt.takeIf { it > 0 }?.let { Instant.ofEpochMilli(it).toString().substringBefore('.').removeSuffix("Z") }
}

data class PhoneAlbum(val id: String, val name: String, val count: Int)

/** Reads the phone's photos and videos (MediaStore). */
object PhoneMedia {
    /**
     * The runtime permissions needed to read photos and videos on this Android version, plus (Android
     * 10+) their locations: without it Android removes the GPS position from every photo read.
     */
    fun permissions(): Array<String> {
        val read = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
                arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
            else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) read + Manifest.permission.ACCESS_MEDIA_LOCATION else read
    }

    /** Photos read keep where they were taken (always true before Android 10, which never hid it). */
    fun canReadLocation(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED

    /**
     * The photo with its location kept (Android 10+ with the location permission); [uri] itself
     * otherwise. Opening the original can still be refused: callers fall back to [uri].
     */
    fun originalUri(context: Context, uri: Uri): Uri =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && canReadLocation(context) && uri.authority == MediaStore.AUTHORITY) {
            runCatching { MediaStore.setRequireOriginal(uri) }.getOrDefault(uri)
        } else {
            uri
        }

    /** Opens the photo with its location when allowed, else as Android hands it out. */
    fun openPhoto(context: Context, uri: Uri): java.io.InputStream? {
        val original = originalUri(context, uri)
        if (original != uri) {
            try {
                context.contentResolver.openInputStream(original)?.let { return it }
            } catch (_: SecurityException) {
            } catch (_: UnsupportedOperationException) {
            } catch (_: java.io.FileNotFoundException) {
            }
        }
        return context.contentResolver.openInputStream(uri)
    }

    /** Full access, or (Android 14) access only to the photos the user picked. */
    fun canRead(context: Context): Boolean {
        fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
        return when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                granted(Manifest.permission.READ_MEDIA_IMAGES) ||
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED))
            else -> granted(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    /** Only some photos were shared with the app (Android 14's "select photos"). */
    fun partialAccess(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED

    fun scan(context: Context, includeVideos: Boolean = true): List<PhoneItem> {
        val collection = MediaStore.Files.getContentUri("external")
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.MediaColumns.DATE_TAKEN,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.BUCKET_ID,
            MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
        )
        val types = if (includeVideos) "(1,3)" else "(1)"
        val selection = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN $types AND ${MediaStore.Files.FileColumns.SIZE} > 0"
        val out = mutableListOf<PhoneItem>()
        runCatching {
            context.contentResolver.query(collection, projection, selection, null, "${MediaStore.MediaColumns.DATE_TAKEN} DESC")?.use { c ->
                val id = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
                val name = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
                val size = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
                val taken = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_TAKEN)
                val modified = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
                val bucketId = c.getColumnIndexOrThrow(MediaStore.MediaColumns.BUCKET_ID)
                val bucket = c.getColumnIndexOrThrow(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME)
                val type = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
                while (c.moveToNext()) {
                    val video = c.getInt(type) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                    val rowId = c.getLong(id)
                    val base = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    out += PhoneItem(
                        uri = ContentUris.withAppendedId(base, rowId),
                        id = rowId,
                        name = c.getString(name) ?: "IMG_$rowId",
                        size = c.getLong(size),
                        takenAt = c.getLong(taken).takeIf { it > 0 } ?: (c.getLong(modified) * 1000),
                        modifiedSec = c.getLong(modified),
                        bucketId = c.getString(bucketId) ?: "",
                        bucket = c.getString(bucket) ?: "Other",
                        video = video,
                    )
                }
            }
        }
        return out
    }

    fun albums(context: Context): List<PhoneAlbum> =
        scan(context).groupBy { it.bucketId }.map { (id, items) -> PhoneAlbum(id, items.first().bucket, items.size) }
            .sortedWith(compareByDescending<PhoneAlbum> { it.name.equals("Camera", true) }.thenByDescending { it.count })

    /** The camera album's id, the default choice. */
    fun cameraAlbum(albums: List<PhoneAlbum>): String? =
        albums.firstOrNull { it.name.equals("Camera", true) }?.id ?: albums.firstOrNull()?.id
}
