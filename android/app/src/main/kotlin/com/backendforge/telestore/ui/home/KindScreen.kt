package com.backendforge.telestore.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKind
import com.backendforge.telestore.core.SortBy
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.FileRow
import com.backendforge.telestore.ui.components.FileThumbnail
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class KindState(
    val items: List<FileItem> = emptyList(),
    val page: Int = 0,
    val hasNext: Boolean = true,
    val loading: Boolean = false,
    val error: String? = null,
)

/** Every file of one kind in the account, newest first (the server filters: GET /files?path=all&kind=…). */
class KindViewModel(private val container: AppContainer, val kind: FileKind) : ViewModel() {
    private val _state = MutableStateFlow(KindState())
    val state: StateFlow<KindState> = _state.asStateFlow()
    private var job: Job? = null

    init {
        loadMore()
    }

    fun refresh() {
        job?.cancel()
        _state.value = KindState()
        loadMore()
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || !s.hasNext) return
        _state.update { it.copy(loading = true, error = null) }
        job = viewModelScope.launch {
            try {
                val page = container.api().listFiles(path = "all", page = s.page + 1, pageSize = 60, sortBy = SortBy.DATE, ascending = false, kind = kind)
                _state.update {
                    it.copy(items = it.items + page.files, page = s.page + 1, hasNext = page.pagination?.hasNext ?: false, loading = false)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = (e as? ApiException)?.message ?: "Couldn't load these files.") }
            }
        }
    }
}

fun FileKind.title(): String = when (this) {
    FileKind.VIDEO -> "Videos"
    FileKind.PHOTO -> "Photos"
    FileKind.AUDIO -> "Music"
    FileKind.DOCUMENT -> "Documents"
    else -> "Files"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KindScreen(
    vm: KindViewModel,
    container: AppContainer,
    onBack: (() -> Unit)?,
    onOpenFile: (FileItem, List<FileItem>) -> Boolean,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val api = container.api()
    val photos = vm.kind == FileKind.PHOTO
    val offline = remember(state.items.size) { container.transfers.store.offlineIds() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(vm.kind.title()) },
                navigationIcon = {
                    if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(isRefreshing = state.loading && state.items.isEmpty(), onRefresh = vm::refresh, modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                state.items.isEmpty() && !state.loading -> Text(
                    state.error ?: "No ${vm.kind.title().lowercase()} yet.",
                    color = if (state.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )
                photos -> {
                    val grid = rememberLazyGridState()
                    val nearEnd by remember { derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > grid.layoutInfo.totalItemsCount - 20 } }
                    LaunchedEffect(nearEnd) { if (nearEnd) vm.loadMore() }
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(96.dp), state = grid, modifier = Modifier.fillMaxSize(),
                        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        items(state.items, key = { it.id }) { item ->
                            Box(Modifier.aspectRatio(1f).clickable { onOpenFile(item, state.items) }) {
                                FileThumbnail(item = item, api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 0.dp, iconSize = 28.dp)
                            }
                        }
                    }
                }
                else -> {
                    val list = rememberLazyListState()
                    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > list.layoutInfo.totalItemsCount - 10 } }
                    LaunchedEffect(nearEnd) { if (nearEnd) vm.loadMore() }
                    LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                        items(state.items, key = { it.id }) { item ->
                            FileRow(
                                item = item, api = api, isSelectionMode = false, isSelected = false, onToggleSelect = {},
                                onClick = { onOpenFile(item, state.items) }, onLongClick = {}, onOpenActions = { onOpenFile(item, state.items) },
                                offline = item.id in offline,
                            )
                        }
                        if (state.loading) item {
                            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) }
                        }
                    }
                }
            }
        }
    }
}
