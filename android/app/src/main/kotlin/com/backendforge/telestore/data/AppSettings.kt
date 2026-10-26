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
    }
}
