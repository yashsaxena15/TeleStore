package com.backendforge.telestore

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import com.backendforge.telestore.transfers.TransferNotifications
import com.backendforge.telestore.data.AppContainer

class TeleStoreApplication : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        TransferNotifications.createChannel(this)
        SingletonImageLoader.setSafe { container.imageLoader }
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader = container.imageLoader
}
