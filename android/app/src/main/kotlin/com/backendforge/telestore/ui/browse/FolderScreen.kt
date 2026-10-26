package com.backendforge.telestore.ui.browse

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.DriveFileMove
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DividerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FolderPaths
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.ui.components.ConfirmDialog
import com.backendforge.telestore.ui.components.FileGridCard
import com.backendforge.telestore.ui.components.FileInfoSheet
import com.backendforge.telestore.ui.components.FileRow
import com.backendforge.telestore.ui.components.FolderPickerSheet
import com.backendforge.telestore.ui.components.ItemActionSheet
import com.backendforge.telestore.ui.components.NewFolderDialog
import com.backendforge.telestore.ui.components.RenameDialog
import com.backendforge.telestore.ui.components.SortViewSheet

private enum class FolderPickerMode { MOVE, COPY }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderScreen(
    vm: FolderViewModel,
    api: TeleStoreApi,
    onNavigateFolder: (String) -> Unit,
    /** A breadcrumb was tapped; null opens the folder like any other folder. */
    onNavigateCrumb: ((targetPath: String) -> Unit)? = null,
    onOpenSearch: () -> Unit,
    /** Plays or shows a file; false means there's no viewer for it (its Info opens instead). */
    onOpenFile: (item: FileItem, siblings: List<FileItem>) -> Boolean = { _, _ -> false },
    /** Picks files on the phone and uploads them into this folder; null hides the button. */
    onUpload: ((folderPath: String) -> Unit)? = null,
    onDownload: ((FileItem) -> Unit)? = null,
    offlineIds: Set<String> = emptySet(),
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    BackHandler(enabled = state.isSelectionMode) {
        vm.clearSelection()
    }

    var showSortSheet by remember { mutableStateOf(false) }
    var actionItem by remember { mutableStateOf<FileItem?>(null) }
    var infoItem by remember { mutableStateOf<FileItem?>(null) }
    var renameItem by remember { mutableStateOf<FileItem?>(null) }
    var showNewFolderDialog by remember { mutableStateOf(false) }
    var showEmptyTrashDialog by remember { mutableStateOf(false) }
    var deleteForeverItems by remember { mutableStateOf<List<FileItem>?>(null) }
    var folderPickerTarget by remember { mutableStateOf<Pair<List<FileItem>, FolderPickerMode>?>(null) }

    LaunchedEffect(state.snackbarMessage) {
        state.snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            vm.dismissSnackbar()
        }
    }

    val listState = rememberLazyListState()
    val gridState = rememberLazyGridState()

    // Paging trigger for list
    val shouldLoadMoreList by remember {
        derivedStateOf {
            val total = listState.layoutInfo.totalItemsCount
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            total > 0 && last >= total - 5
        }
    }
    LaunchedEffect(shouldLoadMoreList) {
        if (shouldLoadMoreList && !state.isGrid) vm.loadMore()
    }

    // Paging trigger for grid
    val shouldLoadMoreGrid by remember {
        derivedStateOf {
            val total = gridState.layoutInfo.totalItemsCount
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            total > 0 && last >= total - 6
        }
    }
    LaunchedEffect(shouldLoadMoreGrid) {
        if (shouldLoadMoreGrid && state.isGrid) vm.loadMore()
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            if (onUpload != null && !state.isSpecial && !state.isSelectionMode) {
                ExtendedFloatingActionButton(
                    onClick = { onUpload(state.path) },
                    icon = { Icon(Icons.Default.Upload, contentDescription = null) },
                    text = { Text("Upload") },
                )
            }
        },
        topBar = {
            if (state.isSelectionMode) {
                TopAppBar(
                    title = { Text("${state.selectedIds.size} selected") },
                    navigationIcon = {
                        IconButton(onClick = vm::clearSelection) {
                            Icon(Icons.Default.Close, contentDescription = "Close selection")
                        }
                    },
                    actions = {
                        IconButton(onClick = vm::selectAll) {
                            Icon(Icons.Default.SelectAll, contentDescription = "Select all")
                        }
                    },
                )
            } else {
                TopAppBar(
                    title = {
                        Text(
                            text = state.title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    actions = {
                        IconButton(onClick = onOpenSearch) {
                            Icon(Icons.Default.Search, contentDescription = "Search")
                        }
                        IconButton(onClick = { showSortSheet = true }) {
                            Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = "Sort and view")
                        }
                        if (state.isTrash) {
                            IconButton(
                                onClick = { showEmptyTrashDialog = true },
                                enabled = state.items.isNotEmpty(),
                            ) {
                                Icon(Icons.Default.DeleteSweep, contentDescription = "Empty trash")
                            }
                        } else if (!state.isSpecial) {
                            IconButton(onClick = { showNewFolderDialog = true }) {
                                Icon(Icons.Default.CreateNewFolder, contentDescription = "New folder")
                            }
                        }
                        if (state.items.isNotEmpty()) {
                            IconButton(onClick = {
                                if (state.items.isNotEmpty()) vm.enterSelectionMode(state.items.first())
                            }) {
                                Icon(Icons.Default.Checklist, contentDescription = "Select items")
                            }
                        }
                    },
                )
            }
        },
        bottomBar = {
            if (state.isSelectionMode) {
                val selected = state.selectedItems
                NavigationBar {
                    if (state.isTrash) {
                        NavigationBarItem(
                            selected = false,
                            onClick = { vm.restoreItems(selected) },
                            icon = { Icon(Icons.Default.Restore, contentDescription = null) },
                            label = { Text("Restore") },
                            enabled = selected.isNotEmpty(),
                        )
                        NavigationBarItem(
                            selected = false,
                            onClick = { deleteForeverItems = selected },
                            icon = { Icon(Icons.Default.DeleteForever, contentDescription = null) },
                            label = { Text("Delete") },
                            enabled = selected.isNotEmpty(),
                        )
                    } else if (state.isInbox) {
                        val allStarred = selected.isNotEmpty() && selected.all { it.starred }
                        NavigationBarItem(
                            selected = false,
                            onClick = { folderPickerTarget = selected to FolderPickerMode.MOVE },
                            icon = { Icon(Icons.Default.DriveFileMove, contentDescription = null) },
                            label = { Text("Move") },
                            enabled = selected.isNotEmpty(),
                        )
                        NavigationBarItem(
                            selected = false,
                            onClick = { vm.starItems(selected, !allStarred) },
                            icon = {
                                Icon(
                                    if (allStarred) Icons.Default.StarOutline else Icons.Default.Star,
                                    contentDescription = null
                                )
                            },
                            label = { Text(if (allStarred) "Unstar" else "Star") },
                            enabled = selected.isNotEmpty(),
                        )
                        NavigationBarItem(
                            selected = false,
                            onClick = { vm.trashItems(selected) },
                            icon = { Icon(Icons.Default.Delete, contentDescription = null) },
                            label = { Text("Trash") },
                            enabled = selected.isNotEmpty(),
                        )
                    } else {
                        val allStarred = selected.isNotEmpty() && selected.all { it.starred }
                        NavigationBarItem(
                            selected = false,
                            onClick = { folderPickerTarget = selected to FolderPickerMode.MOVE },
                            icon = { Icon(Icons.Default.DriveFileMove, contentDescription = null) },
                            label = { Text("Move") },
                            enabled = selected.isNotEmpty(),
                        )
                        NavigationBarItem(
                            selected = false,
                            onClick = { folderPickerTarget = selected to FolderPickerMode.COPY },
                            icon = { Icon(Icons.Default.ContentCopy, contentDescription = null) },
                            label = { Text("Copy") },
                            enabled = selected.isNotEmpty(),
                        )
                        NavigationBarItem(
                            selected = false,
                            onClick = { vm.starItems(selected, !allStarred) },
                            icon = {
                                Icon(
                                    if (allStarred) Icons.Default.StarOutline else Icons.Default.Star,
                                    contentDescription = null
                                )
                            },
                            label = { Text(if (allStarred) "Unstar" else "Star") },
                            enabled = selected.isNotEmpty(),
                        )
                        NavigationBarItem(
                            selected = false,
                            onClick = { vm.trashItems(selected) },
                            icon = { Icon(Icons.Default.Delete, contentDescription = null) },
                            label = { Text("Trash") },
                            enabled = selected.isNotEmpty(),
                        )
                    }
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            // Breadcrumbs row
            if (!state.isSpecial) {
                val crumbs = remember(state.path) { FolderPaths.crumbs(state.path) }
                if (crumbs.size > 1) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        crumbs.forEachIndexed { index, (label, path) ->
                            val isLast = index == crumbs.lastIndex
                            SuggestionChip(
                                onClick = {
                                    if (!isLast) {
                                        if (onNavigateCrumb != null) onNavigateCrumb(path) else onNavigateFolder(path)
                                    }
                                },
                                label = { Text(label) },
                                enabled = !isLast,
                            )
                        }
                    }
                    HorizontalDivider(
                        color = DividerDefaults.color.copy(alpha = 0.5f),
                    )
                }
            }

            PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = vm::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    state.loading && state.items.isEmpty() -> {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }

                    state.error != null && state.items.isEmpty() -> {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.padding(24.dp),
                            ) {
                                Text(
                                    text = state.error ?: "Failed to load",
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Button(onClick = vm::refresh) {
                                    Icon(Icons.Default.Refresh, contentDescription = null)
                                    Spacer(modifier = Modifier.size(8.dp))
                                    Text("Try again")
                                }
                            }
                        }
                    }

                    !state.loading && state.items.isEmpty() -> {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            val emptyText = when {
                                state.isTrash -> "Trash is empty"
                                state.isStarred -> "No starred items"
                                state.isInbox -> "Telegram inbox is empty"
                                state.isRecent -> "No recent files"
                                else -> "This folder is empty"
                            }
                            Text(
                                text = emptyText,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    else -> {
                        if (!state.isGrid) {
                            LazyColumn(
                                state = listState,
                                modifier = Modifier.fillMaxSize(),
                            ) {
                                items(state.items, key = { it.id }) { item ->
                                    FileRow(
                                        item = item,
                                        api = api,
                                        isSelectionMode = state.isSelectionMode,
                                        isSelected = item.id in state.selectedIds,
                                        onToggleSelect = { vm.toggleSelection(item) },
                                        onClick = {
                                            if (state.isTrash) {
                                                infoItem = item
                                            } else if (item.isFolder) {
                                                onNavigateFolder(FolderPaths.childPath(item))
                                            } else if (!onOpenFile(item, state.items)) {
                                                infoItem = item
                                            }
                                        },
                                        onLongClick = {
                                            if (!state.isSelectionMode) {
                                                vm.enterSelectionMode(item)
                                            } else {
                                                vm.toggleSelection(item)
                                            }
                                        },
                                        onOpenActions = { actionItem = item },
                                        offline = item.id in offlineIds,
                                    )
                                }
                                if (state.loadingMore) {
                                    item {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(16.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                        }
                                    }
                                }
                            }
                        } else {
                            LazyVerticalGrid(
                                columns = GridCells.Adaptive(minSize = 160.dp),
                                state = gridState,
                                contentPadding = PaddingValues(12.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.fillMaxSize(),
                            ) {
                                items(state.items, key = { it.id }) { item ->
                                    FileGridCard(
                                        item = item,
                                        api = api,
                                        isSelectionMode = state.isSelectionMode,
                                        isSelected = item.id in state.selectedIds,
                                        onToggleSelect = { vm.toggleSelection(item) },
                                        onClick = {
                                            if (state.isTrash) {
                                                infoItem = item
                                            } else if (item.isFolder) {
                                                onNavigateFolder(FolderPaths.childPath(item))
                                            } else if (!onOpenFile(item, state.items)) {
                                                infoItem = item
                                            }
                                        },
                                        onLongClick = {
                                            if (!state.isSelectionMode) {
                                                vm.enterSelectionMode(item)
                                            } else {
                                                vm.toggleSelection(item)
                                            }
                                        },
                                        onOpenActions = { actionItem = item },
                                    )
                                }
                                if (state.loadingMore) {
                                    item(span = { GridItemSpan(maxLineSpan) }) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(16.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Dialogs & Sheets ────────────────────────────────────────────────────────

    if (showSortSheet) {
        SortViewSheet(
            sortBy = state.sortBy,
            ascending = state.ascending,
            isGrid = state.isGrid,
            onSortChange = vm::setSort,
            onViewModeChange = vm::setViewMode,
            onDismiss = { showSortSheet = false },
        )
    }

    actionItem?.let { target ->
        ItemActionSheet(
            item = target,
            api = api,
            isTrash = state.isTrash,
            isInbox = state.isInbox,
            onOpenFolder = if (target.isFolder) {
                { folder -> onNavigateFolder(FolderPaths.childPath(folder)) }
            } else null,
            onInfo = { infoItem = it },
            onRename = { renameItem = it },
            onMove = { folderPickerTarget = listOf(it) to FolderPickerMode.MOVE },
            onCopy = { folderPickerTarget = listOf(it) to FolderPickerMode.COPY },
            onToggleStar = { vm.toggleStar(it) },
            onTrash = { vm.trashItems(listOf(it)) },
            onRestore = { vm.restoreItems(listOf(it)) },
            onDeleteForever = { deleteForeverItems = listOf(it) },
            onDownload = onDownload,
            onDismiss = { actionItem = null },
        )
    }

    infoItem?.let { target ->
        FileInfoSheet(
            item = target,
            api = api,
            onDismiss = { infoItem = null },
        )
    }

    renameItem?.let { target ->
        RenameDialog(
            initialName = target.name,
            isFolder = target.isFolder,
            onDismiss = { renameItem = null },
            onConfirm = { newName ->
                renameItem = null
                vm.rename(target, newName)
            },
        )
    }

    if (showNewFolderDialog) {
        NewFolderDialog(
            onDismiss = { showNewFolderDialog = false },
            onConfirm = { name ->
                showNewFolderDialog = false
                vm.createFolder(name)
            },
        )
    }

    if (showEmptyTrashDialog) {
        ConfirmDialog(
            title = "Empty trash?",
            message = "All items in the trash will be permanently deleted. This action cannot be undone.",
            confirmText = "Empty trash",
            isDestructive = true,
            onDismiss = { showEmptyTrashDialog = false },
            onConfirm = {
                showEmptyTrashDialog = false
                vm.emptyTrash()
            },
        )
    }

    deleteForeverItems?.let { targets ->
        val title = if (targets.size == 1) "Delete '${targets.first().name}' forever?" else "Delete ${targets.size} items forever?"
        ConfirmDialog(
            title = title,
            message = "This action cannot be undone.",
            confirmText = "Delete forever",
            isDestructive = true,
            onDismiss = { deleteForeverItems = null },
            onConfirm = {
                deleteForeverItems = null
                vm.deleteForeverItems(targets)
            },
        )
    }

    folderPickerTarget?.let { (targets, mode) ->
        val title = if (mode == FolderPickerMode.MOVE) "Move to folder" else "Copy to folder"
        val label = if (mode == FolderPickerMode.MOVE) "Move here" else "Copy here"
        FolderPickerSheet(
            title = title,
            confirmActionLabel = label,
            sourceItems = targets,
            api = api,
            onSelectFolder = { dest ->
                folderPickerTarget = null
                if (mode == FolderPickerMode.MOVE) {
                    vm.moveItems(targets, dest)
                } else {
                    vm.copyItems(targets, dest)
                }
            },
            onDismiss = { folderPickerTarget = null },
        )
    }
}
