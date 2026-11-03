package com.backendforge.telestore.ui.sharing

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DriveFileMove
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.DateFormatter
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.MyShare
import com.backendforge.telestore.core.ShareAction
import com.backendforge.telestore.core.ShareBrowse
import com.backendforge.telestore.core.ShareItem
import com.backendforge.telestore.core.ShareRole
import com.backendforge.telestore.core.ShareRules
import com.backendforge.telestore.core.ShareWithMe
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.AppTopBar
import com.backendforge.telestore.ui.components.ConfirmDialog
import com.backendforge.telestore.ui.components.FileRow
import com.backendforge.telestore.ui.components.FileThumbnail
import com.backendforge.telestore.ui.components.NewFolderDialog
import com.backendforge.telestore.ui.components.RenameDialog
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private fun messageOf(e: Exception, fallback: String): String = (e as? ApiException)?.message ?: fallback

/** Loads a list for a screen, with pull to refresh and the server's message on failure. */
private class Loaded<T>(val items: List<T>?, val error: String?)

// ── Shared with me ──────────────────────────────────────────────────────────────

/** Files and folders other accounts shared with this one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SharedWithMeScreen(container: AppContainer, onBack: () -> Unit, onOpen: (ShareWithMe) -> Unit) {
    var state by remember { mutableStateOf(Loaded<ShareWithMe>(null, null)) }
    var refreshing by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        state = try {
            Loaded(container.api().sharedWithMe(), null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Loaded(state.items, messageOf(e, "Couldn't load what's shared with you."))
        }
        refreshing = false
    }
    Scaffold(topBar = { AppTopBar(title = "Shared with me", onBack = onBack) }) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; reload++ },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            ListBody(
                state = state,
                empty = "Nothing has been shared with you yet. When someone shares a file or folder with you, it shows here.",
            ) { list ->
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                    items(list, key = { it.shareId }) { share ->
                        ShareListRow(
                            item = share.item.toFileItem(share.shareId),
                            api = container.api(),
                            title = share.item.name,
                            detail = listOfNotNull(
                                share.owner.name.ifBlank { share.owner.username.orEmpty() }.takeIf { it.isNotBlank() },
                                share.shareRole.label,
                                DateFormatter.formatShort(share.sharedAt).takeIf { it.isNotBlank() },
                            ).joinToString(" · "),
                            onClick = { onOpen(share) },
                        )
                    }
                }
            }
        }
    }
}

// ── Shared by me ────────────────────────────────────────────────────────────────

/** This account's files and folders shared with people or by a link; tap one for its Share sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SharedByMeScreen(container: AppContainer, onBack: () -> Unit) {
    var state by remember { mutableStateOf(Loaded<MyShare>(null, null)) }
    var refreshing by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<MyShare?>(null) }
    LaunchedEffect(reload) {
        state = try {
            Loaded(container.api().sharedByMe(), null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Loaded(state.items, messageOf(e, "Couldn't load what you share."))
        }
        refreshing = false
    }
    Scaffold(topBar = { AppTopBar(title = "Shared by me", onBack = onBack) }) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; reload++ },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            ListBody(
                state = state,
                empty = "You haven't shared anything yet. Open a file's menu and tap Share.",
            ) { list ->
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                    items(list, key = { it.shareId }) { share ->
                        ShareListRow(
                            item = share.item.toFileItem(),
                            api = container.api(),
                            title = share.item.name,
                            detail = ShareRules.accessSummary(share.members, share.link) + if (share.trashed) " · In Trash" else "",
                            onClick = { open = share },
                        )
                    }
                }
            }
        }
    }
    open?.let { share ->
        var changed by remember(share.shareId) { mutableStateOf(false) }
        ShareSheet(
            api = container.api(),
            itemId = share.item.id,
            itemName = share.item.name,
            onChanged = { changed = true },
            onDismiss = {
                open = null
                if (changed) reload++
            },
        )
    }
}

@Composable
private fun <T> ListBody(state: Loaded<T>, empty: String, content: @Composable (List<T>) -> Unit) {
    val list = state.items
    when {
        list == null && state.error != null -> Message(state.error, error = true)
        list == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        list.isEmpty() -> Message(empty)
        else -> content(list)
    }
}

/** A centred line in an otherwise empty, still scrollable screen (so pull to refresh works). */
@Composable
private fun Message(text: String, error: Boolean = false) {
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(32.dp),
            )
        }
    }
}

