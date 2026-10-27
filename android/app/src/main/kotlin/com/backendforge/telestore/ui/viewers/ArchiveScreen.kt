package com.backendforge.telestore.ui.viewers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.ArchiveContents
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.FolderPickerSheet
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What's inside a ZIP, RAR, 7z or TAR (read by the server), and unpacking it into a folder. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArchiveScreen(container: AppContainer, item: FileItem?, onBack: () -> Unit) {
    if (item == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var contents by remember { mutableStateOf<ArchiveContents?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }

    LaunchedEffect(item.id) {
        try {
            contents = container.api().inspectArchive(item)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = (e as? ApiException)?.message ?: "Couldn't read this archive."
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        contents?.let {
                            Text("${it.totalFiles} items · ${formatBytes(it.totalSize)} unpacked", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
        floatingActionButton = {
            if (contents != null) {
                ExtendedFloatingActionButton(onClick = { picking = true }, icon = { Icon(Icons.Filled.Unarchive, contentDescription = null) }, text = { Text("Extract") })
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val list = contents
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                list != null -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (list.files.isEmpty()) item { Text("This archive is empty.", modifier = Modifier.padding(8.dp)) }
                    items(list.files) { entry ->
                        val depth = entry.name.trimEnd('/').count { it == '/' }
                        Row(Modifier.fillMaxWidth().padding(start = (depth * 16).coerceAtMost(96).dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                if (entry.isDir) Icons.Filled.Folder else Icons.AutoMirrored.Filled.InsertDriveFile,
                                contentDescription = null,
                                tint = if (entry.isDir) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp),
                            )
                            Text(
                                entry.name.trimEnd('/').substringAfterLast('/'),
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                            )
                            if (!entry.isDir) Text(formatBytes(entry.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                error != null -> Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.Center).padding(24.dp))
                else -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Text("Reading the archive…", modifier = Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium)
                    Text("Big archives take a while: the server reads them first.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }

    if (picking) {
        FolderPickerSheet(
            title = "Extract to",
            confirmActionLabel = "Extract here",
            sourceItems = emptyList(),
            api = container.api(),
            onSelectFolder = { folder ->
                picking = false
                scope.launch {
                    val message = try {
                        container.api().extractArchive(item, folder)
                        "Extracting into $folder. Progress is in Transfers."
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        (e as? ApiException)?.message ?: "Couldn't start extracting."
                    }
                    snackbar.showSnackbar(message)
                }
            },
            onDismiss = { picking = false },
        )
    }
}
