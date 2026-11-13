package com.backendforge.telestore.transfers

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.annotation.RequiresApi
import com.backendforge.telestore.core.ChunkSource
import com.backendforge.telestore.core.DownloadTarget
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer

/** Name and size of a picked or shared file. */
data class PickedFile(val uri: Uri, val name: String, val size: Long)

fun describe(context: Context, uri: Uri): PickedFile {
    var name: String? = null
    var size = -1L
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
            }
        }
    }
    if (size < 0) {
        size = runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L }.getOrDefault(-1L)
    }
    return PickedFile(uri, name ?: uri.lastPathSegment?.substringAfterLast('/') ?: "file", size)
}

/**
 * Reads chunks of a content:// file. Real files allow reading any position (chunks go in
 * parallel); streams that can only be read front to back (some apps share pipes) go in order.
 */
class UriChunkSource(context: Context, uri: Uri) : ChunkSource, AutoCloseable {
    /** The real file behind a photo or video of the phone's gallery (or a file:// address), when readable. */
    override val localPath: String? = runCatching {
        val path = when (uri.scheme) {
            "file" -> uri.path
            "content" -> context.contentResolver.query(uri, arrayOf(android.provider.MediaStore.MediaColumns.DATA), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            }
            else -> null
        }
        path?.takeIf { java.io.File(it).let { f -> f.isFile && f.canRead() } }
    }.getOrNull()

    private val pfd: ParcelFileDescriptor = context.contentResolver.openFileDescriptor(uri, "r")
        ?: throw IOException("This file can't be opened any more.")
    private val channel = FileInputStream(pfd.fileDescriptor).channel
    // A pipe reports no size and can't seek
    override val seekable: Boolean = pfd.statSize >= 0 && runCatching { channel.position(0); true }.getOrDefault(false)
    private var stream: InputStream? = if (seekable) null else context.contentResolver.openInputStream(uri)
    private var streamPos = 0L

    override fun read(offset: Long, length: Int, buffer: ByteArray) {
        if (seekable) {
            val buf = ByteBuffer.wrap(buffer, 0, length)
            var pos = offset
            while (buf.hasRemaining()) {
                val n = channel.read(buf, pos)
                if (n < 0) throw IOException("The file is shorter than expected.")
                pos += n
            }
        } else {
            val input = stream ?: throw IOException("This file can't be read.")
            if (offset != streamPos) throw IOException("This file can only be read in order.")
            var read = 0
            while (read < length) {
                val n = input.read(buffer, read, length - read)
                if (n < 0) throw IOException("The file is shorter than expected.")
                read += n
            }
            streamPos += length
        }
    }

    override fun close() {
        runCatching { stream?.close() }
        runCatching { channel.close() }
        runCatching { pfd.close() }
    }
}

/**
 * Where downloads are saved: the folder picked in Settings › Downloads location (any folder the
 * phone's file picker offers, kept with a lasting permission), or Download/TeleStore when none is
 * picked (Android 10+, no permission needed; older Android uses the app's own Downloads folder).
 * A file of a downloaded folder goes in the same folders it was in ([subPath], "Trip/Day 1").
 * Existing files are never overwritten: the phone names a second copy "name (1).ext".
 */
object DownloadFiles {
    const val FOLDER = "TeleStore"
    private val folderLock = Any()

