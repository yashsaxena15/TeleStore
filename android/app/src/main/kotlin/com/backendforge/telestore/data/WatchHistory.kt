package com.backendforge.telestore.data

import android.content.Context
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.TeleStoreApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Where a video was stopped, for "Continue watching" and to resume it next time. */
@Serializable
data class WatchEntry(
    val fileId: String,
    val name: String,
    val path: String = "/",
    val size: Long? = null,
    val thumbnail: String? = null,
    val positionMs: Long,
    val durationMs: Long,
    val updatedAt: Long = System.currentTimeMillis(),
) {
    val progress: Float get() = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    val leftMs: Long get() = (durationMs - positionMs).coerceAtLeast(0)
    fun asFile() = FileItem(id = fileId, name = name, type = "video", size = size, path = path, thumbnail = thumbnail)
}

/**
 * Kept on this phone only (SharedPreferences), at most the 200 most recent videos. Private Vault
 * videos are never kept: Continue watching would show them outside the vault.
 */
class WatchHistory(context: Context) {
    private val prefs = context.getSharedPreferences("watch_history", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val _entries = MutableStateFlow(readWithoutVault())
    val entries: StateFlow<List<WatchEntry>> = _entries.asStateFlow()

    /** Videos started but not finished, newest first. */
    fun continueWatching(): List<WatchEntry> =
        _entries.value.filter { it.progress in 0.02f..0.95f && it.leftMs > 30_000 }.sortedByDescending { it.updatedAt }

    /** Where to start this video: the saved spot, unless it was nearly finished. */
    fun resumeAt(fileId: String): Long {
        val e = _entries.value.firstOrNull { it.fileId == fileId } ?: return 0
        return if (e.positionMs > 10_000 && e.leftMs > 30_000) e.positionMs else 0
    }

    fun save(item: FileItem, positionMs: Long, durationMs: Long) {
        if (durationMs <= 0 || item.inVault) return
        val entry = WatchEntry(item.id, item.name, item.path, item.size, item.thumbnail, positionMs, durationMs)
        val list = (listOf(entry) + _entries.value.filterNot { it.fileId == item.id }).take(200)
        _entries.value = list
        write(list)
    }

    fun forget(fileId: String) {
        val list = _entries.value.filterNot { it.fileId == fileId }
        _entries.value = list
        write(list)
    }

    private fun write(list: List<WatchEntry>) {
        prefs.edit().putString(KEY, json.encodeToString(list)).apply()
    }

    /** The saved list, minus vault videos saved before they were left out (forgotten for good). */
    private fun readWithoutVault(): List<WatchEntry> {
        val saved = read()
        val kept = saved.filterNot { TeleStoreApi.inVault(it.path) }
        if (kept.size != saved.size) write(kept)
        return kept
    }

    private fun read(): List<WatchEntry> =
        runCatching { json.decodeFromString<List<WatchEntry>>(prefs.getString(KEY, null) ?: "[]") }.getOrDefault(emptyList())

    private companion object {
        const val KEY = "entries"
    }
}