@Composable
private fun ShareListRow(item: FileItem, api: TeleStoreApi, title: String, detail: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        FileThumbnail(item = item, api = api, modifier = Modifier.size(44.dp), shapeRadius = 10.dp, iconSize = 22.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (detail.isNotBlank()) {
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Inside a share ──────────────────────────────────────────────────────────────

/**
 * A share opened from Shared with me: its folders (breadcrumb and back), files opened with the
 * app's viewers, downloads, and for editors upload, new folder, rename, move and trash.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareBrowseScreen(
    container: AppContainer,
    shareId: String,
    onBack: () -> Unit,
    /** Opens a file with its folder's others queued; false when there's no viewer for it. */
    onOpenFile: (FileItem, List<FileItem>) -> Boolean,
    onDownload: (FileItem) -> Unit,
    /** A folder in the share ([path] relative to the shared folder) as ZIP. */
    onDownloadFolder: (path: String, name: String) -> Unit,
    /** Picks files on the phone and uploads them into [path] of the share. */
    onUpload: (path: String) -> Unit,
) {
    val api = container.api()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var path by rememberSaveable(shareId) { mutableStateOf("") }
    var page by remember { mutableStateOf<ShareBrowse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var actionsFor by remember { mutableStateOf<ShareItem?>(null) }
    var renaming by remember { mutableStateOf<ShareItem?>(null) }
    var moving by remember { mutableStateOf<ShareItem?>(null) }
    var trashing by remember { mutableStateOf<ShareItem?>(null) }
    var newFolder by remember { mutableStateOf(false) }

    LaunchedEffect(shareId, path, reload) {
        try {
            page = api.browseShare(shareId, path)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = messageOf(e, "Couldn't open this share.")
        }
        refreshing = false
    }
    // Uploads into this share show up when they finish
    LaunchedEffect(shareId) { container.transfers.store.uploaded.collect { reload++ } }

    fun change(done: String, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
                Toast.makeText(context, done, Toast.LENGTH_SHORT).show()
                reload++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Toast.makeText(context, messageOf(e, "Couldn't do that. Try again."), Toast.LENGTH_LONG).show()
            }
        }
    }

    val current = page
    val role = current?.shareRole ?: ShareRole.VIEWER
    val isFolderShare = current?.root?.isFolder ?: true
    val rootName = current?.root?.name.orEmpty()
    val files = current?.items.orEmpty().map { it.toFileItem(shareId) }

    BackHandler(enabled = path.isNotEmpty()) { path = ShareRules.parentPath(path) }

    Scaffold(
        topBar = {
            AppTopBar(
                title = if (path.isEmpty()) rootName.ifBlank { "Shared" } else path.substringAfterLast('/'),
                subtitle = current?.let { listOfNotNull(it.owner.name.takeIf { n -> n.isNotBlank() }?.let { n -> "Shared by $n" }, role.label).joinToString(" · ") },
                onBack = { if (path.isNotEmpty()) path = ShareRules.parentPath(path) else onBack() },
                backIcon = Icons.AutoMirrored.Filled.ArrowBack,
            ) {
                if (current != null && isFolderShare) {
                    if (ShareRules.can(role, ShareAction.UPLOAD, isFolderShare)) {
                        IconButton(onClick = { onUpload(path) }) { Icon(Icons.Default.Upload, contentDescription = "Upload here") }
                    }
                    if (ShareRules.can(role, ShareAction.NEW_FOLDER, isFolderShare)) {
                        IconButton(onClick = { newFolder = true }) { Icon(Icons.Default.CreateNewFolder, contentDescription = "New folder") }
                    }
                    IconButton(onClick = { onDownloadFolder(path, if (path.isEmpty()) rootName else path.substringAfterLast('/')) }) {
                        Icon(Icons.Default.Download, contentDescription = "Download as ZIP")
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (current != null && isFolderShare && path.isNotEmpty()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
                ) {
                    val crumbs = ShareRules.crumbs(rootName, path)
                    crumbs.forEachIndexed { i, (label, to) ->
                        if (i > 0) Icon(Icons.Default.ChevronRight, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = { path = to }, enabled = to != path) { Text(label, maxLines = 1) }
                    }
                }
            }
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { refreshing = true; reload++ },
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    current == null && error != null -> Message(error!!, error = true)
                    current == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    files.isEmpty() -> Message(if (error != null) error!! else "This folder is empty.", error = error != null)
                    else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 4.dp)) {
                        items(current?.items.orEmpty(), key = { it.id }) { shared ->
                            val file = shared.toFileItem(shareId)
                            FileRow(
                                item = file,
                                api = api,
                                isSelectionMode = false,
                                isSelected = false,
                                onToggleSelect = {},
                                onClick = {
                                    if (shared.isFolder) path = ShareRules.childPath(shared.path, shared.name)
                                    else if (!onOpenFile(file, files)) actionsFor = shared
                                },
                                onLongClick = { actionsFor = shared },
                                onOpenActions = { actionsFor = shared },
                            )
                        }
                    }
                }
            }
        }
    }

    actionsFor?.let { shared ->
        val isRoot = current != null && shared.id == current.root.id
        val allowed = ShareRules.actions(role, isFolderShare, isRoot)
        val file = shared.toFileItem(shareId)
        ModalBottomSheet(onDismissRequest = { actionsFor = null }) {
            Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                    FileThumbnail(item = file, api = api, modifier = Modifier.size(40.dp), shapeRadius = 10.dp, iconSize = 22.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(shared.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (shared.isFolder) "Folder" else formatBytes(shared.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                fun close() { actionsFor = null }
                if (shared.isFolder) {
                    SheetRow(Icons.Default.FolderOpen, "Open folder") { close(); path = ShareRules.childPath(shared.path, shared.name) }
                    SheetRow(Icons.Default.Download, "Download as ZIP") { close(); onDownloadFolder(ShareRules.childPath(shared.path, shared.name), shared.name) }
                } else {
                    SheetRow(Icons.AutoMirrored.Filled.OpenInNew, "Open") { close(); onOpenFile(file, files) }
                    SheetRow(Icons.Default.Download, "Download to phone") { close(); onDownload(file) }
                }
                if (ShareAction.RENAME in allowed) SheetRow(Icons.Default.Edit, "Rename") { close(); renaming = shared }
                if (ShareAction.MOVE in allowed) SheetRow(Icons.Default.DriveFileMove, "Move...") { close(); moving = shared }
                if (ShareAction.TRASH in allowed) {
                    SheetRow(Icons.Default.Delete, "Move to Trash", color = MaterialTheme.colorScheme.error) { close(); trashing = shared }
                }
            }
        }
    }

    if (newFolder) {
        NewFolderDialog(onDismiss = { newFolder = false }) { name ->
            newFolder = false
            change("Folder \"$name\" created.") { api.shareNewFolder(shareId, path, name) }
        }
    }
    renaming?.let { shared ->
        RenameDialog(initialName = shared.name, isFolder = shared.isFolder, onDismiss = { renaming = null }) { name ->
            renaming = null
            change("Renamed to \"$name\".") { api.shareRename(shareId, shared.id, name) }
        }
    }
    trashing?.let { shared ->
        ConfirmDialog(
            title = "Move to Trash?",
            message = "\"${shared.name}\" goes to the owner's Trash.",
            confirmText = "Move to Trash",
            isDestructive = true,
            onDismiss = { trashing = null },
            onConfirm = {
                trashing = null
                change("Moved to Trash.") { api.shareTrash(shareId, shared.id) }
            },
        )
    }
    moving?.let { shared ->
        ShareFolderPicker(
            api = api,
            shareId = shareId,
            rootName = rootName,
            moving = shared,
            onDismiss = { moving = null },
            onPick = { target ->
                moving = null
                change("Moved.") { api.shareMove(shareId, shared.id, target) }
            },
        )
    }
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = color)
    }
}

