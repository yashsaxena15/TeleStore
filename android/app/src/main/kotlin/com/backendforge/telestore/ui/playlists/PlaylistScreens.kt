package com.backendforge.telestore.ui.playlists

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.Playlist
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.FileThumbnail
import com.backendforge.telestore.ui.components.formatBytes
import com.backendforge.telestore.ui.components.rememberHaptics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Runs [block], turning a failure into a message for the user (cancellation still cancels). */
private suspend fun <T> attempt(fallback: String, onError: (String) -> Unit, block: suspend () -> T): T? = try {
    block()
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    onError((e as? ApiException)?.message ?: fallback)
    null
}

/** A playlist's picture: a heart for Liked music, else its first item, else a music note. */
@Composable
fun PlaylistCover(playlist: Playlist, api: TeleStoreApi, size: Dp = 56.dp) {
    val shape = RoundedCornerShape(size / 6)
    when {
        playlist.isLiked -> Box(
            Modifier.size(size).clip(shape).background(Brush.linearGradient(listOf(Color(0xFF4F46E5), Color(0xFFDB2777)))),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Favorite, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * 0.42f)) }
        playlist.cover != null -> FileThumbnail(item = playlist.cover!!, api = api, modifier = Modifier.size(size), shapeRadius = size / 6, iconSize = size * 0.45f)
        else -> Box(
            Modifier.size(size).clip(shape).background(MaterialTheme.colorScheme.secondaryContainer),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.AutoMirrored.Filled.QueueMusic, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(size * 0.45f)) }
    }
}

private fun countLabel(count: Int) = if (count == 1) "1 item" else "$count items"

/** Asks for a playlist name (new or renamed). */
@Composable
fun PlaylistNameDialog(title: String, initial: String = "", confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(100) },
                label = { Text("Name") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = { TextButton(onClick = { onConfirm(name.trim()) }, enabled = name.isNotBlank() && name.trim() != initial) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ── All playlists ──────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaylistsScreen(container: AppContainer, onBack: (() -> Unit)?, onOpen: (Playlist) -> Unit) {
    val store = container.playlists
    val playlists by store.playlists.collectAsStateWithLifecycle()
    val api = container.api()
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val snackbar = remember { SnackbarHostState() }
    var loading by remember { mutableStateOf(true) }
    var creating by remember { mutableStateOf(false) }
    val say: (String) -> Unit = { scope.launch { snackbar.showSnackbar(it) } }

    suspend fun load() {
        attempt("Couldn't load your playlists.", say) { store.refresh() }
        loading = false
    }
    LaunchedEffect(Unit) { load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Playlists") },
                navigationIcon = { if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { creating = true }, icon = { Icon(Icons.Filled.Add, contentDescription = null) }, text = { Text("New playlist") })
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        PullToRefreshBox(isRefreshing = loading && playlists.isNotEmpty(), onRefresh = { haptics.confirm(); loading = true; scope.launch { load() } }, modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                items(playlists, key = { it.id }) { playlist ->
                    ListItem(
                        headlineContent = { Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium) },
                        supportingContent = { Text(if (playlist.isLiked) "Playlist · ${countLabel(playlist.count)} · always here" else "Playlist · ${countLabel(playlist.count)}") },
                        leadingContent = { PlaylistCover(playlist, api) },
                        modifier = Modifier.animateItem().clickable { onOpen(playlist) },
                    )
                }
                if (!loading && playlists.size <= 1) {
                    item {
                        Text(
                            "Make a playlist with New playlist, or from any song or video: ⋮ › Add to playlist. The heart in the music player adds to Liked music.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(24.dp),
                        )
                    }
                }
            }
        }
    }

    if (creating) {
        PlaylistNameDialog("New playlist", confirm = "Create", onDismiss = { creating = false }) { name ->
            creating = false
            scope.launch { attempt("Couldn't make the playlist.", say) { store.create(name) }?.let(onOpen) }
        }
    }
}

