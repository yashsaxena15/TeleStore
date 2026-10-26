package com.backendforge.telestore.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeState(
    val path: List<String> = listOf("Home"),
    val items: List<FileItem> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
) {
    val apiPath: String get() = "/" + path.joinToString("/")
    val title: String get() = path.last()
}

/** Phase 1's first look at the files: one folder at a time. Phase 2 replaces it with the full browser. */
class HomeViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    init {
        load()
    }

    fun open(folder: FileItem) {
        _state.update { it.copy(path = it.path + folder.name, items = emptyList()) }
        load()
    }

    /** Returns false at Home (nothing to go back to). */
    fun up(): Boolean {
        if (_state.value.path.size <= 1) return false
        _state.update { it.copy(path = it.path.dropLast(1), items = emptyList()) }
        load()
        return true
    }

    fun load() {
        val path = _state.value.apiPath
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val page = container.api().listFiles(path = path, pageSize = 200)
                _state.update { if (it.apiPath == path) it.copy(items = page.files, loading = false) else it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val message = (e as? ApiException)?.message ?: "Couldn't load this folder: ${e.message ?: e.javaClass.simpleName}"
                _state.update { it.copy(loading = false, error = message) }
            }
        }
    }

    fun signOut() {
        val api: TeleStoreApi = container.api()
        viewModelScope.launch {
            api.logout()
            container.session.signedOut()
        }
    }
}
