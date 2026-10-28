package com.backendforge.telestore.ui.photos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.backup.BackupWorker
import com.backendforge.telestore.backup.PhoneMedia
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.LocalPhoto
import com.backendforge.telestore.core.Memory
import com.backendforge.telestore.core.PhotoDay
import com.backendforge.telestore.core.PhotoEntry
import com.backendforge.telestore.core.PhotoMerge
import com.backendforge.telestore.core.SortBy
import com.backendforge.telestore.core.Timeline
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.protectedOutcomeMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class PhotosState(
    /** The backed-up photos loaded so far (server pages). */
    val items: List<FileItem> = emptyList(),
    /** Every photo and video on this phone (empty without the permission). */
    val local: List<LocalPhoto> = emptyList(),
    /** Phone and server together, newest first. */
    val entries: List<PhotoEntry> = emptyList(),
    val days: List<PhotoDay> = emptyList(),
    val memories: List<Memory> = emptyList(),
    val page: Int = 0,
    val hasNext: Boolean = true,
    val loading: Boolean = false,
    val error: String? = null,
    /** TeleStore may read the phone's photos. */
    val canReadPhone: Boolean = true,
    /** Photos and videos on this phone that are safely backed up ("Free up space" can remove them here). */
    val freeable: Int = 0,
    /** Entry ids ([PhotoEntry.id]): the server id, or "local:<key>" for a photo only on the phone. */
    val selected: Set<String> = emptySet(),
    val columns: Int = 4,
    val message: String? = null,
) {
    val selecting: Boolean get() = selected.isNotEmpty()
}

/**
 * The Photos timeline: every photo and video on this phone and in the backup, newest taken first,
 * grouped by day. Server pages load as you scroll; the phone is read all at once.
 */
class PhotosViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(PhotosState())
    val state: StateFlow<PhotosState> = _state.asStateFlow()
    private var job: Job? = null
    private var scanJob: Job? = null
    private var mergeJob: Job? = null
    /** Bumped by refresh: a reply for an older load is dropped. */
    private var generation = 0
    /** The phone items the backup has done, so they get the cloud mark before their server copy loads. */
    private var backedUpKeys: Set<String> = emptySet()

    init {
        loadMore()
        scanPhone()
        // A finished backup or upload shows up straight away
        viewModelScope.launch { container.transfers.store.uploaded.collect { refresh() } }
        // Choosing other albums (or videos on/off) in Backup changes which phone photos show
        viewModelScope.launch {
            container.backup.settings.map { it.albums to it.includeVideos }.distinctUntilChanged().drop(1).collect { scanPhone() }
        }
        // Each photo the backup finishes gets its cloud mark
        viewModelScope.launch {
            container.backup.status.map { it.done to it.running }.distinctUntilChanged().drop(1).collect {
                backedUpKeys = withContext(Dispatchers.IO) { container.backup.backedUpKeys() }
                remerge()
            }
        }
    }

    /** Reloads from the newest; what's on screen stays until the new list arrives. */
    fun refresh() {
        job?.cancel()
        generation++
        _state.update { it.copy(page = 0, hasNext = true, loading = false, error = null, selected = emptySet()) }
        loadMore()
        scanPhone()
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || !s.hasNext) return
        val gen = generation
        _state.update { it.copy(loading = true, error = null) }
        job = viewModelScope.launch {
            try {
                // Only the phone backup folder (and its album folders), not every photo in the account
                val page = container.api().listFiles(
                    path = "all", page = s.page + 1, pageSize = 200, sortBy = SortBy.TAKEN, ascending = false,
                    mediaOnly = true, under = container.backup.settings.value.destination,
                )
                if (gen != generation) return@launch
                _state.update {
                    // Page 1 replaces the list (a refresh); later pages add to it, never twice the same photo
                    val items = (if (s.page == 0) page.files else it.items + page.files).distinctBy { f -> f.id }
                    it.copy(
                        items = items,
                        memories = if (s.page == 0) Timeline.memories(items) else it.memories,
                        page = s.page + 1, hasNext = page.pagination?.hasNext ?: false, loading = false,
                    )
                }
                remerge()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (gen == generation) {
                    _state.update { it.copy(loading = false, error = (e as? ApiException)?.message ?: "Couldn't load your backed-up photos.") }
                    // The phone's photos still show
                    remerge()
                }
            }
        }
    }

    /** Reads the phone's photos and videos again (on load, refresh, and when the screen comes back). */
    fun scanPhone() {
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            val context = container.context
            val (canRead, local, keys) = withContext(Dispatchers.IO) {
                if (!PhoneMedia.canRead(context)) Triple(false, emptyList<LocalPhoto>(), emptySet<String>())
                else {
                    val all = PhoneMedia.scan(context).map { p ->
                        LocalPhoto(
                            key = p.key, name = p.name, size = p.size, takenAtMillis = p.takenAt, video = p.video,
                            uri = p.uri.toString(), bucketId = p.bucketId, bucket = p.bucket,
                        )
                    }
                    // Only the albums chosen in Backup (WhatsApp, screenshots… stay out unless chosen)
                    val settings = container.backup.settings.value
                    Triple(true, PhotoMerge.inBackupAlbums(all, settings.albums, settings.includeVideos), container.backup.backedUpKeys())
                }
            }
            backedUpKeys = keys
            _state.update { it.copy(local = local, canReadPhone = canRead) }
            remerge()
        }
    }

    /** Puts the phone and server lists together again, off the main thread; the newest call wins. */
    private fun remerge() {
        mergeJob?.cancel()
        mergeJob = viewModelScope.launch {
            val s = _state.value
            val keys = backedUpKeys
            val (entries, days) = withContext(Dispatchers.Default) {
                // After a failed page all phone photos show: retrying re-sorts them anyway
                val merged = PhotoMerge.merge(s.items, s.local, keys, serverHasMore = s.hasNext && s.error == null)
                merged to PhotoMerge.days(merged)
            }
            val freeable = s.local.count { it.key in keys }
            _state.update {
                val ids = entries.mapTo(HashSet()) { e -> e.id }
                it.copy(entries = entries, days = days, freeable = freeable, selected = it.selected.filterTo(HashSet()) { id -> id in ids })
            }
        }
    }

    /** Pinch: 3, 4, 5 or 7 photos per row. */
    fun zoom(bigger: Boolean) = _state.update {
        val steps = listOf(3, 4, 5, 7)
        val i = steps.indexOf(it.columns).coerceAtLeast(0)
        it.copy(columns = steps[(if (bigger) i - 1 else i + 1).coerceIn(0, steps.lastIndex)])
    }

    fun toggle(entry: PhotoEntry) = _state.update {
        it.copy(selected = if (entry.id in it.selected) it.selected - entry.id else it.selected + entry.id)
    }

    fun toggleDay(day: PhotoDay) = _state.update {
        val ids = day.entries.map { e -> e.id }.toSet()
        it.copy(selected = if (it.selected.containsAll(ids)) it.selected - ids else it.selected + ids)
    }

    fun clearSelection() = _state.update { it.copy(selected = emptySet()) }
    fun dismissMessage() = _state.update { it.copy(message = null) }

    private fun selectedEntries() = _state.value.entries.filter { it.id in _state.value.selected }

    /** The selected photos that are in TeleStore: the server actions only apply to them. */
    private fun selectedItems() = selectedEntries().mapNotNull { it.server }

    fun downloadSelected() {
        val items = selectedItems()
        items.forEach { container.transfers.download(it) }
        _state.update { it.copy(selected = emptySet(), message = "Downloading ${items.size} item${if (items.size != 1) "s" else ""}. See Transfers.") }
    }

    fun starSelected() = bulk("Starred") { container.api().setStarred(it, true) }

    /** Protected photos are trashed after one password prompt; cancelled, they stay ("Not deleted"). */
    fun trashSelected() {
        val items = selectedItems()
        _state.update { it.copy(selected = emptySet()) }
        viewModelScope.launch {
            val outcome = container.protection.deleteAll(items) { item, token -> container.api().trash(item, token) }
            val gone = outcome.done.map { it.id }.toSet()
            _state.update {
                it.copy(
                    items = it.items.filterNot { f -> f.id in gone },
                    message = protectedOutcomeMessage(outcome, "Moved to Trash"),
                )
            }
            remerge()
        }
    }

    /**
     * Runs the backup now for selected photos that are only on the phone. False when backup is
     * off: the caller opens Backup settings instead (nothing is turned on from here).
     */
    fun backUpSelected(): Boolean {
        val settings = container.backup.settings.value
        if (!settings.enabled) return false
        val phoneOnly = selectedEntries().mapNotNull { e -> e.local?.takeIf { e.phoneOnly } }
        // Only the albums chosen in Backup settings are backed up (none chosen yet = the camera)
        val outside = if (settings.albums.isEmpty()) 0 else phoneOnly.count { it.bucketId !in settings.albums }
        BackupWorker.runNow(container.context, settings)
        _state.update {
            it.copy(
                selected = emptySet(),
                message = if (outside > 0) "Backing up now. $outside of them are in albums that aren't backed up: choose them in Backup settings."
                else "Backing up now",
            )
        }
        return true
    }

    private fun bulk(verb: String, removeOnSuccess: Boolean = false, action: suspend (FileItem) -> Any) {
        val items = selectedItems()
        _state.update { it.copy(selected = emptySet()) }
        viewModelScope.launch {
            val ok = mutableListOf<String>()
            var error: String? = null
            for (item in items) {
                try {
                    action(item)
                    ok += item.id
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    error = error ?: (e as? ApiException)?.message ?: e.message
                }
            }
            _state.update {
                val left = if (removeOnSuccess) it.items.filterNot { f -> f.id in ok } else it.items
                it.copy(
                    items = left,
                    message = if (error == null) "$verb ${ok.size} item${if (ok.size != 1) "s" else ""}" else "${ok.size} done, ${items.size - ok.size} failed: $error",
                )
            }
            remerge()
        }
    }
}
