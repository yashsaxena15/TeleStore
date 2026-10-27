package com.backendforge.telestore.ui.notify

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.OndemandVideo
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.NotificationKind
import com.backendforge.telestore.core.NotificationTarget
import com.backendforge.telestore.core.ServerNotification
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.transfers.OfflineFiles
import com.backendforge.telestore.transfers.TransferStatus
import com.backendforge.telestore.ui.components.FileKindBox
import com.backendforge.telestore.ui.components.formatBytes
import com.backendforge.telestore.ui.components.rememberHaptics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
internal fun ago(iso: String?, now: Instant = Instant.now()): String {
    val time = iso?.let { runCatching { Instant.parse(if (it.endsWith("Z")) it else "${it}Z") }.getOrNull() } ?: return ""
    val minutes = Duration.between(time, now).toMinutes().coerceAtLeast(0)
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 24 * 60 -> "${minutes / 60} h ago"
        minutes < 2 * 24 * 60 -> "yesterday"
        else -> "${minutes / (24 * 60)} days ago"
    }
}

private fun iconFor(kind: String): ImageVector = when (NotificationKind.of(kind)) {
    NotificationKind.TRANSFER, NotificationKind.PHONE_TRANSFERS -> Icons.Default.SwapVert
    NotificationKind.MEDIA, NotificationKind.INSTAGRAM -> Icons.Default.OndemandVideo
    NotificationKind.PLAYLIST_SYNC -> Icons.AutoMirrored.Filled.QueueMusic
    NotificationKind.INBOX -> Icons.Default.Inbox
    NotificationKind.STORAGE -> Icons.Default.Storage
    NotificationKind.SIGN_IN -> Icons.AutoMirrored.Filled.Login
    NotificationKind.BACKUP -> Icons.Default.PhotoCamera
    NotificationKind.OFFLINE -> Icons.Default.CloudDone
    null -> Icons.Default.Notifications
}

