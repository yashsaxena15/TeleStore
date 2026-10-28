package com.backendforge.telestore.transfers

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

enum class Direction { UPLOAD, DOWNLOAD }

enum class TransferStatus { QUEUED, RUNNING, SAVING, PAUSED, DONE, FAILED, CANCELLED;
    val finished: Boolean get() = this == DONE || this == FAILED || this == CANCELLED
}

/** One upload or download made on this phone. Kept in a small JSON file so it survives restarts. */
@Serializable
data class PhoneTransfer(
    val id: String = UUID.randomUUID().toString(),
    val direction: Direction,
    val name: String,
    val size: Long = 0,
    val done: Long = 0,
    val status: TransferStatus = TransferStatus.QUEUED,
    val error: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    // Uploads
    val sourceUri: String? = null,
    val folder: String? = null,
    val uploadId: String? = null,
    // Downloads
    val fileId: String? = null,
    /** A server path for folder ZIP parts (/folders/download-zip?…); null downloads [fileId]. */
    val remotePath: String? = null,
    val localUri: String? = null,
    val etag: String? = null,
    val speedBps: Long = 0,
    /** Kept for offline inside the app (not in Downloads); deleted on sign-out. */
    val offline: Boolean = false,
    /** The folder kept offline that brought this file, so it goes when the file leaves that folder. */
    val offlineFolder: String? = null,
    /** Cleared from the Transfers list, but its downloaded copy is still known (Offline label, playing it). */
    val hidden: Boolean = false,
) {
    /** Shown in Transfers › On this phone (finished offline saves live in Offline files instead). */
    val listed: Boolean get() = !hidden && !(offline && status == TransferStatus.DONE)
    val progress: Float get() = if (size > 0) (done.toFloat() / size).coerceIn(0f, 1f) else 0f
}

/**
 * The phone's transfers, as a [StateFlow] for the Transfers tab and the workers. Progress updates
 * are kept in memory and written to disk at most every 2 s (and on every status change).
 */
class TransferStore(context: Context) {
    private val file = File(context.filesDir, "transfers.json")
    private val json = Json { ignoreUnknownKeys = true }
    private val _items = MutableStateFlow(read())
    val items: StateFlow<List<PhoneTransfer>> = _items.asStateFlow()
    private var lastWrite = 0L

    private val _uploaded = MutableSharedFlow<String>(extraBufferCapacity = 16)
    /** Folders that just received an upload, so an open folder refreshes. */
    val uploaded: SharedFlow<String> = _uploaded.asSharedFlow()

    fun get(id: String): PhoneTransfer? = _items.value.firstOrNull { it.id == id }

    fun add(transfers: List<PhoneTransfer>) {
        _items.update { it + transfers }
        write(force = true)
    }

    fun update(id: String, force: Boolean = true, change: (PhoneTransfer) -> PhoneTransfer) {
        _items.update { list -> list.map { if (it.id == id) change(it) else it } }
        write(force)
    }

    fun remove(ids: Set<String>) {
        _items.update { list -> list.filterNot { it.id in ids } }
        write(force = true)
    }

    fun notifyUploaded(folder: String) {
        _uploaded.tryEmit(folder)
    }

    /** A finished download of this server file, if its local copy still exists. */
    fun offlineCopy(context: Context, fileId: String): Uri? {
        val item = _items.value.lastOrNull { it.fileId == fileId && it.remotePath == null && it.status == TransferStatus.DONE && it.localUri != null } ?: return null
        // A copy inside the app is handed out through the app's FileProvider (players, viewers, other apps)
        val uri = if (item.offline) OfflineFiles.shareable(context, Uri.parse(item.localUri)) ?: return null else Uri.parse(item.localUri)
        val exists = runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { true } ?: false }.getOrDefault(false)
        return if (exists) uri else null
    }

    /** Server files that have a downloaded copy on this phone (for the "Offline" label). */
    fun offlineIds(): Set<String> = _items.value
        .filter { it.status == TransferStatus.DONE && it.fileId != null && it.remotePath == null }
        .mapNotNull { it.fileId }.toSet()

    @Synchronized
    private fun write(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && now - lastWrite < 2_000) return
        lastWrite = now
        runCatching {
            val tmp = File(file.parentFile, "transfers.json.tmp")
            tmp.writeText(json.encodeToString(_items.value))
            tmp.renameTo(file)
        }
    }

    private fun read(): List<PhoneTransfer> = runCatching {
        json.decodeFromString<List<PhoneTransfer>>(file.readText())
    }.getOrDefault(emptyList()).map {
        // The app was closed mid-transfer: WorkManager runs it again, so show it as waiting
        if (it.status == TransferStatus.RUNNING || it.status == TransferStatus.SAVING) it.copy(status = TransferStatus.QUEUED, speedBps = 0) else it
    }
}