    /** Creates the empty file and returns its uri; hidden from other apps until [publish]. */
    fun create(context: Context, name: String, mime: String?, subPath: String? = null, tree: String? = null): Uri {
        val parts = subPath?.split('/')?.filter { it.isNotBlank() }.orEmpty()
        if (tree != null) return createInTree(context, Uri.parse(tree), parts, name, mime)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) createInDownloads(context, name, mime, parts) else {
            var dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir, FOLDER)
            parts.forEach { dir = File(dir, it) }
            dir.mkdirs()
            Uri.fromFile(uniqueFile(dir, name).apply { createNewFile() })
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun createInDownloads(context: Context, name: String, mime: String?, parts: List<String>): Uri {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.RELATIVE_PATH, (listOf(Environment.DIRECTORY_DOWNLOADS, FOLDER) + parts).joinToString("/"))
            put(MediaStore.Downloads.IS_PENDING, 1)
            mime?.let { put(MediaStore.Downloads.MIME_TYPE, it) }
        }
        return context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("Couldn't create the file in Downloads.")
    }

    /** A file in the picked folder ([tree]), inside its subfolders (made when missing). */
    private fun createInTree(context: Context, tree: Uri, parts: List<String>, name: String, mime: String?): Uri {
        val resolver = context.contentResolver
        val dir = synchronized(folderLock) {
            var docId = try {
                DocumentsContract.getTreeDocumentId(tree)
            } catch (e: Exception) {
                throw IOException("The downloads folder can't be used any more. Pick it again in Settings › Downloads location.")
            }
            for (part in parts) docId = childFolder(context, tree, docId, part)
            DocumentsContract.buildDocumentUriUsingTree(tree, docId)
        }
        return try {
            DocumentsContract.createDocument(resolver, dir, mime ?: "application/octet-stream", name)
        } catch (e: Exception) {
            null
        } ?: throw IOException("Couldn't create $name in the downloads folder. Check it still exists, or pick another in Settings.")
    }

    /** The id of folder [name] inside [parentId], made when it isn't there yet. */
    private fun childFolder(context: Context, tree: Uri, parentId: String, name: String): String {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE)
        runCatching {
            context.contentResolver.query(children, columns, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    if (c.getString(1) == name && c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) return c.getString(0)
                }
            }
        }
        val made = try {
            DocumentsContract.createDocument(context.contentResolver, DocumentsContract.buildDocumentUriUsingTree(tree, parentId),
                DocumentsContract.Document.MIME_TYPE_DIR, name)
        } catch (e: Exception) {
            null
        } ?: throw IOException("Couldn't make the folder $name in the downloads folder.")
        return DocumentsContract.getDocumentId(made)
    }

    /** Makes the finished file visible in Files and other apps. */
    fun publish(context: Context, uri: Uri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && uri.scheme == "content" && uri.authority == MediaStore.AUTHORITY) {
            runCatching {
                context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            }
        }
    }

    fun delete(context: Context, uri: Uri) {
        runCatching {
            when {
                uri.scheme == "file" -> File(uri.path!!).delete()
                DocumentsContract.isDocumentUri(context, uri) -> DocumentsContract.deleteDocument(context.contentResolver, uri)
                else -> context.contentResolver.delete(uri, null, null)
            }
        }
    }

    /** Free space where downloads go, when the phone can tell (null for a folder on another app's storage). */
    fun freeBytes(context: Context, tree: String?): Long? = runCatching {
        val onPhone = tree == null || DocumentsContract.getTreeDocumentId(Uri.parse(tree)).startsWith("primary:")
        if (!onPhone) return null
        android.os.StatFs(Environment.getExternalStorageDirectory().path).availableBytes
    }.getOrNull()

    /** "Download/TeleStore", or the picked folder's path as the phone shows it ("Movies/TeleStore", "SD card/…"). */
    fun describe(tree: String?): String {
        if (tree == null) return "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER"
        val id = runCatching { DocumentsContract.getTreeDocumentId(Uri.parse(tree)) }.getOrNull() ?: return "Picked folder"
        val volume = id.substringBefore(':')
        val path = id.substringAfter(':', "")
        val where = if (volume == "primary") "Phone storage" else "SD card"
        return if (path.isEmpty()) where else "$where/$path"
    }

    private fun uniqueFile(dir: File, name: String): File {
        var candidate = File(dir, name)
        var n = 1
        val base = name.substringBeforeLast('.', name)
        val ext = name.substringAfterLast('.', "").let { if (it.isEmpty() || it == name) "" else ".$it" }
        while (candidate.exists()) candidate = File(dir, "$base (${n++})$ext")
        return candidate
    }
}

/** Writes a download into its saved file, continuing after [length] bytes or starting over. */
class UriDownloadTarget(private val context: Context, private val uri: Uri, private val expected: Long) : DownloadTarget {
    override fun length(): Long = runCatching {
        context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: 0L
    }.getOrDefault(0L).coerceAtMost(if (expected > 0) expected else Long.MAX_VALUE)

    override fun open(append: Boolean): OutputStream {
        val pfd = context.contentResolver.openFileDescriptor(uri, "rw") ?: throw IOException("Couldn't open the file in Downloads.")
        val out = FileOutputStream(pfd.fileDescriptor)
        val channel = out.channel
        val start = if (append) length() else 0L
        channel.truncate(start)
        channel.position(start)
        return object : OutputStream() {
            override fun write(b: Int) = out.write(b)
            override fun write(b: ByteArray, off: Int, len: Int) = out.write(b, off, len)
            override fun flush() = out.flush()
            override fun close() {
                runCatching { out.close() }
                pfd.close()
            }
        }
    }
}
