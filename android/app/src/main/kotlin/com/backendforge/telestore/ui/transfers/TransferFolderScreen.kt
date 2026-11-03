package com.backendforge.telestore.ui.transfers

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
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
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FolderFilter
import com.backendforge.telestore.core.RemoteTask
import com.backendforge.telestore.core.TransferRow
import com.backendforge.telestore.core.TransferRows
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.ProgressBar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * One folder transfer: every file, 50 at a time as you scroll, with search and a filter, Retry
 * or Cancel per file, Retry failed and Resume now at the top, and the folder's link.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TransferFolderScreen(
    container: AppContainer,
    groupId: String,
    initial: TransferRow?,
    onBack: () -> Unit,
    onOpenFolder: (String) -> Unit,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var folder by remember { mutableStateOf(initial) }
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(FolderFilter.ALL) }
    var files by remember { mutableStateOf<List<RemoteTask>>(emptyList()) }
    var total by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var gone by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var detailsId by remember { mutableStateOf<String?>(null) }
    var confirmCancel by remember { mutableStateOf(false) }
    val list = rememberLazyListState()

    suspend fun page(offset: Int, limit: Int = TransferRows.PAGE_SIZE) =
        container.api().remoteGroupTasks(groupId, filter.wire, query, offset, limit).also { p ->
            total = p.total
            p.summary?.let { folder = TransferRows.fromGroup(groupId, it, folder?.name, folder?.worker) }
        }

    // First page again when the search or filter changes (typing waits a moment), then every 5 s
    // the pages already loaded are refreshed, so progress stays live
    LaunchedEffect(query, filter, reload) {
        delay(if (query.isNotEmpty()) 300 else 0)
        while (true) {
            try {
                val loaded = files.size.coerceIn(TransferRows.PAGE_SIZE, 200)
                files = page(0, loaded).tasks
                error = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.status == 404) gone = true else error = e.message
            } catch (e: Exception) {
                error = "Couldn't load this folder's files."
            }
            loading = false
            delay(5_000)
        }
    }

    // The next 50 when the list nears its end
    val nearEnd by remember {
        derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 8 }
    }
    LaunchedEffect(nearEnd, files.size, total) {
        if (nearEnd && !loading && files.size < total) {
            loading = true
            try {
                val more = page(files.size).tasks
                files = (files + more).distinctBy { it.id }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = (e as? ApiException)?.message ?: "Couldn't load more files."
            }
            loading = false
        }
    }

    fun action(done: String? = null, call: suspend () -> Unit) {
        scope.launch {
            try {
                call()
                reload++
                done?.let { snackbar.showSnackbar(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                snackbar.showSnackbar((e as? ApiException)?.message ?: "That didn't work: ${e.message}")
            }
        }
    }

    fun copy(link: String) {
        clipboard.setText(AnnotatedString(link))
        scope.launch { snackbar.showSnackbar("Link copied") }
    }

    val row = folder
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                title = {
                    Column {
                        Text(row?.name ?: "Folder transfer", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        row?.let {
                            Text(TransferRows.detail(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), state = list, contentPadding = PaddingValues(bottom = 24.dp)) {
            if (gone) {
                item { Text("This folder transfer is gone (cleared or not yours).", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                return@LazyColumn
            }
            row?.let { r ->
                item(key = "summary") {
                    FolderHeader(
                        r,
                        onRetryFailed = { action("Retrying the failed files") { container.api().retryFailedRemote(groupId) } },
                        onResumeNow = { action("Trying Google again") { container.api().resumeRemoteGroup(groupId) } },
                        onCancel = { confirmCancel = true },
                        onCopyLink = { r.sourceUrl?.let(::copy) },
                        onOpenLink = { r.sourceUrl?.let { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } } },
                    )
                }
            }
            item(key = "search") {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    placeholder = { Text("Search files") },
                    leadingIcon = { Icon(Icons.Filled.Search, null) },
                    trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Clear, contentDescription = "Clear search") } },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                )
            }
            item(key = "filters") {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FolderFilter.entries.forEach { f ->
                        FilterChip(selected = filter == f, onClick = { filter = f; loading = true }, label = { Text(f.label) })
                    }
                }
            }
            item(key = "count") {
                Text(
                    when {
                        loading && files.isEmpty() -> "Loading…"
                        total == 0 -> if (query.isNotBlank()) "No files match \"$query\"" else "No files here"
                        else -> "${files.size.coerceAtMost(total)} of $total files"
                    },
                    Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            error?.let { item(key = "error") { Text(it, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) } }
            items(files, key = { it.id }) { task ->
                val file = TransferRows.fromTask(task)
                TransferCard(
                    file,
                    onClick = { detailsId = task.id },
                    onCancel = { action { container.api().cancelRemote(task.id) } },
                    onRetry = { action { container.api().retryRemote(task.id) } },
                    showFileButtons = true,
                )
            }
            if (loading && files.isNotEmpty()) {
                item(key = "more") { ProgressBar(Modifier.fillMaxWidth().padding(16.dp)) }
            }
        }
    }

    detailsId?.let { id ->
        val task = files.firstOrNull { it.id == id }
        if (task == null) {
            LaunchedEffect(id) { detailsId = null }
        } else {
            val file = TransferRows.fromTask(task)
            val close = { detailsId = null }
            TransferDetailsSheet(
                file,
                DetailHandlers(
                    showInFolder = { close(); file.destination?.let(onOpenFolder) },
                    retry = { action { container.api().retryRemote(task.id) } },
                    cancel = { close(); action { container.api().cancelRemote(task.id) } },
                    copyLink = { file.sourceUrl?.let(::copy) },
                    resumeNow = { action { container.api().retryRemote(task.id) } },
                ),
                onDismiss = close,
            )
        }
    }

    if (confirmCancel && row != null) {
        ConfirmFolderCancel(row, onDismiss = { confirmCancel = false }) {
            confirmCancel = false
            action("Cancelled ${row.name}") { container.api().cancelRemoteGroup(groupId) }
        }
    }
}

@Composable
private fun FolderHeader(
    row: TransferRow,
    onRetryFailed: () -> Unit,
    onResumeNow: () -> Unit,
    onCancel: () -> Unit,
    onCopyLink: () -> Unit,
    onOpenLink: () -> Unit,
) {
    val can = TransferRows.actions(row)
    val label = TransferRows.label(row)
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(row)
                Text(
                    listOfNotNull(TransferRows.workerLabel(row.worker), row.destination?.let { "to $it" }).joinToString(" · "),
                    Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TransferBar(row.progress, toneColor(label.tone), Modifier.weight(1f))
                Text("${(row.progress * 100).toInt()}%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            GoogleNote(row, null)
            row.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 3, overflow = TextOverflow.Ellipsis) }
            row.sourceUrl?.takeIf { it.isNotBlank() }?.let { link ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(link, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = onCopyLink) { Icon(Icons.Filled.ContentCopy, contentDescription = "Copy the folder's link") }
                    IconButton(onClick = onOpenLink) { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Open the folder's link") }
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (can.retryFailed) OutlinedButton(onClick = onRetryFailed) {
                    Icon(Icons.Filled.Refresh, null)
                    Text(" Retry ${row.filesFailed} failed")
                }
                if (can.resumeNow) OutlinedButton(onClick = onResumeNow) { Text("Resume now", color = AmberColor) }
                if (can.cancel) OutlinedButton(onClick = onCancel) { Text("Cancel folder", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}
