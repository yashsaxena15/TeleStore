package com.backendforge.telestore.backup

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

@Serializable
data class BackupSettings(
    val enabled: Boolean = false,
    /** Phone albums (MediaStore bucket ids) to back up. Empty = Camera only, until chosen. */
    val albums: Set<String> = emptySet(),
    val includeVideos: Boolean = true,
    val wifiOnly: Boolean = true,
    val chargingOnly: Boolean = false,
    /** Server folder; each album goes in its own sub-folder. */
    val destination: String = "/Home/Phone Backup",
)

@Serializable
data class BackupStatus(
    val running: Boolean = false,
    val pending: Int = 0,
    val done: Int = 0,
    val current: String? = null,
    val lastRun: Long = 0,
    val message: String? = null,
)

/**
 * The backup's settings, live status, and the phone items already backed up (by MediaStore id,
 * size and modification time, so an edited photo counts as new). Kept in a small JSON file.
 */
class BackupStore(context: Context) {
    private val dir = File(context.filesDir, "backup").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true }

    private val _settings = MutableStateFlow(read("settings.json") ?: BackupSettings())
    val settings: StateFlow<BackupSettings> = _settings.asStateFlow()

    private val _status = MutableStateFlow(read<BackupStatus>("status.json")?.copy(running = false, current = null) ?: BackupStatus())
    val status: StateFlow<BackupStatus> = _status.asStateFlow()

    private val done: MutableSet<String> = (read<Set<String>>("done.json") ?: emptySet()).toMutableSet()

    fun update(change: (BackupSettings) -> BackupSettings) {
        _settings.update(change)
        write("settings.json", _settings.value)
    }

    fun status(change: (BackupStatus) -> BackupStatus) {
        _status.update(change)
        write("status.json", _status.value)
    }

    @Synchronized
    fun isBackedUp(key: String) = key in done

    @Synchronized
    fun markBackedUp(key: String) {
        if (done.add(key)) write("done.json", done.toSet())
    }

    @Synchronized
    fun backedUpKeys(): Set<String> = done.toSet()

    private inline fun <reified T> read(name: String): T? =
        runCatching { json.decodeFromString<T>(File(dir, name).readText()) }.getOrNull()

    private inline fun <reified T> write(name: String, value: T) {
        runCatching {
            val tmp = File(dir, "$name.tmp")
            tmp.writeText(json.encodeToString(value))
            tmp.renameTo(File(dir, name))
        }
    }
}
