package com.backendforge.telestore.ui.playlists

import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKind
import com.backendforge.telestore.core.Playlist
import com.backendforge.telestore.core.TeleStoreApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The account's playlists, shared by every screen: the Playlists tab, "Add to playlist" and the
 * heart in the players (which needs to know what's in Liked music).
 */
class PlaylistStore(private val api: () -> TeleStoreApi, private val scope: CoroutineScope) {
    private val _playlists = MutableStateFlow<List<Playlist>>(emptyList())
    val playlists: StateFlow<List<Playlist>> = _playlists.asStateFlow()

    private val _liked = MutableStateFlow<Set<String>>(emptySet())
    /** Ids of the files in Liked music. */
    val liked: StateFlow<Set<String>> = _liked.asStateFlow()

    /** Files waiting for the "Add to playlist" sheet (shown by MainScreen); null when it's closed. */
    private val _adding = MutableStateFlow<List<FileItem>?>(null)
    val adding: StateFlow<List<FileItem>?> = _adding.asStateFlow()

    fun requestAdd(items: List<FileItem>) {
        val playable = items.filter(::canAdd)
        if (playable.isNotEmpty()) _adding.value = playable
    }

    fun closeAdd() {
        _adding.value = null
    }

    suspend fun refresh(): List<Playlist> {
        val lists = api().playlists()
        _playlists.value = lists
        _liked.value = lists.firstOrNull { it.isLiked }?.fileIds?.toSet() ?: emptySet()
        return lists
    }

    /** Refreshes in the background; a failure leaves what's shown. */
    fun refreshQuietly() {
        scope.launch {
            try {
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
        }
    }

    /** The heart: shows the change at once and puts it back if the server refuses. */
    suspend fun setLiked(item: FileItem, liked: Boolean): Boolean {
        val before = _liked.value
        _liked.update { if (liked) it + item.id else it - item.id }
        return try {
            api().setLiked(item, liked).also { refreshQuietly() }
        } catch (e: Exception) {
            _liked.value = before
            throw e
        }
    }

    suspend fun create(name: String, items: List<FileItem> = emptyList()): Playlist =
        api().createPlaylist(name, items).also { refreshQuietly() }

    suspend fun add(playlist: Playlist, items: List<FileItem>): Playlist =
        api().addToPlaylist(playlist.id, items).also { refreshQuietly() }

    suspend fun remove(playlist: Playlist, items: List<FileItem>): Playlist =
        api().removeFromPlaylist(playlist.id, items).also { refreshQuietly() }

    suspend fun reorder(playlist: Playlist, items: List<FileItem>): Playlist =
        api().reorderPlaylist(playlist.id, items).also { refreshQuietly() }

    suspend fun rename(playlist: Playlist, name: String): Playlist =
        api().renamePlaylist(playlist.id, name).also { refreshQuietly() }

    suspend fun delete(playlist: Playlist) {
        api().deletePlaylist(playlist.id)
        _playlists.update { lists -> lists.filterNot { it.id == playlist.id } }
        refreshQuietly()
    }

    /** Sign-out: nothing of this account stays in memory. */
    fun clear() {
        _playlists.value = emptyList()
        _liked.value = emptySet()
        _adding.value = null
    }

    companion object {
        /** Music and videos go in playlists. */
        fun canAdd(item: FileItem): Boolean = !item.isFolder && (item.kind == FileKind.AUDIO || item.kind == FileKind.VIDEO)
    }
}
