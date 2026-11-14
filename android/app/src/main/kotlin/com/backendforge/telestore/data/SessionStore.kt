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

    /**
     * Forgets the token but keeps the server address. [byUser]: the person signed out (Telegram on
     * this phone ends too); false when the server ended the sign-in (an expired token, a password
     * change, a server-wide sign-out): Telegram stays signed in for when the same account comes back.
     */
    fun signedOut(byUser: Boolean = true) {
        val edit = prefs.edit().remove(KEY_TOKEN).remove(KEY_USER)
        val who = _state.value?.username ?: prefs.getString(KEY_USER, null)
        if (byUser || who == null) edit.remove(KEY_ENDED_BY_SERVER) else edit.putString(KEY_ENDED_BY_SERVER, who)
        edit.apply()
        endedByUser = byUser
        _state.value = null
    }

    /** How the last sign-in ended (see [signedOut]). */
    var endedByUser: Boolean = true
        private set

    /** The account whose sign-in the server ended, until someone signs in again (then cleared). */
    fun takeEndedByServer(): String? {
        val who = prefs.getString(KEY_ENDED_BY_SERVER, null)
        if (who != null) prefs.edit().remove(KEY_ENDED_BY_SERVER).apply()
        return who
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
        const val KEY_ENDED_BY_SERVER = "ended_by_server"
    }
}
