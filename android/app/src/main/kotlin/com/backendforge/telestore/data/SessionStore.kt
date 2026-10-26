package com.backendforge.telestore.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.backendforge.telestore.core.ServerAddress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Who is signed in, to which server. */
data class Session(val server: String, val username: String, val token: String)

/**
 * Keeps the session in encrypted storage on the phone (the token is as good as a password),
 * plus the last server address so the sign-in screen can offer it again.
 */
class SessionStore(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "telestore_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val _state = MutableStateFlow(read())
    val state: StateFlow<Session?> = _state.asStateFlow()

    val lastServer: String get() = prefs.getString(KEY_SERVER, null) ?: ServerAddress.DEFAULT

    fun signedIn(session: Session) {
        prefs.edit()
            .putString(KEY_SERVER, session.server)
            .putString(KEY_USER, session.username)
            .putString(KEY_TOKEN, session.token)
            .apply()
        _state.value = session
    }

    /** Forgets the token but keeps the server address. */
    fun signedOut() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_USER).apply()
        _state.value = null
    }

    private fun read(): Session? {
        val server = prefs.getString(KEY_SERVER, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        return Session(server, prefs.getString(KEY_USER, null).orEmpty(), token)
    }

    private companion object {
        const val KEY_SERVER = "server"
        const val KEY_USER = "username"
        const val KEY_TOKEN = "token"
    }
}
