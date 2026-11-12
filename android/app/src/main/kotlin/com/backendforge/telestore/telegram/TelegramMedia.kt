package com.backendforge.telestore.telegram

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.backendforge.telestore.core.DirectLocation
import com.backendforge.telestore.core.DownloadTarget
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentHashMap

/**
 * Your own files straight from Telegram: the player, the music service and downloads read them from
 * the storage channel with the phone's own Telegram account. The server only says which messages
 * hold a file (/direct/locate). Anything that can't come that way (files shared with you, the
 * Private Vault, a Telegram problem) comes from the TeleStore server, as before.
 */
class TelegramFiles(private val container: AppContainer) {
    private val places = ConcurrentHashMap<String, Pair<Long, DirectLocation>>()
    private val failed = ConcurrentHashMap.newKeySet<String>()

    /** The file id in a TeleStore address for one of your files (/dl/<name>?file_id=…), when it may come straight. */
    fun fileIdIn(uri: Uri): String? {
        if (!container.telegramDirect) return null
        val base = runCatching { container.api().baseUrl }.getOrNull() ?: return null
        if (uri.host != base.host || uri.pathSegments.firstOrNull() != "dl") return null
        return uri.getQueryParameter("file_id")?.takeIf { it.isNotBlank() && it !in failed }
    }

    suspend fun locate(fileId: String): DirectLocation {
        places[fileId]?.let { (at, loc) -> if (System.currentTimeMillis() - at < 10 * 60_000) return loc }
        val loc = container.api().directLocate(fileId)
        places[fileId] = System.currentTimeMillis() to loc
        return loc
    }

    /** A file was played: Telegram's own copies on the phone are kept under 1 GB. */
    fun played() = container.telegram.trimCache()

    /** This file couldn't come straight from Telegram: it comes through TeleStore from now on. */
    fun markFailed(fileId: String) {
        failed += fileId
    }

    /** Bytes [from, from + length) of a file, from its parts' messages. */
    suspend fun read(loc: DirectLocation, from: Long, length: Long): ByteArray {
        val spans = loc.spans(from, length)
        if (spans.size == 1) {
            val s = spans[0]
            return container.telegram.readPart(s.place.chatId, s.place.messageId, s.offset, s.length)
        }
        val out = java.io.ByteArrayOutputStream(length.toInt().coerceAtLeast(0))
        for (s in spans) out.write(container.telegram.readPart(s.place.chatId, s.place.messageId, s.offset, s.length))
        return out.toByteArray()
    }

    /** Downloads one of your files straight from Telegram into [target], continuing after what it already has. */
    suspend fun download(fileId: String, target: DownloadTarget, onProgress: (Long, Long) -> Unit): Long = withContext(Dispatchers.IO) {
        val loc = locate(fileId)
        var done = target.length().coerceAtMost(loc.size)
        target.open(append = done > 0).use { out ->
            while (done < loc.size) {
                val n = minOf(DOWNLOAD_WINDOW, loc.size - done)
                out.write(read(loc, done, n)) // Telegram keeps fetching ahead while this is written
                done += n
                onProgress(done, loc.size)
            }
        }
        container.telegram.trimCache()
        loc.size
    }

    companion object {
        const val WINDOW = 1L shl 20  // what the player reads at a time (Telegram fetches 16 MB ahead)
        const val DOWNLOAD_WINDOW = 4L shl 20
    }
}

/** A player's data source: your own files straight from Telegram, everything else over the network as before. */
@OptIn(UnstableApi::class)
class DirectOrHttpDataSource(private val files: TelegramFiles, private val http: DataSource) : DataSource {
    class Factory(private val files: TelegramFiles, private val http: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = DirectOrHttpDataSource(files, http.createDataSource())
    }

    private val listeners = mutableListOf<TransferListener>()
    private var spec: DataSpec? = null
    private var loc: DirectLocation? = null
    private var fileId: String? = null
    private var pos = 0L
    private var end = 0L
    private var window: ByteArray? = null
    private var windowStart = 0L

    override fun addTransferListener(transferListener: TransferListener) {
        http.addTransferListener(transferListener)
        listeners += transferListener
    }

    override fun open(dataSpec: DataSpec): Long {
        val id = files.fileIdIn(dataSpec.uri)
        val found = id?.let {
            try {
                runBlocking { files.locate(it) }
            } catch (e: Exception) {
                // The player stopped this read (a seek, or leaving): not a reason to use TeleStore
                if (cancelled(e)) throw InterruptedIOException("Stopped")
                android.util.Log.w("TeleStore", "Playing $it through TeleStore: ${e.message}")
                null
            }
        }
        if (id == null || found == null) return http.open(dataSpec)
        if (dataSpec.position > found.size) throw IOException("Past the end of the file")
        spec = dataSpec
        loc = found
        fileId = id
        pos = dataSpec.position
        end = if (dataSpec.length == C.LENGTH_UNSET.toLong()) found.size else minOf(found.size, dataSpec.position + dataSpec.length)
        window = null
        listeners.forEach { it.onTransferInitializing(this, dataSpec, true) }
        listeners.forEach { it.onTransferStart(this, dataSpec, true) }
        return end - pos
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        val location = loc ?: return http.read(buffer, offset, length)
        if (length == 0) return 0
        if (pos >= end) return C.RESULT_END_OF_INPUT
        var w = window
        if (w == null || pos < windowStart || pos >= windowStart + w.size) {
            val n = minOf(TelegramFiles.WINDOW, end - pos)
            w = try {
                runBlocking { files.read(location, pos, n) }
            } catch (e: Exception) {
                // The player stopped this read (a seek, resuming, or leaving): the file stays on Telegram
                if (cancelled(e)) throw InterruptedIOException("Stopped")
                android.util.Log.w("TeleStore", "Playing $fileId through TeleStore from now on: Telegram failed at byte $pos", e)
                fileId?.let(files::markFailed) // the next try comes through TeleStore
                throw IOException(e.message ?: "Telegram didn't send the file", e)
            }
            if (w.isEmpty()) throw IOException("Telegram sent no data")
            window = w
            windowStart = pos
        }
        val from = (pos - windowStart).toInt()
        val n = minOf(length, w.size - from, (end - pos).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        System.arraycopy(w, from, buffer, offset, n)
        pos += n
        spec?.let { s -> listeners.forEach { it.onBytesTransferred(this, s, true, n) } }
        return n
    }

    /** The player interrupts its loading thread to stop a read; that isn't Telegram failing. */
    private fun cancelled(e: Throwable): Boolean =
        e is InterruptedException || e is InterruptedIOException || e is kotlinx.coroutines.CancellationException ||
            Thread.currentThread().isInterrupted || e.cause?.let { it is InterruptedException || it is kotlinx.coroutines.CancellationException } == true

    override fun getUri(): Uri? = spec?.uri ?: http.uri

    override fun getResponseHeaders(): Map<String, List<String>> = if (loc != null) emptyMap() else http.responseHeaders

    override fun close() {
        if (loc != null) {
            files.played()
            spec?.let { s -> listeners.forEach { it.onTransferEnd(this, s, true) } }
            loc = null
            spec = null
            window = null
        } else {
            http.close()
        }
    }
}
