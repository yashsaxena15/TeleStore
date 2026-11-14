package com.backendforge.telestore.ui.transfers

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.ArchiveTask
import com.backendforge.telestore.core.RemoteTask
import com.backendforge.telestore.core.RemoteTaskList
import com.backendforge.telestore.core.TransferFilter
import com.backendforge.telestore.core.TransferKind
import com.backendforge.telestore.core.TransferRow
import com.backendforge.telestore.core.TransferRows
import com.backendforge.telestore.core.TransferState
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.transfers.TransferManager
import com.backendforge.telestore.transfers.TransferStatus
import com.backendforge.telestore.ui.components.ConfirmDialog
import com.backendforge.telestore.ui.components.ProgressBar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Transfers: the phone's uploads and downloads and the server's transfers in one list, running
 * first and finished below, with live totals, filter chips, a details sheet for each, and a
 * screen of its own for every folder transfer.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersScreen(
    container: AppContainer,
    onAddLink: () -> Unit = {},
    onGoogleDrive: () -> Unit = {},
    onOpenFolder: (String) -> Unit = {},
) {
    val manager = container.transfers
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val allPhone by manager.store.items.collectAsStateWithLifecycle()
    val phone = remember(allPhone) { allPhone.filter { it.listed } }
    var server by remember { mutableStateOf<RemoteTaskList?>(null) }
    var serverError by remember { mutableStateOf<String?>(null) }
    var archives by remember { mutableStateOf<List<ArchiveTask>>(emptyList()) }
    var refreshTick by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf(TransferFilter.ALL) }
    var openFolder by rememberSaveable { mutableStateOf<String?>(null) }
    var detailsKey by remember { mutableStateOf<String?>(null) }
    var confirmCancelAll by remember { mutableStateOf(false) }
    var confirmCancelFolder by remember { mutableStateOf<TransferRow?>(null) }
    // Finished server transfers swiped away (the server forgets them on Clear finished)
    var hidden by rememberSaveable { mutableStateOf(setOf<String>()) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val features by container.features.collectAsStateWithLifecycle()

    // The server's list, every 3 s while this tab is open (stops when it closes)
    LaunchedEffect(refreshTick) {
        while (true) {
            try {
                server = container.api().remoteTasks()
                serverError = null
                // ZIP jobs: the ones running, and the last few finished in the past day
                archives = runCatching { container.api().archiveTasks().tasks }.getOrDefault(archives).take(10)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                serverError = (e as? ApiException)?.message ?: "Couldn't load the server's transfers."
            }
            refreshing = false
            delay(3_000)
        }
    }

    fun serverAction(done: String? = null, call: suspend () -> Unit) {
        scope.launch {
            try {
                call()
                refreshTick++
                done?.let { snackbar.showSnackbar(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                snackbar.showSnackbar((e as? ApiException)?.message ?: "That didn't work: ${e.message}")
            }
        }
    }

    fun copyLink(link: String) {
        clipboard.setText(AnnotatedString(link))
        scope.launch { snackbar.showSnackbar("Link copied") }
    }

    // A folder has a screen of its own
    val folderId = openFolder
    if (folderId != null) {
        BackHandler { openFolder = null }
        TransferFolderScreen(
            container = container,
            groupId = folderId,
            initial = server?.let { list -> TransferRows.fromServer(list).firstOrNull { it.isFolder && it.id == folderId } },
            onBack = { openFolder = null },
            onOpenFolder = onOpenFolder,
        )
        return
    }

    val serverRows = remember(server) { server?.let(TransferRows::fromServer).orEmpty() }
    val phoneRows = remember(phone) { phone.map { it.toRow() } }
    val all = remember(serverRows, phoneRows, hidden) { TransferRows.sorted(phoneRows + serverRows).filterNot { it.key in hidden } }
    val counts = TransferRows.counts(all)
    val visible = all.filter(filter::matches)
    val running = visible.filter { it.state.active }
    val finished = visible.filterNot { it.state.active }
    val visibleArchives = archives.filter { filter == TransferFilter.ALL || (filter == TransferFilter.ACTIVE && it.active) }

    // Header: running, waiting and paused by Google's limit, and how fast it all goes
    val groups = server?.groups.orEmpty()
    val loose = server?.tasks.orEmpty().filter { it.groupId == null || it.groupId !in groups }
    val (down, up) = TransferRows.totalSpeeds(phoneRows + serverRows)
    val headline = TransferRows.headline(
        running = phone.count { it.status == TransferStatus.RUNNING || it.status == TransferStatus.SAVING } +
            loose.count { it.status in RemoteTask.RUNNING } + groups.values.sumOf { it.running },
        waiting = phone.count { it.status == TransferStatus.QUEUED } + loose.count { it.status == "queued" } + groups.values.sumOf { it.waiting },
        paused = loose.count { it.status == "paused_quota" } + groups.values.sumOf { it.pausedByGoogle },
        downBps = down, upBps = up,
    )

    fun cancelAll() {
        manager.cancelAll()
        serverAction("Cancelled every transfer") {
            val api = container.api()
            groups.filter { it.value.active > 0 }.keys.forEach { api.cancelRemoteGroup(it) }
            loose.filter { it.isActive }.forEach { api.cancelRemote(it.id) }
        }
    }

    fun clearFinished() {
        manager.clearFinished()
        hidden = emptySet()
        serverAction { container.api().clearFinishedRemote() }
    }

    fun retry(row: TransferRow) {
        if (row.isPhone) manager.retry(row.id) else serverAction { container.api().retryRemote(row.id) }
    }

    fun cancel(row: TransferRow) {
        when {
            row.isFolder -> confirmCancelFolder = row
            row.isPhone -> manager.cancel(row.id)
            else -> serverAction { container.api().cancelRemote(row.id) }
        }
    }

    fun resumeNow(row: TransferRow) = serverAction("Trying Google again") {
        if (row.isFolder) container.api().resumeRemoteGroup(row.id) else container.api().retryRemote(row.id)
    }

    fun dismiss(row: TransferRow) {
        if (row.isPhone) manager.dismiss(row.id) else hidden = hidden + row.key
    }

    fun open(row: TransferRow) {
        if (row.isFolder) openFolder = row.id else detailsKey = row.key
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Transfers")
                        Text(
                            headline, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                actions = {
                    // Leeches and Drive use the server's bandwidth: only when the owner allows them
                    if (features.cloud) NewTransferButton(onAddLink = onAddLink, onGoogleDrive = onGoogleDrive)
                    BulkMenu(
                        manager = manager,
                        canPause = phone.any { it.status == TransferStatus.RUNNING || it.status == TransferStatus.QUEUED },
                        canResume = phone.any { it.status == TransferStatus.PAUSED },
                        canClear = all.any { !it.state.active },
                        canCancel = all.any { it.state.active },
                        onClearFinished = ::clearFinished,
                        onCancelAll = { confirmCancelAll = true },
                    )
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; refreshTick++ },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                item(key = "chips") {
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TransferFilter.entries.forEach { f ->
                            FilterChip(
                                selected = filter == f,
                                onClick = { filter = f },
                                label = { Text("${f.label} ${counts[f] ?: 0}") },
                            )
                        }
                    }
                }
                if (features.isOwner) {
                    item(key = "workers") { WorkersCard(container, onMessage = { scope.launch { snackbar.showSnackbar(it) } }) }
                }
                serverError?.let { message ->
                    item(key = "error") {
                        Text(message, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
                if (running.isEmpty() && finished.isEmpty() && visibleArchives.isEmpty()) {
                    item(key = "empty") { EmptyState(filter, loading = server == null && serverError == null) }
                }
                items(running, key = { it.key }) { row ->
                    TransferCard(
                        row,
                        onClick = { open(row) },
                        onPause = { manager.pause(row.id) },
                        onResume = { manager.resume(row.id) },
                        onCancel = { cancel(row) },
                        onRetry = { retry(row) },
                        onResumeNow = { resumeNow(row) },
                    )
                }
                items(visibleArchives, key = { "a-" + it.id }) { task ->
                    ArchiveRow(task, onCancel = { serverAction { container.api().cancelArchiveTask(task.id) } })
                }
                if (finished.isNotEmpty()) {
                    item(key = "finished") {
                        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("FINISHED", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(onClick = ::clearFinished) { Text("Clear") }
                        }
                    }
                    items(finished, key = { it.key }) { row ->
                        SwipeAway(onDismiss = { dismiss(row) }) {
                            FinishedRow(row, onClick = { open(row) }, onRetry = { retry(row) })
                        }
                    }
                }
            }
        }
    }

    // Details of one transfer (kept by key, so it follows live updates)
    detailsKey?.let { key ->
        val row = all.firstOrNull { it.key == key }
        if (row == null) {
            // It left the list (cleared or swiped away)
            LaunchedEffect(key) { detailsKey = null }
        } else {
            val close = { detailsKey = null }
            TransferDetailsSheet(
                row,
                DetailHandlers(
                    open = { openPhoneFile(context, manager, row.id); close() },
                    showInFolder = {
                        close()
                        if (row.kind == TransferKind.DOWNLOAD) openDownloads(context) else row.destination?.let(onOpenFolder)
                    },
                    pause = { manager.pause(row.id) },
                    resume = { manager.resume(row.id) },
                    retry = { retry(row) },
                    cancel = { cancel(row); close() },
                    copyLink = { row.sourceUrl?.let(::copyLink) },
                    resumeNow = { resumeNow(row) },
                ),
                onDismiss = close,
            )
        }
    }

    if (confirmCancelAll) {
        ConfirmDialog(
            title = "Cancel all transfers?",
            message = "Every running, waiting and paused upload, download and server transfer stops. Files already finished stay where they are.",
            confirmText = "Cancel all",
            isDestructive = true,
            onDismiss = { confirmCancelAll = false },
            onConfirm = { confirmCancelAll = false; cancelAll() },
        )
    }
    confirmCancelFolder?.let { row ->
        ConfirmFolderCancel(row, onDismiss = { confirmCancelFolder = null }) {
            confirmCancelFolder = null
            serverAction("Cancelled ${row.name}") { container.api().cancelRemoteGroup(row.id) }
        }
    }
}

/** Asks before a whole folder transfer stops. */
@Composable
internal fun ConfirmFolderCancel(row: TransferRow, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val left = (row.filesTotal - row.filesDone).coerceAtLeast(0)
    ConfirmDialog(
        title = "Cancel ${row.name}?",
        message = "The ${if (left == 1) "file" else "$left files"} not copied yet won't be. Files already copied stay where they are.",
        confirmText = "Cancel folder",
        isDestructive = true,
        onDismiss = onDismiss,
        onConfirm = onConfirm,
    )
}

/** + : a link (video sites, Instagram, files…), or a Google Drive folder. */
@Composable
private fun NewTransferButton(onAddLink: () -> Unit, onGoogleDrive: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }) { Icon(Icons.Filled.Add, contentDescription = "New transfer") }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        DropdownMenuItem(text = { Text("Link, magnet or file") }, leadingIcon = { Icon(Icons.Filled.Link, null) }, onClick = { open = false; onAddLink() })
        DropdownMenuItem(text = { Text("Video download") }, leadingIcon = { Icon(Icons.Filled.Movie, null) }, onClick = { open = false; onAddLink() })
        DropdownMenuItem(text = { Text("Instagram") }, leadingIcon = { Icon(Icons.Filled.PhotoCamera, null) }, onClick = { open = false; onAddLink() })
        DropdownMenuItem(text = { Text("Google Drive") }, leadingIcon = { Icon(Icons.Filled.Cloud, null) }, onClick = { open = false; onGoogleDrive() })
    }
}

