package com.backendforge.telestore.ui.photos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.Memory
import com.backendforge.telestore.core.SortBy
import com.backendforge.telestore.core.Timeline
import com.backendforge.telestore.core.TimelineDay
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PhotosState(
    val items: List<FileItem> = emptyList(),
    val days: List<TimelineDay> = emptyList(),
    val memories: List<Memory> = emptyList(),
    val page: Int = 0,
    val hasNext: Boolean = true,
    val loading: Boolean = false,
    val error: String? = null,
    val selected: Set<String> = emptySet(),
    val columns: Int = 4,
    val message: String? = null,
) {
    val selecting: Boolean get() = selected.isNotEmpty()
}

/** The Photos timeline: every photo and video in the account, newest taken first, grouped by day. */
class PhotosViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(PhotosState())
    val state: StateFlow<PhotosState> = _state.asStateFlow()
    private var job: Job? = null
    /** Bumped by refresh: a reply for an older load is dropped. */
    private var generation = 0

    init {
        loadMore()
        // A finished backup or upload shows up straight away
        viewModelScope.launch { container.transfers.store.uploaded.collect { refresh() } }
    }

    /** Reloads from the newest; what's on screen stays until the new list arrives. */
    fun refresh() {
        job?.cancel()
        generation++
        _state.update { it.copy(page = 0, hasNext = true, loading = false, selected = emptySet()) }
        loadMore()
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || !s.hasNext) return
        val gen = generation
        _state.update { it.copy(loading = true, error = null) }
        job = viewModelScope.launch {
            try {
                val page = container.api().listFiles(path = "all", page = s.page + 1, pageSize = 200, sortBy = SortBy.TAKEN, ascending = false, mediaOnly = true)
                if (gen != generation) return@launch
                _state.update {
                    // Page 1 replaces the list (a refresh); later pages add to it, never twice the same photo
                    val items = (if (s.page == 0) page.files else it.items + page.files).distinctBy { f -> f.id }
                    it.copy(
                        items = items, days = Timeline.days(items),
                        memories = if (s.page == 0) Timeline.memories(items) else it.memories,
                        page = s.page + 1, hasNext = page.pagination?.hasNext ?: false, loading = false,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (gen == generation) _state.update { it.copy(loading = false, error = (e as? ApiException)?.message ?: "Couldn't load your photos.") }
            }
        }
    }

    /** Pinch: 3, 4, 5 or 7 photos per row. */
    fun zoom(bigger: Boolean) = _state.update {
        val steps = listOf(3, 4, 5, 7)
        val i = steps.indexOf(it.columns).coerceAtLeast(0)
        it.copy(columns = steps[(if (bigger) i - 1 else i + 1).coerceIn(0, steps.lastIndex)])
    }

    fun toggle(item: FileItem) = _state.update {
        it.copy(selected = if (item.id in it.selected) it.selected - item.id else it.selected + item.id)
    }

    fun toggleDay(day: TimelineDay) = _state.update {
        val ids = day.items.map { f -> f.id }.toSet()
        it.copy(selected = if (it.selected.containsAll(ids)) it.selected - ids else it.selected + ids)
    }

    fun clearSelection() = _state.update { it.copy(selected = emptySet()) }
    fun dismissMessage() = _state.update { it.copy(message = null) }

    private fun selectedItems() = _state.value.items.filter { it.id in _state.value.selected }

    fun downloadSelected() {
        val items = selectedItems()
        items.forEach { container.transfers.download(it) }
        _state.update { it.copy(selected = emptySet(), message = "Downloading ${items.size} item${if (items.size != 1) "s" else ""}. See Transfers.") }
    }

    fun starSelected() = bulk("Starred") { container.api().setStarred(it, true) }

    fun trashSelected() = bulk("Moved to Trash", removeOnSuccess = true) { container.api().trash(it) }

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
                    items = left, days = Timeline.days(left),
                    message = if (error == null) "$verb ${ok.size} item${if (ok.size != 1) "s" else ""}" else "${ok.size} done, ${items.size - ok.size} failed: $error",
                )
            }
        }
    }
}
