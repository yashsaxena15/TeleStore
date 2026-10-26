package com.backendforge.telestore.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.SortBy
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeState(
    val recent: List<FileItem> = emptyList(),
    val folders: List<FileItem> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
)

/** The Home dashboard: recently added files and the top-level folders. */
class HomeViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    init {
        refresh()
        // A finished upload shows up in Recent
        viewModelScope.launch { container.transfers.store.uploaded.collect { refresh() } }
    }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val api = container.api()
                val recent = async { api.listFiles(path = "all", pageSize = 12, sortBy = SortBy.DATE, ascending = false) }
                val home = async { api.listFiles(path = TeleStoreApi.HOME, pageSize = 100, sortBy = SortBy.NAME) }
                _state.update {
                    it.copy(recent = recent.await().files, folders = home.await().files.filter { f -> f.isFolder }, loading = false)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = (e as? ApiException)?.message ?: "Couldn't load Home.") }
            }
        }
    }
}
