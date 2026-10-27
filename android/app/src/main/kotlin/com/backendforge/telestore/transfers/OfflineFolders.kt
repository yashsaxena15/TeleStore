package com.backendforge.telestore.transfers

import android.content.Context
import com.backendforge.telestore.core.OfflineSync
import com.backendforge.telestore.core.TeleStoreApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Folders kept offline: every file inside (and in its subfolders) is saved on the phone, files
 * added later are saved at the next check, and files removed from the folder are deleted here too.
 */
class OfflineFolders(context: Context, private val transfers: TransferManager) {
    private val prefs = context.getSharedPreferences("offline", Context.MODE_PRIVATE)
    private val _paths = MutableStateFlow(prefs.getStringSet(KEY_FOLDERS, null)?.toSet() ?: emptySet())
    val paths: StateFlow<Set<String>> = _paths.asStateFlow()

    /** Starts keeping [path] offline; returns how many files were queued. */
    suspend fun keep(api: TeleStoreApi, path: String): Int {
        save(_paths.value + path)
        return sync(api, path)
    }

    /** Stops keeping [path] offline and deletes the copies it brought. */
    fun drop(path: String) {
        save(_paths.value - path)
        transfers.removeOffline(transfers.store.items.value.filter { it.offlineFolder == path }.mapNotNull { it.fileId }.toSet())
    }

    /** Brings one folder up to date with the server; returns how many files were queued. */
    suspend fun sync(api: TeleStoreApi, path: String): Int {
        val saved = transfers.store.items.value.filter { it.offline && it.offlineFolder == path }.mapNotNull { it.fileId }.toSet()
        val diff = OfflineSync.diff(api.filesUnder(path), saved)
        if (diff.remove.isNotEmpty()) transfers.removeOffline(diff.remove)
        return transfers.saveOffline(diff.add, folder = path)
    }

    /** Every folder kept offline (the background check); a folder that fails waits for next time. */
    suspend fun syncAll(api: TeleStoreApi) {
        _paths.value.forEach { runCatching { sync(api, it) } }
    }

    fun clear() = save(emptySet())

    private fun save(next: Set<String>) {
        prefs.edit().putStringSet(KEY_FOLDERS, next).apply()
        _paths.value = next
    }

    private companion object {
        const val KEY_FOLDERS = "folders"
    }
}
