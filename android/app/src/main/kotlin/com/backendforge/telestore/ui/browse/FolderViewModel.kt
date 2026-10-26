package com.backendforge.telestore.ui.browse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.Place
import com.backendforge.telestore.core.Places
import com.backendforge.telestore.core.SortBy
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.BrowserPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FolderState(
    val path: String = "/Home",
    val title: String = "Home",
    val items: List<FileItem> = emptyList(),
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val page: Int = 1,
    val hasNext: Boolean = false,
    val sortBy: SortBy = SortBy.NAME,
    val ascending: Boolean = true,
    val isGrid: Boolean = false,
    val isSelectionMode: Boolean = false,
    val selectedIds: Set<String> = emptySet(),
    val snackbarMessage: String? = null,
) {
    val place: Place? get() = Places.fromPath(path)
    val isTrash: Boolean get() = place == Place.TRASH
    val isInbox: Boolean get() = place == Place.INBOX
    val isRecent: Boolean get() = place == Place.RECENT
    val isStarred: Boolean get() = place == Place.STARRED
    val isSpecial: Boolean get() = Places.isSpecial(path)

    val selectedItems: List<FileItem>
        get() = items.filter { it.id in selectedIds }
}

class FolderViewModel(
    private val container: AppContainer,
    initialPath: String = "/Home",
) : ViewModel() {
    private val api get() = container.api()
    private val prefs = BrowserPreferences(container.context)

    private var loadJob: Job? = null

    private val _state = MutableStateFlow(
        FolderState(
            path = initialPath,
            title = resolveTitle(initialPath),
            sortBy = Places.fromPath(initialPath)?.defaultSortBy ?: prefs.sortBy,
            ascending = Places.fromPath(initialPath)?.defaultAscending ?: prefs.ascending,
            isGrid = prefs.isGrid,
        )
    )
    val state: StateFlow<FolderState> = _state.asStateFlow()

    init {
        loadInitialPage(isRefresh = false)
    }

    private fun resolveTitle(path: String): String {
        val place = Places.fromPath(path)
        if (place != null) return place.title
        val clean = path.trimEnd('/')
        val lastSlash = clean.lastIndexOf('/')
        return if (lastSlash >= 0 && lastSlash < clean.length - 1) clean.substring(lastSlash + 1) else clean
    }

    fun setPath(newPath: String) {
        if (_state.value.path == newPath) return
        val place = Places.fromPath(newPath)
        val sort = place?.defaultSortBy ?: prefs.sortBy
        val asc = place?.defaultAscending ?: prefs.ascending
        _state.update {
            it.copy(
                path = newPath,
                title = resolveTitle(newPath),
                sortBy = sort,
                ascending = asc,
                page = 1,
                items = emptyList(),
                isSelectionMode = false,
                selectedIds = emptySet(),
                error = null,
            )
        }
        loadInitialPage(isRefresh = false)
    }

    fun refresh() {
        loadInitialPage(isRefresh = true)
    }

    fun loadMore() {
        val current = _state.value
        if (loadJob?.isActive == true || current.loading || current.loadingMore || !current.hasNext) return
        loadMorePage(page = current.page + 1)
    }

    private fun loadInitialPage(isRefresh: Boolean) {
        loadJob?.cancel()
        val requestPath = _state.value.path
        val requestSortBy = _state.value.sortBy
        val requestAscending = _state.value.ascending

        loadJob = viewModelScope.launch {
            _state.update {
                if (isRefresh) it.copy(refreshing = true, error = null)
                else it.copy(loading = true, error = null)
            }
            try {
                val res = api.listFiles(
                    path = requestPath,
                    page = 1,
                    pageSize = 50,
                    sortBy = requestSortBy,
                    ascending = requestAscending,
                )
                _state.update { current ->
                    if (current.path == requestPath && current.sortBy == requestSortBy && current.ascending == requestAscending) {
                        current.copy(
                            items = res.files,
                            page = 1,
                            hasNext = res.pagination?.hasNext ?: false,
                            loading = false,
                            refreshing = false,
                            error = null,
                        )
                    } else {
                        current.copy(loading = false, refreshing = false)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val message = (e as? ApiException)?.message ?: "Something went wrong: ${e.message}"
                _state.update { current ->
                    if (current.path == requestPath && current.sortBy == requestSortBy && current.ascending == requestAscending) {
                        current.copy(
                            loading = false,
                            refreshing = false,
                            error = if (current.items.isEmpty()) message else null,
                            snackbarMessage = if (current.items.isNotEmpty()) message else null,
                        )
                    } else {
                        current.copy(loading = false, refreshing = false)
                    }
                }
            }
        }
    }

    private fun loadMorePage(page: Int) {
        val requestPath = _state.value.path
        val requestSortBy = _state.value.sortBy
        val requestAscending = _state.value.ascending

        viewModelScope.launch {
            _state.update { it.copy(loadingMore = true) }
            try {
                val res = api.listFiles(
                    path = requestPath,
                    page = page,
                    pageSize = 50,
                    sortBy = requestSortBy,
                    ascending = requestAscending,
                )
                _state.update { current ->
                    if (current.path == requestPath && current.sortBy == requestSortBy && current.ascending == requestAscending) {
                        current.copy(
                            items = current.items + res.files,
                            page = page,
                            hasNext = res.pagination?.hasNext ?: false,
                            loadingMore = false,
                        )
                    } else {
                        current.copy(loadingMore = false)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val message = (e as? ApiException)?.message ?: "Something went wrong: ${e.message}"
                _state.update { current ->
                    current.copy(
                        loadingMore = false,
                        snackbarMessage = message,
                    )
                }
            }
        }
    }

    fun setSort(sortBy: SortBy, ascending: Boolean) {
        prefs.sortBy = sortBy
        prefs.ascending = ascending
        _state.update { it.copy(sortBy = sortBy, ascending = ascending) }
        loadInitialPage(isRefresh = false)
    }

    fun setViewMode(isGrid: Boolean) {
        prefs.isGrid = isGrid
        _state.update { it.copy(isGrid = isGrid) }
    }

    // ── Multi-select ────────────────────────────────────────────────────────────

    fun enterSelectionMode(item: FileItem) {
        _state.update {
            it.copy(isSelectionMode = true, selectedIds = setOf(item.id))
        }
    }

    fun toggleSelection(item: FileItem) {
        _state.update {
            val newSet = if (item.id in it.selectedIds) it.selectedIds - item.id else it.selectedIds + item.id
            if (newSet.isEmpty()) it.copy(isSelectionMode = false, selectedIds = emptySet())
            else it.copy(selectedIds = newSet)
        }
    }

    fun selectAll() {
        _state.update {
            it.copy(selectedIds = it.items.map { file -> file.id }.toSet())
        }
    }

    fun clearSelection() {
        _state.update {
            it.copy(isSelectionMode = false, selectedIds = emptySet())
        }
    }

    fun dismissSnackbar() {
        _state.update { it.copy(snackbarMessage = null) }
    }

    // ── Item Actions ────────────────────────────────────────────────────────────

    fun createFolder(name: String) {
        viewModelScope.launch {
            try {
                api.createFolder(name = name, parentPath = _state.value.path)
                _state.update { it.copy(snackbarMessage = "Folder '$name' created") }
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? ApiException)?.message ?: "Failed to create folder: ${e.message}"
                _state.update { it.copy(snackbarMessage = msg) }
            }
        }
    }

    fun rename(item: FileItem, newName: String) {
        viewModelScope.launch {
            try {
                api.rename(item = item, newName = newName)
                _state.update { it.copy(snackbarMessage = "Renamed to '$newName'") }
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? ApiException)?.message ?: "Failed to rename: ${e.message}"
                _state.update { it.copy(snackbarMessage = msg) }
            }
        }
    }

    fun toggleStar(item: FileItem) {
        viewModelScope.launch {
            try {
                val newStatus = api.setStarred(item = item, starred = !item.starred)
                _state.update { s ->
                    val updatedItems = s.items.map {
                        if (it.id == item.id) it.copy(starred = newStatus) else it
                    }
                    s.copy(
                        items = updatedItems,
                        snackbarMessage = if (newStatus) "Added to Starred" else "Removed from Starred",
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? ApiException)?.message ?: "Failed to update star: ${e.message}"
                _state.update { it.copy(snackbarMessage = msg) }
            }
        }
    }

    fun emptyTrash() {
        viewModelScope.launch {
            try {
                api.emptyTrash()
                _state.update { it.copy(snackbarMessage = "Trash emptied") }
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? ApiException)?.message ?: "Failed to empty trash: ${e.message}"
                _state.update { it.copy(snackbarMessage = msg) }
            }
        }
    }

    // ── Bulk Actions ────────────────────────────────────────────────────────────

    fun moveItems(items: List<FileItem>, targetPath: String) {
        runBulkAction(items, "Moved") { api.move(it, targetPath) }
    }

    fun copyItems(items: List<FileItem>, targetPath: String) {
        runBulkAction(items, "Copied") { api.copy(it, targetPath) }
    }

    fun starItems(items: List<FileItem>, starred: Boolean) {
        val verb = if (starred) "Starred" else "Unstarred"
        runBulkAction(items, verb) { api.setStarred(it, starred) }
    }

    fun trashItems(items: List<FileItem>) {
        runBulkAction(items, "Moved to Trash") { api.trash(it) }
    }

    fun restoreItems(items: List<FileItem>) {
        runBulkAction(items, "Restored") { api.restore(it) }
    }

    fun deleteForeverItems(items: List<FileItem>) {
        runBulkAction(items, "Permanently deleted") { api.deleteForever(it) }
    }

    private fun runBulkAction(
        items: List<FileItem>,
        pastVerb: String,
        action: suspend (FileItem) -> Unit,
    ) {
        viewModelScope.launch {
            clearSelection()
            var success = 0
            var errorMsg: String? = null
            for (item in items) {
                try {
                    action(item)
                    success++
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (errorMsg == null) {
                        errorMsg = (e as? ApiException)?.message ?: e.message
                    }
                }
            }
            val total = items.size
            val message = when {
                errorMsg == null -> "$pastVerb $success item${if (success != 1) "s" else ""}"
                success == 0 -> "Failed: $errorMsg"
                else -> "$success $pastVerb, ${total - success} failed: $errorMsg"
            }
            _state.update { it.copy(snackbarMessage = message) }
            refresh()
        }
    }
}
