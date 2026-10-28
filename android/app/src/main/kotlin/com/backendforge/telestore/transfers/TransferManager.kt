package com.backendforge.telestore.transfers

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.TeleStoreApi
import java.util.concurrent.TimeUnit

/**
 * Starts, pauses and cancels the phone's uploads and downloads. Each one is a WorkManager job,
 * so it keeps going with the screen off, survives the app being closed, and waits for a connection.
 */
class TransferManager(private val context: Context) {
    val store = TransferStore(context)
    private val work get() = WorkManager.getInstance(context)

    /** Uploads [files] into [folder]. Returns the names that couldn't be queued (unknown size, empty). */
    fun upload(files: List<PickedFile>, folder: String): List<String> {
        val skipped = mutableListOf<String>()
        val transfers = files.mapNotNull { f ->
            if (f.size <= 0) {
                skipped += f.name
                return@mapNotNull null
            }
            // Keep access to the file after the picker closes, when the app that owns it allows that
            runCatching { context.contentResolver.takePersistableUriPermission(f.uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            PhoneTransfer(direction = Direction.UPLOAD, name = f.name, size = f.size, sourceUri = f.uri.toString(), folder = folder)
        }
        store.add(transfers)
        transfers.forEach { enqueue(it) }
        return skipped
    }

    fun download(item: FileItem) {
        val transfer = PhoneTransfer(direction = Direction.DOWNLOAD, name = item.name, size = item.size ?: 0, fileId = item.id)
        store.add(listOf(transfer))
        enqueue(transfer)
    }

    /**
     * Keeps [items] on the phone for offline use (inside the app, not in Downloads); [folder] is the
     * folder kept offline that they belong to. Files already kept are skipped. Returns how many were queued.
     */
    fun saveOffline(items: List<FileItem>, folder: String? = null): Int {
        val kept = store.items.value.filter { it.offline && (it.status == TransferStatus.DONE || !it.status.finished) }.mapNotNull { it.fileId }.toSet()
        val transfers = items.filter { !it.isFolder && it.id !in kept }.map {
            PhoneTransfer(direction = Direction.DOWNLOAD, name = it.name, size = it.size ?: 0, fileId = it.id, offline = true, offlineFolder = folder)
        }
        store.add(transfers)
        transfers.forEach { enqueue(it) }
        return transfers.size
    }

    /** Deletes the offline copies of these server files (and stops ones still downloading). */
    fun removeOffline(fileIds: Set<String>) {
        val rows = store.items.value.filter { it.offline && it.fileId in fileIds }
        rows.forEach { row ->
            work.cancelUniqueWork(workName(row.id))
            row.localUri?.let { OfflineFiles.delete(Uri.parse(it)) }
        }
        store.remove(rows.map { it.id }.toSet())
    }

    /** Every offline copy goes (signing out). */
    fun clearOffline() {
        removeOffline(store.items.value.filter { it.offline }.mapNotNull { it.fileId }.toSet())
        OfflineFiles.clear(context)
    }

    /** Any file the server offers at [remotePath] (e.g. a Google Drive file it fetches for us). */
    fun downloadRemote(name: String, size: Long, remotePath: String) {
        val transfer = PhoneTransfer(direction = Direction.DOWNLOAD, name = name, size = size, remotePath = remotePath)
        store.add(listOf(transfer))
        enqueue(transfer)
    }

    /** A folder comes down as ZIP files of up to 2 GB (what the server makes of it). */
    suspend fun downloadFolder(api: TeleStoreApi, folderPath: String): Int {
        val info = api.folderDownloadInfo(folderPath)
        val transfers = info.parts.map { part ->
            PhoneTransfer(direction = Direction.DOWNLOAD, name = part.name, size = part.size, remotePath = part.downloadUrl)
        }
        store.add(transfers)
        transfers.forEach { enqueue(it) }
        return info.totalFiles
    }

    fun pause(id: String) {
        store.update(id) { if (it.status.finished) it else it.copy(status = TransferStatus.PAUSED, speedBps = 0) }
        work.cancelUniqueWork(workName(id))
    }

    fun resume(id: String) {
        val t = store.get(id) ?: return
        store.update(id) { it.copy(status = TransferStatus.QUEUED, error = null) }
        enqueue(t)
    }

    /** Retry starts a failed one again, continuing where it stopped when possible. */
    fun retry(id: String) = resume(id)

    fun cancel(id: String) {
        val t = store.get(id) ?: return
        store.update(id) { if (it.status == TransferStatus.DONE) it else it.copy(status = TransferStatus.CANCELLED, speedBps = 0) }
        work.cancelUniqueWork(workName(id))
        if (t.direction == Direction.DOWNLOAD && t.status != TransferStatus.DONE) {
            t.localUri?.let { DownloadFiles.delete(context, Uri.parse(it)) }
        }
        // A cancelled offline save leaves nothing behind
        if (t.offline) store.remove(setOf(id))
    }

    /**
     * Clears finished rows from the list. A finished download of a TeleStore file is only hidden:
     * the app still needs it to know the file is on the phone (the file stays in Downloads).
     */
    fun clearFinished() {
        val finished = store.items.value.filter { it.status.finished && it.listed }
        val keep = finished.filter { it.status == TransferStatus.DONE && it.direction == Direction.DOWNLOAD && it.fileId != null }.map { it.id }.toSet()
        store.remove(finished.map { it.id }.toSet() - keep)
        keep.forEach { id -> store.update(id) { it.copy(hidden = true) } }
    }

    private fun enqueue(t: PhoneTransfer) {
        val request: OneTimeWorkRequest = when (t.direction) {
            Direction.UPLOAD -> OneTimeWorkRequestBuilder<UploadWorker>()
            Direction.DOWNLOAD -> OneTimeWorkRequestBuilder<DownloadWorker>()
        }
            .setInputData(workDataOf(TransferWorker.KEY_ID to t.id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .addTag(TAG)
            .build()
        work.enqueueUniqueWork(workName(t.id), ExistingWorkPolicy.REPLACE, request)
    }

    private fun workName(id: String) = "transfer-$id"

    private companion object {
        const val TAG = "telestore-transfer"
    }
}
