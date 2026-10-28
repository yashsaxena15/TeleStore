package com.backendforge.telestore.ui.home

import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.IconButton
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Badge
import androidx.compose.foundation.layout.WindowInsets
import com.backendforge.telestore.R
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.Image
import com.backendforge.telestore.ui.components.rememberHaptics
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKind
import com.backendforge.telestore.core.FolderPaths
import com.backendforge.telestore.core.PlayQueue
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.Session
import com.backendforge.telestore.data.WatchEntry
import com.backendforge.telestore.player.formatTime
import com.backendforge.telestore.ui.components.FileThumbnail
import com.backendforge.telestore.ui.components.NewFolderDialog
import java.util.Calendar

/** Places Home links to, besides files and folders. */
enum class HomeShortcut(val label: String) { PLAYLISTS("Playlists"), STARRED("Starred"), RECENT("Recent"), VAULT("Vault"), TRASH("Trash") }

@kotlin.OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    vm: HomeViewModel,
    container: AppContainer,
    session: Session,
    onSearch: () -> Unit,
    onAccount: () -> Unit,
    onNotifications: () -> Unit,
    onKind: (FileKind) -> Unit,
    onShortcut: (HomeShortcut) -> Unit,
    onOpenFolder: (String) -> Unit,
    onOpenFile: (FileItem, List<FileItem>) -> Boolean,
    onResume: (WatchEntry) -> Unit,
    onUpload: (String) -> Unit,
    onCreateFolder: (String) -> Unit,
    onAddLink: () -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()
    val history by container.watchHistory.entries.collectAsStateWithLifecycle()
    val watching = remember(history) { container.watchHistory.continueWatching().take(10) }
    val api = container.api()
    var newMenu by remember { mutableStateOf(false) }
    var newFolder by remember { mutableStateOf(false) }

    val unread by container.unreadNotifications.collectAsStateWithLifecycle()
    // The header pads for the status bar itself (and scrolls away with the page), so the
    // Scaffold mustn't add that space a second time
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        floatingActionButton = {
            Box {
                FloatingActionButton(onClick = { newMenu = true }, containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer) {
                    Icon(Icons.Filled.Add, contentDescription = "New")
                }
                DropdownMenu(expanded = newMenu, onDismissRequest = { newMenu = false }) {
                    DropdownMenuItem(text = { Text("Upload files") }, leadingIcon = { Icon(Icons.Filled.Upload, null) }, onClick = { newMenu = false; onUpload(TeleStoreApi.HOME) })
                    DropdownMenuItem(text = { Text("New folder") }, leadingIcon = { Icon(Icons.Filled.CreateNewFolder, null) }, onClick = { newMenu = false; newFolder = true })
                    DropdownMenuItem(text = { Text("Add from link") }, leadingIcon = { Icon(Icons.Filled.Link, null) }, onClick = { newMenu = false; onAddLink() })
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(isRefreshing = state.loading, onRefresh = { haptics.confirm(); vm.refresh() }, modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(160.dp),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                full { Header(session.username, unread, onNotifications, onAccount) }
                full { SearchBar(onSearch) }
                full {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
                        items(listOf(FileKind.VIDEO to "Videos", FileKind.PHOTO to "Photos", FileKind.AUDIO to "Music", FileKind.DOCUMENT to "Docs")) { (kind, label) ->
                            AssistChip(onClick = { onKind(kind) }, label = { Text(label) }, shape = RoundedCornerShape(17.dp))
                        }
                        items(HomeShortcut.entries.toList()) { s ->
                            AssistChip(onClick = { onShortcut(s) }, label = { Text(s.label) }, shape = RoundedCornerShape(17.dp))
                        }
                    }
                }

                if (watching.isNotEmpty()) {
                    full { SectionTitle("Continue watching") }
                    full {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(watching, key = { it.fileId }) { entry -> ContinueCard(entry, api, onClick = { onResume(entry) }) }
                        }
                    }
                }

                if (state.recent.isNotEmpty()) {
                    full { SectionTitle("Recent", action = "See all") { onShortcut(HomeShortcut.RECENT) } }
                    full {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(state.recent, key = { it.id }) { item -> RecentCard(item, api) { onOpenFile(item, state.recent) } }
                        }
                    }
                }

                state.error?.let { msg -> full { Text(msg, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) } }

                if (state.folders.isNotEmpty()) {
                    full { SectionTitle("Folders") }
                    items(state.folders, key = { it.id }) { folder ->
                        FolderTile(folder) { onOpenFolder(FolderPaths.childPath(folder)) }
                    }
                }
            }
        }
    }

    if (newFolder) {
        NewFolderDialog(onDismiss = { newFolder = false }, onConfirm = { name -> newFolder = false; onCreateFolder(name) })
    }
}

