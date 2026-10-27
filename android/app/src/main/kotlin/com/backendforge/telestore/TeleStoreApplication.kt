package com.backendforge.telestore

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import com.backendforge.telestore.backup.BackupWorker
import com.backendforge.telestore.data.CrashReporter
import com.backendforge.telestore.transfers.TransferNotifications
import com.backendforge.telestore.data.AppContainer

class TeleStoreApplication : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        CrashReporter.install(this)
        container = AppContainer(this)
        TransferNotifications.createChannel(this)
        com.backendforge.telestore.notify.PhoneNotifications.createChannels(this)
        // Server notifications, offline folders and the low-space warning, every 15 minutes
        com.backendforge.telestore.notify.CheckWorker.schedule(this)
        // A vault file left from the last run (the app was closed while it was open)
        container.files.forgetVault()
        // Keep the photo backup scheduled (after an update or a restart)
        container.backup.settings.value.takeIf { it.enabled }?.let { BackupWorker.schedule(this, it) }
        SingletonImageLoader.setSafe { container.imageLoader }
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader = container.imageLoader
}
