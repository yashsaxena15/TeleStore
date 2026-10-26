package com.backendforge.telestore.ui.drive

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.compose.SubcomposeAsyncImage
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.CloudAccount
import com.backendforge.telestore.core.DriveItem
import com.backendforge.telestore.core.DriveQuota
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.openInBrowser
import com.backendforge.telestore.ui.components.FolderPickerSheet
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Runs [block], turning failures into a message for the user. */
private suspend fun <T> attempt(onError: (String) -> Unit, block: suspend () -> T): T? = try {
    block()
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    onError((e as? ApiException)?.message?.removePrefix("TELEGRAM_NOT_VERIFIED: ") ?: "Something went wrong: ${e.message}")
    null
}

/** Connected Google Drive accounts, each with its storage, and Connect. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveAccountsScreen(container: AppContainer, onBack: () -> Unit, onOpen: (CloudAccount) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current
    var accounts by remember { mutableStateOf<List<CloudAccount>?>(null) }
    var quotas by remember { mutableStateOf<Map<String, DriveQuota>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    var disconnect by remember { mutableStateOf<CloudAccount?>(null) }

    // Coming back from Google's page in the browser: show the new account
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) reload++ }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(reload) {
        val list = attempt({ error = it }) { container.api().cloudAccounts().accounts } ?: return@LaunchedEffect
        accounts = list
        list.forEach { acc -> attempt({}) { container.api().driveQuota(acc.id) }?.let { quotas = quotas + (acc.id to it) } }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Google Drive") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } })
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(accounts.orEmpty(), key = { it.id }) { acc ->
                Surface(onClick = { onOpen(acc) }, shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Cloud, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                Text(acc.name ?: "Google Drive", style = MaterialTheme.typography.titleSmall)
                                Text(acc.email.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            TextButton(onClick = { disconnect = acc }) { Text("Disconnect") }
                        }
                        quotas[acc.id]?.let { q ->
                            LinearProgressIndicator(progress = { q.usedFraction }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
                            Text("${formatBytes(q.usage)} of ${formatBytes(q.limit)} used", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
            item {
                if (accounts == null && error == null) CircularProgressIndicator()
                if (accounts?.isEmpty() == true) Text("No Google Drive connected yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
            item {
                Button(onClick = {
                    scope.launch { attempt({ error = it }) { container.api().driveConnectUrl() }?.let { openInBrowser(context, it.url) } }
                }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Add, contentDescription = null)
                    Text("Connect Google Drive", modifier = Modifier.padding(start = 8.dp))
                }
                Text(
                    "Google's page opens in your browser. Allow access, then come back here.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
    disconnect?.let { acc ->
        AlertDialog(
            onDismissRequest = { disconnect = null },
            title = { Text("Disconnect ${acc.email ?: "this account"}?") },
            text = { Text("TeleStore stops using this Google Drive. Nothing in the Drive is deleted.") },
            confirmButton = {
                TextButton(onClick = {
                    disconnect = null
                    scope.launch { attempt({ error = it }) { container.api().disconnectCloud(acc.id) }; reload++ }
                }) { Text("Disconnect") }
            },
            dismissButton = { TextButton(onClick = { disconnect = null }) { Text("Cancel") } },
        )
    }
}

/** One Drive account: its places (My Drive, Shared with me, Starred, Trash), folders and files. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveBrowserScreen(container: AppContainer, account: CloudAccount, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var trail by remember { mutableStateOf(listOf("root" to (account.email ?: "Google Drive"))) }
    var items by remember { mutableStateOf<List<DriveItem>>(emptyList()) }
    var next by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var search by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf<DriveItem?>(null) }
    var copyTarget by remember { mutableStateOf<Pair<DriveItem, Boolean>?>(null) }
    var rename by remember { mutableStateOf<DriveItem?>(null) }
    var newFolder by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    val folderId = trail.last().first
    val api = container.api()
    fun say(text: String) { scope.launch { snackbar.showSnackbar(text) } }

    LaunchedEffect(folderId, reload, search) {
        loading = true
        val page = attempt(::say) { api.driveFiles(account.id, folderId, query = search) }
        items = page?.items.orEmpty()
        next = page?.nextPageToken
        loading = false
    }
    BackHandler(enabled = trail.size > 1) { trail = trail.dropLast(1) }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(trail.last().second, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = { if (trail.size > 1) trail = trail.dropLast(1) else onBack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = { search = if (search == null) "" else null }) { Icon(Icons.Filled.Search, contentDescription = "Search Drive") }
                    if (folderId !in setOf("root", "shared_with_me", "starred", "trash")) {
                        IconButton(onClick = { newFolder = true }) { Icon(Icons.Filled.CreateNewFolder, contentDescription = "New folder") }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            search?.let { q ->
                var text by remember { mutableStateOf(q) }
                OutlinedTextField(text, { text = it }, placeholder = { Text("Search this Drive") }, singleLine = true,
                    trailingIcon = { TextButton(onClick = { search = text }) { Text("Search") } },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
            }
            if (loading && items.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                items(items, key = { it.id }) { item ->
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            if (item.isFolder) trail = trail + (item.id to item.name) else menu = item
                        }.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                            val icon = @Composable { Icon(if (item.isFolder) Icons.Filled.Folder else Icons.Filled.InsertDriveFile, contentDescription = null, tint = MaterialTheme.colorScheme.primary) }
                            if (item.thumbnailLink != null) SubcomposeAsyncImage(model = item.thumbnailLink, contentDescription = null, contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(), loading = { icon() }, error = { icon() }) else icon()
                        }
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                            if (!item.isPlace) Text(
                                listOfNotNull(if (item.isFolder) "Folder" else formatBytes(item.size), item.modified?.take(10)).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (!item.isPlace) IconButton(onClick = { menu = item }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                    }
                }
                next?.let { token ->
                    item {
                        TextButton(onClick = {
                            scope.launch {
                                val page = attempt(::say) { api.driveFiles(account.id, folderId, pageToken = token, query = search) } ?: return@launch
                                items = items + page.items
                                next = page.nextPageToken
                            }
                        }, modifier = Modifier.fillMaxWidth()) { Text("Load more") }
                    }
                }
                if (!loading && items.isEmpty()) item { Text("Nothing here.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
            }
        }
    }

    menu?.let { item ->
        ModalBottomSheet(onDismissRequest = { menu = null }) {
            Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                Text(item.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                SheetAction("Copy to TeleStore…") { menu = null; copyTarget = item to false }
                SheetAction("Move to TeleStore… (removes it from Drive)") { menu = null; copyTarget = item to true }
                if (!item.isFolder) SheetAction("Download to phone") {
                    menu = null
                    container.transfers.downloadRemote(item.name, item.size, api.driveDownloadPath(account.id, item.id))
                    say("Downloading ${item.name}. See Transfers.")
                }
                SheetAction(if (item.starred) "Unstar in Drive" else "Star in Drive") {
                    menu = null
                    scope.launch { attempt(::say) { api.driveStar(account.id, item.id, !item.starred) }; reload++ }
                }
                SheetAction("Rename") { menu = null; rename = item }
                SheetAction("Move to Drive's trash") {
                    menu = null
                    scope.launch { attempt(::say) { api.driveDelete(account.id, item.id) }?.let { say("Moved to Drive's trash.") }; reload++ }
                }
            }
        }
    }
    copyTarget?.let { (item, cut) ->
        FolderPickerSheet(
            title = if (cut) "Move into" else "Copy into", confirmActionLabel = if (cut) "Move here" else "Copy here",
            sourceItems = emptyList(), api = api,
            onSelectFolder = { folder ->
                copyTarget = null
                scope.launch {
                    attempt(::say) { api.driveToTelestore(account.id, item.id, folder, cut) }?.let { say(it.message ?: "Started. See Transfers.") }
                    if (cut) reload++
                }
            },
            onDismiss = { copyTarget = null },
        )
    }
    rename?.let { item ->
        NameDialog("Rename", item.name, onDismiss = { rename = null }) { name ->
            rename = null
            scope.launch { attempt(::say) { api.driveRename(account.id, item.id, name) }; reload++ }
        }
    }
    if (newFolder) NameDialog("New folder", "", onDismiss = { newFolder = false }) { name ->
        newFolder = false
        scope.launch { attempt(::say) { api.driveMkdir(account.id, name, folderId) }; reload++ }
    }
}

/** Copy TeleStore files into a Google Drive folder: pick the account, then the folder. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CopyToDriveSheet(container: AppContainer, files: List<FileItem>, onDone: (String) -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var accounts by remember { mutableStateOf<List<CloudAccount>?>(null) }
    var account by remember { mutableStateOf<CloudAccount?>(null) }
    var trail by remember { mutableStateOf(listOf("root" to "My Drive")) }
    var folders by remember { mutableStateOf<List<DriveItem>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val api = container.api()
    LaunchedEffect(Unit) { accounts = attempt({ error = it }) { api.cloudAccounts().accounts }.orEmpty().also { if (it.size == 1) account = it.first() } }
    LaunchedEffect(account, trail) {
        val acc = account ?: return@LaunchedEffect
        // My Drive's own top level (the server's "root" lists the places)
        val id = if (trail.last().first == "root") "my_drive" else trail.last().first
        folders = attempt({ error = it }) { api.driveFiles(acc.id, id) }?.items.orEmpty().filter { it.isFolder && !it.isPlace }
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text("Copy ${files.size} item${if (files.size != 1) "s" else ""} to Google Drive", style = MaterialTheme.typography.titleMedium)
            val acc = account
            if (acc == null) {
                if (accounts == null) CircularProgressIndicator(Modifier.padding(16.dp))
                if (accounts?.isEmpty() == true) Text("Connect a Google Drive first (More → Google Drive).", modifier = Modifier.padding(vertical = 12.dp))
                accounts.orEmpty().forEach { a ->
                    TextButton(onClick = { account = a }, modifier = Modifier.fillMaxWidth()) { Text(a.email ?: a.name ?: "Google Drive", modifier = Modifier.fillMaxWidth()) }
                }
            } else {
                Text(trail.joinToString(" › ") { it.second }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
                LazyColumn(Modifier.fillMaxWidth().height(300.dp)) {
                    if (trail.size > 1) item { TextButton(onClick = { trail = trail.dropLast(1) }) { Text("‹ Up") } }
                    items(folders, key = { it.id }) { f ->
                        Row(Modifier.fillMaxWidth().clickable { trail = trail + (f.id to f.name) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Text(f.name, modifier = Modifier.padding(start = 12.dp))
                        }
                    }
                }
                Button(onClick = {
                    val target = trail.last().first
                    scope.launch { attempt({ error = it }) { api.telestoreToDrive(acc.id, files, target) }?.let { onDone(it.message ?: "Copying to Google Drive. See Transfers.") } }
                }, modifier = Modifier.fillMaxWidth()) { Text("Copy here") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        }
    }
}

@Composable
private fun SheetAction(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Text(label, modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun NameDialog(title: String, initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onConfirm(text) }, enabled = text.isNotBlank()) { Text("OK") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
