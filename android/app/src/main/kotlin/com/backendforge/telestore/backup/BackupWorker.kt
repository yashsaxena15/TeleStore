package com.backendforge.telestore.backup

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.backendforge.telestore.MainActivity
import com.backendforge.telestore.TeleStoreApplication
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.ChunkedUploader
import com.backendforge.telestore.core.NetworkException
import com.backendforge.telestore.core.UnauthorizedException
import com.backendforge.telestore.transfers.TransferNotifications
import com.backendforge.telestore.transfers.UriChunkSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.TimeUnit

/**
 * Backs up the phone's photos and videos, one at a time, newest first: each album into its own
 * folder under the destination, skipping anything already backed up (remembered here, or a file
 * of the same name and size already in that folder on the server).
 */
class BackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val container get() = (applicationContext as TeleStoreApplication).container
    private val store get() = container.backup

    override suspend fun doWork(): Result {
        // The periodic run, the "new photo" run and "back up now" must never upload side by side
        if (!running.tryLock()) return Result.success()
        return try {
            backUp()
        } finally {
            running.unlock()
        }
    }

    private suspend fun backUp(): Result {
        val settings = store.settings.value
        if (!settings.enabled || container.session.state.value == null) return Result.success()
        if (!PhoneMedia.canRead(applicationContext)) {
            store.status { it.copy(running = false, message = "Allow TeleStore to see your photos to back them up.") }
            return Result.success()
        }
        val albums = settings.albums.ifEmpty {
            PhoneMedia.cameraAlbum(PhoneMedia.albums(applicationContext))?.let { setOf(it) } ?: emptySet()
        }
        val todo = PhoneMedia.scan(applicationContext, settings.includeVideos)
            .filter { it.bucketId in albums && !store.isBackedUp(it.key) }
        if (todo.isEmpty()) {
            store.status { it.copy(running = false, pending = 0, current = null, lastRun = System.currentTimeMillis(), message = null) }
            return Result.success()
        }

        val api = container.api()
        val onServer = mutableMapOf<String, Set<String>>() // folder -> "name|size" already there
        var done = 0
        store.status { it.copy(running = true, pending = todo.size, done = 0, message = null) }
        return try {
            for (item in todo) {
                val folder = settings.destination.trimEnd('/') + "/" + safeName(item.bucket)
                val existing = onServer.getOrPut(folder) {
                    api.createFolderPath(folder)
                    serverNames(folder)
                }
                store.status { it.copy(current = item.name, pending = todo.size - done) }
                notify(done, todo.size, item.name)
                if ("${item.name}|${item.size}" !in existing) {
                    UriChunkSource(applicationContext, item.uri).use { source ->
                        ChunkedUploader(api, source, item.name, item.size, folder, takenAt = item.takenIso).upload()
                    }
                }
                store.markBackedUp(item.key)
                done++
                store.status { it.copy(done = done, pending = todo.size - done) }
            }
            store.status { it.copy(running = false, pending = 0, current = null, lastRun = System.currentTimeMillis(), message = null) }
            Result.success()
        } catch (e: CancellationException) {
            // Wi-Fi or charging went away, or the system stopped it: it continues next time
            store.status { it.copy(running = false, current = null, message = "Paused · ${todo.size - done} left") }
            throw e
        } catch (e: UnauthorizedException) {
            store.status { it.copy(running = false, current = null, message = "Signed out. Sign in to continue the backup.") }
            Result.success()
        } catch (e: NetworkException) {
            store.status { it.copy(running = false, current = null, message = "Waiting for the connection · ${todo.size - done} left") }
            Result.retry()
        } catch (e: Exception) {
            store.status { it.copy(running = false, current = null, message = (e as? ApiException)?.message ?: "Backup stopped: ${e.message}") }
            Result.retry()
        }
    }

    private suspend fun serverNames(folder: String): Set<String> {
        val names = mutableSetOf<String>()
        var page = 1
        while (true) {
            val res = container.api().listFiles(path = folder, page = page, pageSize = 500)
            res.files.forEach { names += "${it.name}|${it.size}" }
            if (res.pagination?.hasNext != true) break
            page++
        }
        return names
    }

    private fun safeName(album: String) = album.replace(Regex("""[\\/:*?"<>|]"""), "_").trim().ifEmpty { "Other" }

    private suspend fun notify(done: Int, total: Int, name: String) {
        val open = PendingIntent.getActivity(
            applicationContext, 3, Intent(applicationContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(applicationContext, TransferNotifications.CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Backing up photos · ${done + 1} of $total")
            .setContentText(name)
            .setProgress(total, done, false)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .build()
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(NOTIFICATION_ID, notification)
        runCatching { setForeground(info) }
    }

    companion object {
        private val running = Mutex()
        private const val NOTIFICATION_ID = 7_001
        private const val PERIODIC = "photo-backup"
        private const val NOW = "photo-backup-now"
        private const val ON_NEW = "photo-backup-new-media"

        /** Starts (or stops) the backup to match [settings]: now, every 15 min, and when new photos appear. */
        fun schedule(context: Context, settings: BackupSettings) {
            val work = WorkManager.getInstance(context)
            if (!settings.enabled) {
                listOf(PERIODIC, NOW, ON_NEW).forEach { work.cancelUniqueWork(it) }
                return
            }
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (settings.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(settings.chargingOnly)
                .build()
            work.enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<BackupWorker>().setConstraints(constraints).build())
            work.enqueueUniquePeriodicWork(
                PERIODIC, ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<BackupWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build(),
            )
            watchNewMedia(context, settings)
        }

        /** Runs again as soon as the phone saves a new photo or video. */
        fun watchNewMedia(context: Context, settings: BackupSettings) {
            if (!settings.enabled) return
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (settings.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(settings.chargingOnly)
                .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
                .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
                .setTriggerContentUpdateDelay(10, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                ON_NEW, ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<BackupTriggerWorker>().setConstraints(constraints).build(),
            )
        }

        fun runNow(context: Context, settings: BackupSettings) {
            if (!settings.enabled) return
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (settings.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(settings.chargingOnly)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<BackupWorker>().setConstraints(constraints).build())
        }
    }
}

/** Fired by a new photo or video: runs the backup, then waits for the next one. */
class BackupTriggerWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as TeleStoreApplication).container
        val settings = container.backup.settings.value
        BackupWorker.runNow(applicationContext, settings)
        BackupWorker.watchNewMedia(applicationContext, settings)
        return Result.success()
    }
}
