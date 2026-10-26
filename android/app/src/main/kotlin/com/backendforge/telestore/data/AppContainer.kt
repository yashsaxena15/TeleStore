package com.backendforge.telestore.data

import android.content.Context
import com.backendforge.telestore.core.ServerAddress
import com.backendforge.telestore.core.TeleStoreApi
import okhttp3.HttpUrl

/** The app's shared objects, made once in [com.backendforge.telestore.TeleStoreApplication]. */
class AppContainer(context: Context) {
    val session = SessionStore(context.applicationContext)

    private var cached: TeleStoreApi? = null

    /** The API for the signed-in server; a 401 anywhere signs the app out. */
    fun api(): TeleStoreApi {
        val server = session.state.value?.server ?: session.lastServer
        val base = ServerAddress.normalize(server) ?: ServerAddress.normalize(ServerAddress.DEFAULT)!!
        cached?.takeIf { it.baseUrl == base }?.let { return it }
        return apiFor(base).also { cached = it }
    }

    /** An API for a server typed on the sign-in screen (before anyone is signed in). */
    fun apiFor(base: HttpUrl): TeleStoreApi =
        TeleStoreApi(base, token = { session.state.value?.token }, onUnauthorized = { session.signedOut() })
}
