package com.backendforge.telestore.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode(val label: String) { SYSTEM("System"), LIGHT("Light"), DARK("Dark") }

/** Small app preferences (not secret, so plain SharedPreferences). */
class AppSettings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    private val _theme = MutableStateFlow(
        runCatching { ThemeMode.valueOf(prefs.getString(KEY_THEME, null) ?: "") }.getOrDefault(ThemeMode.SYSTEM),
    )
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

    fun setTheme(mode: ThemeMode) {
        prefs.edit().putString(KEY_THEME, mode.name).apply()
        _theme.value = mode
    }

    /** Videos keep playing (sound only) when the app is left or the screen turns off. */
    var videoBackgroundPlay: Boolean
        get() = prefs.getBoolean(KEY_BG_PLAY, true)
        set(value) = prefs.edit().putBoolean(KEY_BG_PLAY, value).apply()

    /** Look up lyrics on LRCLIB when the song has none (sends only title, artist and length). */
    var onlineLyrics: Boolean
        get() = prefs.getBoolean(KEY_ONLINE_LYRICS, true)
        set(value) = prefs.edit().putBoolean(KEY_ONLINE_LYRICS, value).apply()

    /** Vibration on long-press, swipes and PIN keys. */
    var haptics: Boolean
        get() = prefs.getBoolean(KEY_HAPTICS, true)
        set(value) = prefs.edit().putBoolean(KEY_HAPTICS, value).apply()

    /** Ask for fingerprint, face or the phone's PIN when coming back to the app. */
    var appLock: Boolean
        get() = prefs.getBoolean(KEY_APP_LOCK, false)
        set(value) = prefs.edit().putBoolean(KEY_APP_LOCK, value).apply()

    /** How long the app may stay in the background before it locks. */
    var appLockAfterSeconds: Int
        get() = prefs.getInt(KEY_APP_LOCK_AFTER, 30)
        set(value) = prefs.edit().putInt(KEY_APP_LOCK_AFTER, value).apply()

    /** Storage used, as last seen (for the home-screen widget). */
    var lastStorageLine: String?
        get() = prefs.getString(KEY_STORAGE_LINE, null)
        set(value) = prefs.edit().putString(KEY_STORAGE_LINE, value).apply()

    /** When the app last looked for an update (it checks at most once a day by itself). */
    var lastUpdateCheck: Long
        get() = prefs.getLong(KEY_UPDATE_CHECK, 0)
        set(value) = prefs.edit().putLong(KEY_UPDATE_CHECK, value).apply()

    private companion object {
        const val KEY_THEME = "theme"
        const val KEY_UPDATE_CHECK = "last_update_check"
        const val KEY_BG_PLAY = "video_background_play"
        const val KEY_ONLINE_LYRICS = "online_lyrics"
        const val KEY_HAPTICS = "haptics"
        const val KEY_APP_LOCK = "app_lock"
        const val KEY_APP_LOCK_AFTER = "app_lock_after"
        const val KEY_STORAGE_LINE = "storage_line"
    }
}
