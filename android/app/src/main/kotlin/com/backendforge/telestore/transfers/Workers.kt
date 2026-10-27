package com.backendforge.telestore.transfers

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.backendforge.telestore.TeleStoreApplication
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.ChunkedUploader
import com.backendforge.telestore.core.NetworkException
import com.backendforge.telestore.core.ResumableDownloader
import com.backendforge.telestore.core.NotificationKind
import com.backendforge.telestore.core.NotificationTarget
import com.backendforge.telestore.core.OfflineSync
import com.backendforge.telestore.core.UnauthorizedException
import com.backendforge.telestore.notify.PhoneNotifications
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/** At most two transfers move at once; the rest wait their turn. */
internal val transferSlots = Semaphore(2)

/** Shared by both workers: progress, status and the ongoing notification. */
abstract class TransferWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    protected val container get() = (applicationContext as TeleStoreApplication).container
    protected val store get() = container.transfers.store
    protected val transferId: String get() = inputData.getString(KEY_ID).orEmpty()

    final override suspend fun doWork(): Result {
        val start = store.get(transferId) ?: return Result.success()
        if (start.status.finished || start.status == TransferStatus.PAUSED) return Result.success()
        if (container.session.state.value == null) {
            store.update(transferId) { it.copy(status = TransferStatus.FAILED, error = "Signed out.") }
            return Result.success()
        }
        return try {
            transferSlots.withPermit {
                store.update(transferId) { it.copy(status = TransferStatus.RUNNING, error = null) }
                showForeground(saving = false)
                val current = store.get(transferId) ?: return@withPermit
                tracked { run(current) }
            }
            store.get(transferId)?.takeIf { it.status == TransferStatus.DONE }?.let { finished(it, failed = false) }
            Result.success()
        } catch (e: CancellationException) {
            // Paused or cancelled by the user (already recorded), or stopped by Android: then it runs again later
            store.update(transferId) { if (it.status == TransferStatus.RUNNING || it.status == TransferStatus.SAVING) it.copy(status = TransferStatus.QUEUED, speedBps = 0) else it }
            throw e
        } catch (e: UnauthorizedException) {
            fail("Signed out. Sign in and try again.")
        } catch (e: NetworkException) {
            // No connection: wait and try again (WorkManager waits for the network)
            store.update(transferId) { it.copy(status = TransferStatus.QUEUED, error = "Waiting for the connection…", speedBps = 0) }
            if (runAttemptCount < 20) Result.retry() else fail(e.message ?: "The connection kept failing.")
        } catch (e: ApiException) {
            fail(e.message ?: "The server refused this transfer.")
        } catch (e: Exception) {
            fail(e.message ?: e.javaClass.simpleName)
        }
    }

    protected abstract suspend fun run(transfer: PhoneTransfer)

    private fun fail(message: String): Result {
        store.update(transferId) { it.copy(status = TransferStatus.FAILED, error = message, speedBps = 0) }
        store.get(transferId)?.let { finished(it, failed = true) }
        return Result.failure()
    }

    /** "Uploaded", "Downloaded", "Available offline" or what went wrong, as a phone notification. */
    private fun finished(t: PhoneTransfer, failed: Boolean) {
        val kind = if (t.offline) NotificationKind.OFFLINE else NotificationKind.PHONE_TRANSFERS
        // A folder kept offline brings many files: one quiet line per file would be too much
        if (t.offlineFolder != null && !failed) return
        val title = when {
            failed && t.offline -> "Couldn't save for offline"
            failed && t.direction == Direction.UPLOAD -> "Upload failed"
            failed -> "Download failed"
            t.offline -> "Available offline"
            t.direction == Direction.UPLOAD -> "Uploaded"
            else -> "Downloaded"
        }
        val body = if (failed) "${t.name}: ${t.error ?: "something went wrong"}" else t.name
        val target = when {
            failed -> NotificationTarget("transfers")
            t.offline -> NotificationTarget("offline")
            t.direction == Direction.UPLOAD -> NotificationTarget("folder", path = t.folder)
            else -> NotificationTarget("transfers")
        }
        PhoneNotifications.show(applicationContext, kind, title, body, key = "transfer-${t.id}", target = target)
    }

    /**
     * Runs [block] while a timer works out the speed from the stored progress every second and
     * refreshes the notification (the transfer callbacks only record bytes, from any thread).
     */
    protected suspend fun <T> tracked(block: suspend () -> T): T = coroutineScope {
        val ticker = launch {
            var lastDone = store.get(transferId)?.done ?: 0
            while (isActive) {
                delay(1_000)
                val now = store.get(transferId) ?: break
                val speed = (now.done - lastDone).coerceAtLeast(0)
                lastDone = now.done
                store.update(transferId, force = false) { it.copy(speedBps = speed) }
                showForeground(saving = now.status == TransferStatus.SAVING)
            }
        }
        try {
            block()
        } finally {
            ticker.cancel()
        }
    }

    protected suspend fun showForeground(saving: Boolean) {
        val transfer = store.get(transferId) ?: return
        // Android may refuse when the app is in the background; the transfer still runs
        runCatching { setForeground(TransferNotifications.foreground(applicationContext, transfer, saving)) }
    }

    companion object {
        const val KEY_ID = "transfer_id"
    }
}