/** Chooses a folder inside the share for "Move". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShareFolderPicker(
    api: TeleStoreApi,
    shareId: String,
    rootName: String,
    moving: ShareItem,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    var at by remember { mutableStateOf("") }
    var folders by remember { mutableStateOf<List<ShareItem>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(at) {
        folders = null
        try {
            folders = api.browseShare(shareId, at).items.filter { it.isFolder && it.id != moving.id }
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = messageOf(e, "Couldn't load folders.")
            folders = emptyList()
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Text("Move \"${moving.name}\" to", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
            ) {
                ShareRules.crumbs(rootName, at).forEachIndexed { i, (label, to) ->
                    if (i > 0) Icon(Icons.Default.ChevronRight, contentDescription = null, modifier = Modifier.size(16.dp))
                    TextButton(onClick = { at = to }, enabled = to != at) { Text(label, maxLines = 1) }
                }
            }
            HorizontalDivider()
            val list = folders
            when {
                list == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(20.dp))
                list.isEmpty() -> Text("No folders here.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp))
                else -> LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false)) {
                    items(list, key = { it.id }) { folder ->
                        SheetRow(Icons.Default.Folder, folder.name) { at = ShareRules.childPath(folder.path, folder.name) }
                    }
                }
            }
            Row(
                horizontalArrangement = Arrangement.End,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                TextButton(onClick = { onPick(at) }, enabled = ShareRules.canMoveTo(moving, at)) { Text("Move here") }
            }
        }
    }
}

