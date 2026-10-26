package com.backendforge.telestore.transfers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import com.backendforge.telestore.MainActivity
import com.backendforge.telestore.ui.components.formatBytes

object TransferNotifications {
    const val CHANNEL = "transfers"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL, "Uploads and downloads", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Progress of files moving between this phone and TeleStore"
                setShowBadge(false)
            }
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    /** The ongoing notification that keeps a transfer running with the screen off or the app closed. */
    fun foreground(context: Context, transfer: PhoneTransfer, saving: Boolean = false): ForegroundInfo {
        val verb = if (transfer.direction == Direction.UPLOAD) "Uploading" else "Downloading"
        val text = when {
            saving -> "Saving to Telegram…"
            transfer.size > 0 -> "${formatBytes(transfer.done)} of ${formatBytes(transfer.size)}"
            else -> formatBytes(transfer.done)
        }
        val open = PendingIntent.getActivity(
            context, 1, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(if (transfer.direction == Direction.UPLOAD) android.R.drawable.stat_sys_upload else android.R.drawable.stat_sys_download)
            .setContentTitle("$verb ${transfer.name}")
            .setContentText(text)
            .setProgress(100, (transfer.progress * 100).toInt(), saving || transfer.size <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open)
            .build()
        val id = transfer.id.hashCode()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(id, notification)
        }
    }
}