private fun androidx.compose.foundation.lazy.grid.LazyGridScope.full(content: @Composable () -> Unit) {
    item(span = { GridItemSpan(maxLineSpan) }) { content() }
}

@Composable
private fun Header(username: String, unread: Int, onNotifications: () -> Unit, onAccount: () -> Unit) {
    val hour = remember { Calendar.getInstance().get(Calendar.HOUR_OF_DAY) }
    val greeting = when (hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        else -> "Good evening"
    }
    Row(Modifier.statusBarsPadding().padding(top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        AppLogo(30)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(greeting, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(username.substringBefore('@').ifEmpty { "Welcome" }, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onNotifications) {
            BadgedBox(badge = { if (unread > 0) Badge { Text(if (unread > 99) "99+" else unread.toString()) } }) {
                Icon(Icons.Outlined.Notifications, contentDescription = if (unread > 0) "Notifications, $unread new" else "Notifications")
            }
        }
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer).clickable(onClick = onAccount),
            contentAlignment = Alignment.Center,
        ) {
            Text(username.firstOrNull()?.uppercase() ?: "?", color = MaterialTheme.colorScheme.onSecondaryContainer, fontWeight = FontWeight.Bold)
        }
    }
}

/** TeleStore's mark: the cloud, infinity loop and paper plane ([sizeDp] high, wider than tall). */
@Composable
fun AppLogo(sizeDp: Int) {
    Image(
        painter = painterResource(R.drawable.logo_symbol),
        contentDescription = "TeleStore",
        contentScale = ContentScale.Fit,
        modifier = Modifier.height(sizeDp.dp).aspectRatio(LOGO_RATIO),
    )
}

/** The logo's width to height. */
const val LOGO_RATIO = 381f / 220f

@Composable
private fun SearchBar(onSearch: () -> Unit) {
    Surface(
        onClick = onSearch,
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().height(48.dp).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(24.dp)),
    ) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Search, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(10.dp))
            Text("Search all your files", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun SectionTitle(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
private fun ContinueCard(entry: WatchEntry, api: TeleStoreApi, onClick: () -> Unit) {
    Column(Modifier.width(200.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().height(112.dp).clip(RoundedCornerShape(12.dp))) {
            FileThumbnail(item = entry.asFile(), api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 12.dp, iconSize = 32.dp)
            Text(
                "${formatTime(entry.leftMs)} left", color = Color.White, style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.align(Alignment.TopEnd).padding(8.dp).background(Color(0x99000000), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
            )
            LinearProgressIndicator(
                progress = { entry.progress }, modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp),
                trackColor = Color(0x55FFFFFF),
            )
        }
        Text(PlayQueue.title(entry.asFile()), style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun RecentCard(item: FileItem, api: TeleStoreApi, onClick: () -> Unit) {
    Column(Modifier.width(140.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)) {
        FileThumbnail(item = item, api = api, modifier = Modifier.fillMaxWidth().aspectRatio(1.4f), shapeRadius = 12.dp, iconSize = 30.dp)
        Text(item.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun FolderTile(folder: FileItem, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(14.dp)),
    ) {
        Column(Modifier.padding(14.dp)) {
            Icon(Icons.Filled.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primaryContainer)
            Text(folder.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        }
    }
}
