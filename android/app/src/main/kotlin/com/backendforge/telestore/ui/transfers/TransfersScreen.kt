package com.backendforge.telestore.ui.transfers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.GroupSummary
import com.backendforge.telestore.core.RemoteTask
import com.backendforge.telestore.core.RemoteTaskList
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.transfers.Direction
import com.backendforge.telestore.transfers.PhoneTransfer
import com.backendforge.telestore.transfers.TransferStatus
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersScreen(container: AppContainer, onAddLink: () -> Unit = {}) {
    val manager = container.transfers
    val phone by manager.store.items.collectAsStateWithLifecycle()
    var server by remember { mutableStateOf<RemoteTaskList?>(null) }
    var serverError by remember { mutableStateOf<String?>(null) }
    var archives by remember { mutableStateOf<List<com.backendforge.telestore.core.ArchiveTask>>(emptyList()) }
    var refreshTick by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

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
            delay(3_000)
        }
    }

    fun serverAction(call: suspend () -> Unit) {
        scope.launch {
            try {
                call()
                refreshTick++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                serverError = (e as? ApiException)?.message ?: "That didn't work: ${e.message}"
            }
        }
    }

    val running = phone.count { !it.status.finished && it.status != TransferStatus.PAUSED }
    Scaffold(
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = onAddLink, icon = { Icon(Icons.Filled.Link, contentDescription = null) }, text = { Text("Add from link") })
        },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Transfers")
                        val activeServer = server?.let { s -> s.tasks.count { it.isActive } + s.groups.values.sumOf { it.active } } ?: 0
                        Text(
                            "${running + activeServer} running · they keep going with the app closed",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
            item {
                SectionHeader("On this phone", action = if (phone.any { it.status.finished }) "Clear finished" else null, onAction = manager::clearFinished)
            }
            if (phone.isEmpty()) {
                item { Hint("Uploads and downloads you start on this phone appear here. Use Upload in a folder, Download in a file's menu, or share files into TeleStore.") }
            }
            items(phone.sortedByDescending { it.createdAt }, key = { it.id }) { t ->
                PhoneRow(
                    t,
                    onPause = { manager.pause(t.id) },
                    onResume = { manager.resume(t.id) },
                    onCancel = { manager.cancel(t.id) },
                )
            }

            val list = server
            val groups = list?.groups.orEmpty()
            val loose = list?.tasks.orEmpty().filter { it.groupId == null || it.groupId !in groups }
            val grouped = list?.tasks.orEmpty().filter { it.groupId != null && it.groupId in groups }.groupBy { it.groupId!! }
            item {
                SectionHeader(
                    "On the server",
                    action = if (loose.any { !it.isActive }) "Clear finished" else null,
                    onAction = { serverAction { container.api().clearFinishedRemote() } },
                )
            }
            serverError?.let { item { Hint(it, error = true) } }
            if (list != null && list.tasks.isEmpty() && groups.isEmpty()) {
                item { Hint("Cloud leeches, Google Drive and video downloads that the server runs appear here.") }
            }
            items(groups.entries.toList(), key = { "g-" + it.key }) { (groupId, summary) ->
                val members = grouped[groupId].orEmpty()
                GroupRow(
                    name = members.firstOrNull()?.groupName ?: "Folder transfer",
                    summary = summary,
                    running = members.filter { it.status == "downloading" || it.status == "uploading_tg" },
                    onCancel = { serverAction { container.api().cancelRemoteGroup(groupId) } },
                    onResume = { serverAction { container.api().resumeRemoteGroup(groupId) } },
                )
            }
            items(archives, key = { "a-" + it.id }) { task ->
                ArchiveRow(task, onCancel = { serverAction { container.api().cancelArchiveTask(task.id) } })
            }
            items(loose, key = { "t-" + it.id }) { task ->
                ServerRow(
                    task,
                    onCancel = { serverAction { container.api().cancelRemote(task.id) } },
                    onRetry = { serverAction { container.api().retryRemote(task.id) } },
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String, action: String?, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 16.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title.uppercase(), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
private fun Hint(text: String, error: Boolean = false) {
    Text(
        text, style = MaterialTheme.typography.bodyMedium,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    ) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() } }
}

@Composable
private fun KindIcon(icon: ImageVector, tint: Color, ground: Color) {
    Box(Modifier.size(36.dp).background(ground, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun PhoneRow(t: PhoneTransfer, onPause: () -> Unit, onResume: () -> Unit, onCancel: () -> Unit) {
    val upload = t.direction == Direction.UPLOAD
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (upload) KindIcon(Icons.Filled.ArrowUpward, Color(0xFFA5B4FC), Color(0x334F46E5))
            else KindIcon(Icons.Filled.ArrowDownward, Color(0xFF4ADE80), Color(0x3322C55E))
            Column(Modifier.weight(1f)) {
                Text(t.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                val bytes = if (t.size > 0) "${formatBytes(t.done)} of ${formatBytes(t.size)}" else formatBytes(t.done)
                val line = when (t.status) {
                    TransferStatus.QUEUED -> t.error ?: "Waiting · $bytes"
                    TransferStatus.RUNNING -> "${if (upload) "Uploading" else "Downloading"} · $bytes${if (t.speedBps > 0) " · ${formatBytes(t.speedBps)}/s" else ""}"
                    TransferStatus.SAVING -> "Saving to Telegram…"
                    TransferStatus.PAUSED -> "Paused · $bytes"
                    TransferStatus.DONE -> if (upload) "Uploaded to ${t.folder ?: "Home"}" else "Saved in Downloads/TeleStore"
                    TransferStatus.FAILED -> "Failed: ${t.error ?: "unknown error"}"
                    TransferStatus.CANCELLED -> "Cancelled"
                }
                Text(
                    line, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = if (t.status == TransferStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            when (t.status) {
                TransferStatus.QUEUED, TransferStatus.RUNNING ->
                    IconButton(onClick = onPause) { Icon(Icons.Filled.Pause, contentDescription = "Pause") }
                TransferStatus.PAUSED, TransferStatus.FAILED ->
                    IconButton(onClick = onResume) {
                        Icon(if (t.status == TransferStatus.FAILED) Icons.Filled.Refresh else Icons.Filled.PlayArrow, contentDescription = if (t.status == TransferStatus.FAILED) "Retry" else "Resume")
                    }
                else -> {}
            }
            if (!t.status.finished) IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, contentDescription = "Cancel") }
        }
        if (!t.status.finished) {
            if (t.status == TransferStatus.SAVING || (t.status == TransferStatus.RUNNING && t.size <= 0)) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            } else {
                LinearProgressIndicator(progress = { t.progress }, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun GroupRow(name: String, summary: GroupSummary, running: List<RemoteTask>, onCancel: () -> Unit, onResume: () -> Unit) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KindIcon(Icons.Filled.Folder, Color(0xFF93C5FD), Color(0x333B82F6))
            Column(Modifier.weight(1f)) {
                Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                val failed = if (summary.failed > 0) " · ${summary.failed} failed" else ""
                Text("${summary.done} of ${summary.total} files$failed", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        LinearProgressIndicator(progress = { if (summary.total > 0) summary.done.toFloat() / summary.total else 0f }, modifier = Modifier.fillMaxWidth())
        running.take(2).forEach {
            Text("↳ ${it.filename ?: "file"} · ${(it.progress ?: 0.0).toInt()}%", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (summary.active == 0 && summary.done < summary.total) OutlinedButton(onClick = onResume) { Text("Resume") }
            if (summary.active > 0) OutlinedButton(onClick = onCancel) { Text("Cancel all", color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun ServerRow(task: RemoteTask, onCancel: () -> Unit, onRetry: () -> Unit) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KindIcon(Icons.Filled.Cloud, Color(0xFF93C5FD), Color(0x333B82F6))
            Column(Modifier.weight(1f)) {
                Text(task.filename ?: "Transfer", maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                val line = when {
                    task.isFailed -> "Failed: ${task.error ?: "unknown error"}"
                    task.status == "completed" -> "Done${task.filesize?.let { " · ${formatBytes(it)}" } ?: ""}"
                    task.status == "cancelled" -> "Cancelled"
                    task.status == "queued" -> "Waiting"
                    task.status == "discovering" -> "Looking through the folder…"
                    task.status == "uploading_tg" -> "Saving to Telegram · ${(task.progress ?: 0.0).toInt()}%"
                    else -> "${(task.progress ?: 0.0).toInt()}%${task.speed?.takeIf { it > 0 }?.let { " · ${formatBytes(it.toLong())}/s" } ?: ""}"
                }
                Text(line, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = if (task.isFailed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (task.isFailed) IconButton(onClick = onRetry) { Icon(Icons.Filled.Refresh, contentDescription = "Retry") }
            if (task.isActive) IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, contentDescription = "Cancel") }
        }
        if (task.isActive) LinearProgressIndicator(progress = { ((task.progress ?: 0.0) / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
    }
}

/** A ZIP being made or unpacked by the server. */
@Composable
private fun ArchiveRow(task: com.backendforge.telestore.core.ArchiveTask, onCancel: () -> Unit) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(task.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
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
            androidx.compose.material3.LinearProgressIndicator(progress = { (task.percent / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        }
    }
}
