package com.backendforge.telestore.notify

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.backendforge.telestore.TeleStoreApplication
import com.backendforge.telestore.core.NotificationKind
import com.backendforge.telestore.core.NotificationRules
import com.backendforge.telestore.core.NotificationTarget
import com.backendforge.telestore.core.OfflineSync
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.transfers.OfflineFiles
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit

/**
 * What the app does every 15 minutes in the background (Android's shortest interval), and every
 * 30 seconds while it's open: shows new server notifications, keeps offline folders up to date
 * and warns when the phone is low on space.
 */
class CheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as TeleStoreApplication).container
        if (container.session.state.value == null) return Result.success()
        runCatching { Checks.notifications(container) }
        runCatching { container.offlineFolders.syncAll(container.api()) }
        Checks.space(container)
        return Result.success()
    }

    companion object {
        private const val NAME = "telestore-check"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CheckWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}

object Checks {
    private val checking = Mutex()

    /**
     * Shows the server notifications that came since the last check. The very first check only
     * remembers where things stand, so an old list doesn't arrive all at once.
     */
    suspend fun notifications(container: AppContainer) = checking.withLock {
        val settings = container.settings
        val seen = settings.lastNotificationSeen
        val list = container.api().notifications(after = seen)
        if (seen != null) {
            val show = NotificationRules.toShow(list.items, settings.notificationsOff)
            if (show.isNotEmpty()) PhoneNotifications.showServer(container.context, show, NotificationRules.MAX_SHOWN)
        }
        settings.lastNotificationSeen = NotificationRules.nextSeen(seen, list)
        container.unreadNotifications.value = list.unread
    }

    /** Warns at most once a day when less than 1 GB is free and something is kept offline. */
    fun space(container: AppContainer) {
        val context = container.context
        val free = OfflineFiles.freeBytes(context)
        val settings = container.settings
        if (free >= OfflineSync.LOW_SPACE_BYTES || OfflineFiles.usedBytes(context) == 0L) return
        if (System.currentTimeMillis() - settings.lastLowSpaceWarning < TimeUnit.DAYS.toMillis(1)) return
        settings.lastLowSpaceWarning = System.currentTimeMillis()
        PhoneNotifications.show(
            context, NotificationKind.OFFLINE, "Phone almost full",
            "Only ${formatBytes(free)} free. Remove some offline files to make space.", key = "low-space",
            target = NotificationTarget("offline"),
        )
    }
}
