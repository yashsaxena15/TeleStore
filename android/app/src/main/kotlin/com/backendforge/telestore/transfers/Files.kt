package com.backendforge.telestore.transfers

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
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
 * The saved copy in Downloads/TeleStore (Android 10+, no permission needed). Older Android keeps it
 * in the app's own Downloads folder instead (Android/data/…/files/Download), which needs no permission.
 */
object DownloadFiles {
    const val FOLDER = "TeleStore"

    /** Creates the empty file and returns its uri; hidden from other apps until [publish]. */
    fun create(context: Context, name: String, mime: String?): Uri =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) createInDownloads(context, name, mime) else {
            val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir, FOLDER).apply { mkdirs() }
            Uri.fromFile(uniqueFile(dir, name).apply { createNewFile() })
        }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun createInDownloads(context: Context, name: String, mime: String?): Uri {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
            put(MediaStore.Downloads.IS_PENDING, 1)
            mime?.let { put(MediaStore.Downloads.MIME_TYPE, it) }
        }
        return context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("Couldn't create the file in Downloads.")
    }

    /** Makes the finished file visible in Files and other apps. */
    fun publish(context: Context, uri: Uri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && uri.scheme == "content") {
            runCatching {
                context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            }
        }
    }

    fun delete(context: Context, uri: Uri) {
        runCatching {
            if (uri.scheme == "file") File(uri.path!!).delete() else context.contentResolver.delete(uri, null, null)
        }
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
