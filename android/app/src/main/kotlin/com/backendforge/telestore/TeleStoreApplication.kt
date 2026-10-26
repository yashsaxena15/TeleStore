package com.backendforge.telestore

import android.app.Application
import com.backendforge.telestore.data.AppContainer

class TeleStoreApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
