package com.backendforge.telestore.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.backendforge.telestore.MainActivity
import com.backendforge.telestore.TeleStoreApplication
import com.backendforge.telestore.core.NotificationKind
import com.backendforge.telestore.core.NotificationTarget
import com.backendforge.telestore.core.ServerNotification

/**
 * The notifications that tell the user something finished, failed or arrived (not the ongoing
 * progress ones, see TransferNotifications). Each kind can be switched off in Settings ›
 * Notifications; tapping one opens the right place in the app.
 */
object PhoneNotifications {
    /** Things the user started: uploads, downloads, offline saves, server transfers. */
    const val CHANNEL_ACTIVITY = "activity"
    /** The account: sign-ins, storage, backup problems, Telegram Inbox. */
    const val CHANNEL_ACCOUNT = "account"

    const val EXTRA_TARGET_TYPE = "telestore.target_type"
    const val EXTRA_TARGET_PATH = "telestore.target_path"
    const val EXTRA_SERVER_ID = "telestore.notification_id"

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ACTIVITY, "Finished and failed", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Uploads, downloads, offline files and server transfers that finished or failed"
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ACCOUNT, "Account", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "New sign-ins, storage, photo backup and the Telegram Inbox"
            },
        )
    }

    /** False when the user switched this kind off, or the phone doesn't allow notifications. */
    fun allowed(context: Context, kind: NotificationKind?): Boolean {
        if (kind != null && kind.wire in settings(context).notificationsOff) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** Shows one notification; the same [key] replaces the earlier one instead of adding another. */
    fun show(
        context: Context,
        kind: NotificationKind?,
        title: String,
        body: String,
        key: String,
        target: NotificationTarget? = null,
        serverId: String? = null,
    ) {
        if (!allowed(context, kind)) return
        val channel = when (kind) {
            NotificationKind.SIGN_IN, NotificationKind.STORAGE, NotificationKind.BACKUP, NotificationKind.INBOX -> CHANNEL_ACCOUNT
            else -> CHANNEL_ACTIVITY
        }
        val id = key.hashCode()
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(icon(kind))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, id, target, serverId))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // The permission was taken away a moment ago
        }
    }

    /** Server notifications from a check, at most [com.backendforge.telestore.core.NotificationRules.MAX_SHOWN] apart. */
    fun showServer(context: Context, items: List<ServerNotification>, max: Int) {
        val separate = if (items.size > max) items.takeLast(max - 1) else items
        if (items.size > max) {
            show(context, null, "${items.size - separate.size} more notifications", "Open TeleStore to see them all.", "server-summary", NotificationTarget("notifications"))
        }
        separate.forEach { show(context, NotificationKind.of(it.kind), it.title, it.body, "server-${it.id}", it.target, it.id) }
    }

    private fun openIntent(context: Context, requestCode: Int, target: NotificationTarget?, serverId: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_TARGET_TYPE, target?.type ?: "notifications")
            .apply { target?.path?.let { putExtra(EXTRA_TARGET_PATH, it) } }
            .apply { serverId?.let { putExtra(EXTRA_SERVER_ID, it) } }
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun icon(kind: NotificationKind?): Int = when (kind) {
        NotificationKind.PHONE_TRANSFERS, NotificationKind.OFFLINE, NotificationKind.TRANSFER,
        NotificationKind.MEDIA, NotificationKind.INSTAGRAM, NotificationKind.PLAYLIST_SYNC -> android.R.drawable.stat_sys_download_done
        NotificationKind.STORAGE, NotificationKind.BACKUP -> android.R.drawable.stat_notify_error
        else -> android.R.drawable.ic_dialog_info
    }

    private fun settings(context: Context) = (context.applicationContext as TeleStoreApplication).container.settings
}