// ── One playlist ───────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaylistScreen(
    container: AppContainer,
    playlistId: String,
    onBack: () -> Unit,
    /** Plays [items] from [index] (music in the music player, videos in the video player). */
    onPlay: (items: List<FileItem>, index: Int) -> Unit,
) {
    val store = container.playlists
    val api = container.api()
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val snackbar = remember { SnackbarHostState() }
    val say: (String) -> Unit = { scope.launch { snackbar.showSnackbar(it) } }
    var playlist by remember { mutableStateOf<Playlist?>(null) }
    var loading by remember { mutableStateOf(true) }
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }

    suspend fun load() {
        attempt("Couldn't open the playlist.", say) { container.api().playlist(playlistId) }?.let { playlist = it }
        loading = false
    }
    LaunchedEffect(playlistId) { load() }

    fun change(fallback: String, block: suspend (Playlist) -> Unit) {
        val current = playlist ?: return
        scope.launch {
            attempt(fallback, say) { block(current) }
            load()
        }
    }

    val items = playlist?.items.orEmpty()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(playlist?.name ?: "", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (playlist?.isLiked == false) {
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "Playlist options") }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(Icons.Filled.Edit, null) }, onClick = { menu = false; renaming = true })
                                DropdownMenuItem(text = { Text("Delete playlist") }, leadingIcon = { Icon(Icons.Filled.Delete, null) }, onClick = { menu = false; deleting = true })
                            }
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        PullToRefreshBox(isRefreshing = loading && playlist != null, onRefresh = { haptics.confirm(); loading = true; scope.launch { load() } }, modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                playlist?.let { p ->
                    item {
                        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            PlaylistCover(p, api, size = 96.dp)
                            Spacer(Modifier.width(16.dp))
                            Column(Modifier.weight(1f)) {
                                Text(p.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                val missing = p.count - items.size
                                Text(
                                    countLabel(items.size) + if (missing > 0) " · $missing in Trash or deleted" else "",
                                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    item {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = { haptics.click(); onPlay(items, 0) }, enabled = items.isNotEmpty(), modifier = Modifier.weight(1f)) {
                                Icon(Icons.Filled.PlayArrow, null); Spacer(Modifier.width(6.dp)); Text("Play")
                            }
                            FilledTonalButton(onClick = { haptics.click(); onPlay(items.shuffled(), 0) }, enabled = items.size > 1, modifier = Modifier.weight(1f)) {
                                Icon(Icons.Filled.Shuffle, null); Spacer(Modifier.width(6.dp)); Text("Shuffle")
                            }
                        }
                        HorizontalDivider(Modifier.padding(top = 16.dp))
                    }
                    if (!loading && items.isEmpty()) {
                        item {
                            Text(
                                if (p.isLiked) "Tap the heart in the music player to add songs here." else "Add songs and videos from their ⋮ menu: Add to playlist.",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(24.dp),
                            )
                        }
                    }
                    itemsIndexed(items, key = { _, item -> item.id }) { index, item ->
                        PlaylistRow(
                            item = item, api = api, index = index, last = items.lastIndex,
                            onClick = { onPlay(items, index) },
                            onMove = { by ->
                                val order = items.toMutableList().apply { add(index + by, removeAt(index)) }
                                playlist = p.copy(items = order) // shows at once; the server's order follows
                                change("Couldn't move it.") { store.reorder(it, order) }
                            },
                            onRemove = { change("Couldn't remove it.") { store.remove(it, listOf(item)) } },
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }
    }

    if (renaming) {
        playlist?.let { p ->
            PlaylistNameDialog("Rename playlist", initial = p.name, confirm = "Rename", onDismiss = { renaming = false }) { name ->
                renaming = false
                change("Couldn't rename the playlist.") { store.rename(it, name) }
            }
        }
    }
    if (deleting) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("Delete “${playlist?.name}”?") },
            text = { Text("The songs and videos stay in your files.") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = false
                    val p = playlist ?: return@TextButton
                    scope.launch { if (attempt("Couldn't delete the playlist.", say) { store.delete(p) } != null) onBack() }
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PlaylistRow(
    item: FileItem,
    api: TeleStoreApi,
    index: Int,
    last: Int,
    onClick: () -> Unit,
    onMove: (by: Int) -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(formatBytes(item.size), maxLines = 1) },
        leadingContent = { FileThumbnail(item = item, api = api, modifier = Modifier.size(44.dp), shapeRadius = 8.dp, iconSize = 22.dp) },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "Options for ${item.name}") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (index > 0) DropdownMenuItem(text = { Text("Move up") }, leadingIcon = { Icon(Icons.Filled.ArrowUpward, null) }, onClick = { menu = false; onMove(-1) })
                    if (index < last) DropdownMenuItem(text = { Text("Move down") }, leadingIcon = { Icon(Icons.Filled.ArrowDownward, null) }, onClick = { menu = false; onMove(1) })
                    DropdownMenuItem(text = { Text("Remove from playlist") }, leadingIcon = { Icon(Icons.Filled.RemoveCircleOutline, null) }, onClick = { menu = false; onRemove() })
                }
            }
        },
        colors = ListItemDefaults.colors(),
        modifier = modifier.clickable(onClick = onClick),
    )
}

// ── Add to playlist ────────────────────────────────────────────────────────────

/** Picks a playlist for [items] (or makes a new one). [onDone] gets the message to show. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddToPlaylistSheet(container: AppContainer, items: List<FileItem>, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    val store = container.playlists
    val playlists by store.playlists.collectAsStateWithLifecycle()
    val api = container.api()
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { store.refreshQuietly() }
    val what = if (items.size == 1) items.first().name else "${items.size} items"
    val ids = items.map { it.id }.toSet()

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().animateContentSize().padding(bottom = 24.dp)) {
            Text("Add to playlist", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp))
            Text(what, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 20.dp))
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
            Spacer(Modifier.size(8.dp))
            ListItem(
                headlineContent = { Text("New playlist") },
                leadingContent = {
                    Box(Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                        Icon(Icons.AutoMirrored.Filled.PlaylistAdd, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                },
                modifier = Modifier.clickable { creating = true },
            )
            LazyColumn {
                items(playlists, key = { it.id }) { playlist ->
                    val already = ids.all { it in playlist.fileIds }
                    ListItem(
                        headlineContent = { Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = { Text(countLabel(playlist.count)) },
                        leadingContent = { PlaylistCover(playlist, api, size = 48.dp) },
                        trailingContent = { if (already) Icon(Icons.Filled.CheckCircle, contentDescription = "Already in it", tint = MaterialTheme.colorScheme.primary) },
                        modifier = Modifier.clickable(enabled = !already) {
                            scope.launch {
                                val done = attempt("Couldn't add to the playlist.", { error = it }) { store.add(playlist, items) } ?: return@launch
                                haptics.confirm()
                                val added = done.added ?: items.size
                                onDone(if (added == 0) "Already in ${playlist.name}" else "Added ${if (added == 1) "1 item" else "$added items"} to ${playlist.name}")
                            }
                        },
                    )
                }
            }
        }
    }

    if (creating) {
        PlaylistNameDialog("New playlist", confirm = "Create", onDismiss = { creating = false }) { name ->
            creating = false
            scope.launch {
                attempt("Couldn't make the playlist.", { error = it }) { store.create(name, items) } ?: return@launch
                haptics.confirm()
                onDone("Added to $name")
            }
        }
    }
}