class UploadWorker(context: Context, params: WorkerParameters) : TransferWorker(context, params) {
    override suspend fun run(transfer: PhoneTransfer) {
        val uri = Uri.parse(transfer.sourceUri ?: throw ApiException(0, "The file to upload is missing."))
        val folder = transfer.folder ?: "/Home"
        val source = try {
            UriChunkSource(applicationContext, uri)
        } catch (e: Exception) {
            throw ApiException(0, "This file can't be opened any more. Pick it again to upload it.")
        }
        val file = source.use {
            ChunkedUploader(
                api = container.api(),
                source = it,
                name = transfer.name,
                size = transfer.size,
                folder = folder,
                onSession = { id -> store.update(transferId) { t -> t.copy(uploadId = id) } },
                onProgress = { sent -> store.update(transferId, force = false) { t -> t.copy(done = sent) } },
                onSaving = { store.update(transferId) { t -> t.copy(status = TransferStatus.SAVING, done = t.size, speedBps = 0) } },
            ).upload(resumeId = transfer.uploadId)
        }
        store.update(transferId) { it.copy(status = TransferStatus.DONE, done = it.size, speedBps = 0, fileId = file?.id) }
        store.notifyUploaded(folder)
    }
}

class DownloadWorker(context: Context, params: WorkerParameters) : TransferWorker(context, params) {
    override suspend fun run(transfer: PhoneTransfer) {
        val api = container.api()
        val url = when {
            transfer.remotePath != null -> api.baseUrl.resolve(transfer.remotePath.removePrefix("/"))
            transfer.fileId != null -> api.media.file(
                com.backendforge.telestore.core.FileItem(id = transfer.fileId, name = transfer.name), inline = false,
            )
            else -> null
        } ?: throw ApiException(0, "Nothing to download.")

        if (transfer.offline && !OfflineSync.fits((transfer.size - transfer.done).coerceAtLeast(0), OfflineFiles.freeBytes(applicationContext))) {
            throw ApiException(0, "Not enough space on this phone.")
        }
        val localUri = transfer.localUri?.let(Uri::parse) ?: (
            if (transfer.offline) OfflineFiles.create(applicationContext, transfer.fileId ?: transfer.id, transfer.name)
            else DownloadFiles.create(applicationContext, transfer.name, mimeOf(transfer.name))
        ).also { created ->
            store.update(transferId) { it.copy(localUri = created.toString()) }
        }
        val result = ResumableDownloader(api.http).download(
            url = url,
            target = UriDownloadTarget(applicationContext, localUri, transfer.size),
            etag = transfer.etag,
            onProgress = { done, total -> store.update(transferId, force = false) { it.copy(done = done, size = if (total > 0) total else it.size) } },
            onEtag = { tag -> store.update(transferId) { it.copy(etag = tag) } },
        )
        store.update(transferId) { it.copy(etag = result.etag) }
        if (!transfer.offline) DownloadFiles.publish(applicationContext, localUri)
        store.update(transferId) { it.copy(status = TransferStatus.DONE, done = result.totalBytes, size = result.totalBytes, speedBps = 0) }
    }

    private fun mimeOf(name: String): String? =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
}