/** ⋯ : pause or resume the phone's transfers, clear finished ones, cancel everything (asks first). */
@Composable
private fun BulkMenu(
    manager: TransferManager,
    canPause: Boolean,
    canResume: Boolean,
    canClear: Boolean,
    canCancel: Boolean,
    onClearFinished: () -> Unit,
    onCancelAll: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More actions") }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        DropdownMenuItem(text = { Text("Pause all") }, enabled = canPause, leadingIcon = { Icon(Icons.Filled.Pause, null) }, onClick = { open = false; manager.pauseAll() })
        DropdownMenuItem(text = { Text("Resume all") }, enabled = canResume, leadingIcon = { Icon(Icons.Filled.PlayArrow, null) }, onClick = { open = false; manager.resumeAll() })
        DropdownMenuItem(text = { Text("Clear finished") }, enabled = canClear, leadingIcon = { Icon(Icons.Filled.DeleteSweep, null) }, onClick = { open = false; onClearFinished() })
        HorizontalDivider()
        DropdownMenuItem(
            text = { Text("Cancel all…", color = if (canCancel) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
            enabled = canCancel,
            leadingIcon = { Icon(Icons.Filled.Close, null) },
            onClick = { open = false; onCancelAll() },
        )
    }
}

/** Swipe a finished row sideways to remove it from the list. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeAway(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val state = rememberSwipeToDismissBoxState(confirmValueChange = { value ->
        if (value != SwipeToDismissBoxValue.Settled) onDismiss()
        value != SwipeToDismissBoxValue.Settled
    })
    SwipeToDismissBox(
        state = state,
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) { Text("Remove", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        },
    ) { content() }
}

/** A short, quiet line instead of a big block of help. */
@Composable
private fun EmptyState(filter: TransferFilter, loading: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Filled.SwapVert, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
        Column {
            Text(
                when {
                    loading -> "Loading…"
                    filter == TransferFilter.ALL -> "No transfers"
                    else -> "Nothing ${filter.label.lowercase()}"
                },
                style = MaterialTheme.typography.titleSmall,
            )
            if (filter == TransferFilter.ALL && !loading) {
                Text("Uploads, downloads and links you add show up here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** A downloaded file opens in the app that handles it. */
private fun openPhoneFile(context: Context, manager: TransferManager, id: String) {
    val uri = manager.store.get(id)?.localUri?.let(Uri::parse) ?: return
    val mime = context.contentResolver.getType(uri) ?: "*/*"
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { context.startActivity(Intent.createChooser(view, "Open with")) }
}

/** The phone's Downloads, where downloads are saved (Downloads/TeleStore). */
private fun openDownloads(context: Context) {
    try {
        context.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
    }
}

/** A ZIP being made or unpacked by the server. */
@Composable
private fun ArchiveRow(task: ArchiveTask, onCancel: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(task.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val detail = when (task.status) {
                        "completed" -> if (task.type == "extract") "Extracted" else "ZIP ready"
                        "failed" -> task.error ?: "Failed"
                        "cancelled" -> "Cancelled"
                        "queued" -> "${task.verb} · waiting"
                        else -> "${task.verb} · ${task.percent.toInt()}%" + (task.currentFile?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "")
                    }
                    Text(
                        detail, style = MaterialTheme.typography.bodySmall, maxLines = 2,
                        color = if (task.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (task.active) TextButton(onClick = onCancel) { Text("Cancel") }
            }
            if (task.active) {
                if (task.status == "queued") ProgressBar(Modifier.fillMaxWidth())
                else TransferBar((task.percent / 100).toFloat(), MaterialTheme.colorScheme.primary, Modifier.fillMaxWidth())
            }
        }
    }
}
