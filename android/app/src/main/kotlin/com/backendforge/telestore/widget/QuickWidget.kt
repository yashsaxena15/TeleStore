package com.backendforge.telestore.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.backendforge.telestore.MainActivity
import com.backendforge.telestore.R
import com.backendforge.telestore.TeleStoreApplication

/**
 * The home-screen widget: storage used (as last seen in the app, so the widget never goes online
 * itself) and buttons for Upload, Add link, Photos and Search that open the app there.
 */
class QuickWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val views = views(context)
        ids.forEach { manager.updateAppWidget(it, views) }
    }

    companion object {
        const val ACTION_PREFIX = "com.backendforge.telestore.widget."

        private fun views(context: Context): RemoteViews {
            val storage = (context.applicationContext as? TeleStoreApplication)?.container?.settings?.lastStorageLine
            return RemoteViews(context.packageName, R.layout.widget_quick).apply {
                setTextViewText(R.id.widget_storage, storage.orEmpty())
                setOnClickPendingIntent(R.id.widget_header, open(context, null, 0))
                setOnClickPendingIntent(R.id.widget_upload, open(context, "upload", 1))
                setOnClickPendingIntent(R.id.widget_link, open(context, "link", 2))
                setOnClickPendingIntent(R.id.widget_photos, open(context, "photos", 3))
                setOnClickPendingIntent(R.id.widget_search, open(context, "search", 4))
            }
        }

        private fun open(context: Context, action: String?, code: Int): PendingIntent {
            val intent = Intent(context, MainActivity::class.java)
                .setAction(action?.let { ACTION_PREFIX + it } ?: Intent.ACTION_MAIN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        /** Shows the latest storage figure on every TeleStore widget. */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, QuickWidget::class.java))
            if (ids.isNotEmpty()) {
                val views = views(context)
                ids.forEach { manager.updateAppWidget(it, views) }
            }
        }
    }
}
