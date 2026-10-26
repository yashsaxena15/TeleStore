package com.backendforge.telestore.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SearchState(
    val query: String = "",
    val results: List<FileItem> = emptyList(),
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val page: Int = 1,
    val hasNext: Boolean = false,
)

@OptIn(FlowPreview::class)
class SearchViewModel(
    private val container: AppContainer,
) : ViewModel() {
    private val api get() = container.api()

    private val _queryFlow = MutableStateFlow("")
    private val _state = MutableStateFlow(SearchState())
    val state: StateFlow<SearchState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _queryFlow
                .debounce(400)
                .distinctUntilChanged()
                .collectLatest { query ->
                    val trimmed = query.trim()
                    if (trimmed.isEmpty()) {
                        _state.update { it.copy(results = emptyList(), loading = false, error = null, page = 1, hasNext = false) }
                    } else {
                        searchPage(query = trimmed, page = 1, isMore = false)
                    }
                }
        }
    }

    fun setQuery(newQuery: String) {
        _state.update { it.copy(query = newQuery) }
        _queryFlow.value = newQuery
    }

    fun clearQuery() {
        setQuery("")
    }

    fun loadMore() {
        val current = _state.value
        if (current.loading || current.loadingMore || !current.hasNext || current.query.isBlank()) return
        searchPage(query = current.query.trim(), page = current.page + 1, isMore = true)
    }

    private fun searchPage(query: String, page: Int, isMore: Boolean) {
        viewModelScope.launch {
            _state.update {
                if (isMore) it.copy(loadingMore = true)
                else it.copy(loading = true, error = null)
            }
            try {
                val res = api.listFiles(
                    query = query,
                    page = page,
                    pageSize = 50,
                )
                _state.update {
                    val combined = if (isMore) it.results + res.files else res.files
                    it.copy(
                        results = combined,
                        page = page,
                        hasNext = res.pagination?.hasNext ?: false,
                        loading = false,
                        loadingMore = false,
                        error = null,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? ApiException)?.message ?: "Search failed: ${e.message}"
                _state.update {
                    it.copy(
                        loading = false,
                        loadingMore = false,
                        error = msg,
                    )
                }
            }
        }
    }
}