/** The same list as the website's bell, and a switch for every kind of phone notification. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(container: AppContainer, onBack: () -> Unit, onOpen: (NotificationTarget) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val snackbar = remember { SnackbarHostState() }
    var items by remember { mutableStateOf<List<ServerNotification>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    val off by container.settings.notificationsOffFlow.collectAsStateWithLifecycle()
    val phoneAllows = remember { NotificationManagerCompat.from(context).areNotificationsEnabled() }

    suspend fun load() {
        try {
            val list = container.api().notifications(limit = 50)
            items = list.items
            container.unreadNotifications.value = list.unread
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            snackbar.showSnackbar((e as? ApiException)?.message ?: "Couldn't load notifications.")
        }
        loading = false
    }
    LaunchedEffect(Unit) { load() }

    fun markRead(ids: List<String>, all: Boolean = false) {
        items = items.map { if (all || it.id in ids) it.copy(read = true) else it }
        scope.launch { runCatching { container.unreadNotifications.value = container.api().markNotificationsRead(ids, all) } }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Notifications") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (items.any { !it.read }) IconButton(onClick = { haptics.confirm(); markRead(emptyList(), all = true) }) {
                        Icon(Icons.Default.DoneAll, contentDescription = "Mark all as read")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        PullToRefreshBox(isRefreshing = loading && items.isNotEmpty(), onRefresh = { loading = true; scope.launch { load() } }, modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
                if (!phoneAllows) {
                    item {
                        ListItem(
                            headlineContent = { Text("Notifications are off for TeleStore") },
                            supportingContent = { Text("Turn them on in the phone's settings to get these on your phone.") },
                            trailingContent = {
                                TextButton(onClick = {
                                    context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                                }) { Text("Turn on") }
                            },
                        )
                    }
                }
                items(items, key = { it.id }) { note ->
                    ListItem(
                        leadingContent = { Icon(iconFor(note.kind), contentDescription = null) },
                        headlineContent = { Text(note.title, fontWeight = if (note.read) FontWeight.Normal else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = { Text(listOf(note.body, ago(note.createdAt)).filter { it.isNotBlank() }.joinToString(" · "), maxLines = 3) },
                        trailingContent = { if (!note.read) Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape)) },
                        colors = if (note.read) ListItemDefaults.colors() else ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)),
                        modifier = Modifier.animateItem().clickable {
                            if (!note.read) markRead(listOf(note.id))
                            note.target?.let(onOpen)
                        },
                    )
                }
                if (!loading && items.isEmpty()) {
                    item {
                        Text(
                            "Nothing yet. Finished transfers, new files in your Telegram Inbox and new sign-ins show up here.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(24.dp),
                        )
                    }
                }
                item {
                    HorizontalDivider(Modifier.padding(top = 8.dp))
                    Text(
                        "Show on this phone", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
                    )
                    Text(
                        "The app checks every 15 minutes when it's closed, so some can arrive a little late.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
                items(NotificationKind.entries, key = { "switch-${it.wire}" }) { kind ->
                    val on = kind.wire !in off
                    ListItem(
                        leadingContent = { Icon(iconFor(kind.wire), contentDescription = null) },
                        headlineContent = { Text(kind.label) },
                        supportingContent = { Text(kind.detail) },
                        trailingContent = { Switch(checked = on, onCheckedChange = { haptics.confirm(); container.settings.setNotification(kind.wire, it) }) },
                        modifier = Modifier.clickable { container.settings.setNotification(kind.wire, !on) },
                    )
                }
            }
        }
    }
}

/** Files and folders kept on this phone, the space they use, and removing them. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OfflineScreen(container: AppContainer, onBack: () -> Unit, onOpenFile: (FileItem, List<FileItem>) -> Unit, onOpenFolder: (String) -> Unit) {
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val transfers by container.transfers.store.items.collectAsStateWithLifecycle()
    val folders by container.offlineFolders.paths.collectAsStateWithLifecycle()
    val saved = remember(transfers) { transfers.filter { it.offline } }
    val used = remember(transfers) { OfflineFiles.usedBytes(context) }
    val free = remember(transfers) { OfflineFiles.freeBytes(context) }
    var confirmAll by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Offline files") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (saved.isNotEmpty() || folders.isNotEmpty()) TextButton(onClick = { confirmAll = true }) { Text("Remove all") }
                },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Text(
                    "${saved.count { it.status == TransferStatus.DONE }} files · ${formatBytes(used)} used · ${formatBytes(free)} free on this phone",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
            items(folders.sorted(), key = { "folder-$it" }) { path ->
                ListItem(
                    leadingContent = { Icon(Icons.Default.Folder, contentDescription = null) },
                    headlineContent = { Text(path.substringAfterLast('/'), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingContent = { Text("Folder · new files are saved too") },
                    trailingContent = {
                        IconButton(onClick = { haptics.confirm(); container.offlineFolders.drop(path) }) { Icon(Icons.Default.Delete, contentDescription = "Remove") }
                    },
                    modifier = Modifier.animateItem().clickable { onOpenFolder(path) },
                )
            }
            val files = saved.filter { it.fileId != null }
            val asItems = files.map { FileItem(id = it.fileId!!, name = it.name, size = it.size) }
            items(files, key = { it.id }) { t ->
                val item = FileItem(id = t.fileId!!, name = t.name, size = t.size)
                val state = when (t.status) {
                    TransferStatus.DONE -> formatBytes(t.size)
                    TransferStatus.FAILED -> "Failed: ${t.error ?: "try again"}"
                    else -> "Saving… ${(t.progress * 100).toInt()}%"
                }
                ListItem(
                    leadingContent = { FileKindBox(item.kind, Modifier.size(40.dp)) },
                    headlineContent = { Text(t.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingContent = { Text(if (t.offlineFolder != null) "$state · from ${t.offlineFolder.substringAfterLast('/')}" else state) },
                    trailingContent = {
                        IconButton(onClick = { haptics.confirm(); container.transfers.removeOffline(setOf(item.id)) }) { Icon(Icons.Default.Delete, contentDescription = "Remove") }
                    },
                    modifier = Modifier.animateItem().clickable(enabled = t.status == TransferStatus.DONE) { onOpenFile(item, asItems) },
                )
            }
            if (saved.isEmpty() && folders.isEmpty()) {
                item {
                    Text(
                        "Nothing here yet. Keep a file or folder on this phone with ⋮ › Make available offline; it then opens and plays without internet.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                }
            }
        }
    }

    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            title = { Text("Remove all offline files?") },
            text = { Text("They stay in TeleStore; only the copies on this phone are deleted.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmAll = false
                    container.offlineFolders.clear()
                    container.transfers.clearOffline()
                }) { Text("Remove all") }
            },
            dismissButton = { TextButton(onClick = { confirmAll = false }) { Text("Cancel") } },
        )
    }
}
