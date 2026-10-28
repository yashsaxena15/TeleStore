package com.backendforge.telestore.ui.photos

import android.app.Activity
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.backup.BackupWorker
import com.backendforge.telestore.backup.PhoneAlbum
import com.backendforge.telestore.backup.PhoneItem
import com.backendforge.telestore.backup.PhoneMedia
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupScreen(container: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val store = container.backup
    val settings by store.settings.collectAsStateWithLifecycle()
    val status by store.status.collectAsStateWithLifecycle()
    var canRead by remember { mutableStateOf(PhoneMedia.canRead(context)) }
    var partial by remember { mutableStateOf(PhoneMedia.partialAccess(context)) }
    var keepsLocation by remember { mutableStateOf(PhoneMedia.canReadLocation(context)) }
    var albums by remember { mutableStateOf<List<PhoneAlbum>>(emptyList()) }
    var freeable by remember { mutableStateOf<List<PhoneItem>>(emptyList()) }
    var refresh by remember { mutableIntStateOf(0) }

    fun apply(change: (com.backendforge.telestore.backup.BackupSettings) -> com.backendforge.telestore.backup.BackupSettings) {
        store.update(change)
        BackupWorker.schedule(context, store.settings.value)
    }

    val askAccess = rememberPhotoAccessRequest { granted ->
        canRead = granted
        partial = PhoneMedia.partialAccess(context)
        keepsLocation = PhoneMedia.canReadLocation(context)
        refresh++
        if (granted) apply { it.copy(enabled = true) }
    }
    val deleteRequest = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) refresh++
    }

    // The phone's albums, and what's backed up but still taking space on the phone
    LaunchedEffect(canRead, refresh, status.done) {
        if (!canRead) return@LaunchedEffect
        val (found, local) = withContext(Dispatchers.IO) {
            val all = PhoneMedia.scan(context)
            val done = store.backedUpKeys()
            PhoneMedia.albums(context) to all.filter { it.key in done }
        }
        albums = found
        freeable = local
        if (store.settings.value.albums.isEmpty()) PhoneMedia.cameraAlbum(found)?.let { cam -> store.update { it.copy(albums = setOf(cam)) } }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Backup") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Back up photos and videos", style = MaterialTheme.typography.titleMedium)
                            Text(
                                "New photos go to TeleStore by themselves, in original quality.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(checked = settings.enabled, onCheckedChange = { on ->
                            if (on && !canRead) askAccess() else apply { it.copy(enabled = on) }
                        })
                    }
                }
            }

            if (settings.enabled) item {
                Card {
                    val total = status.done + status.pending
                    when {
                        status.running -> {
                            Text("Backing up · ${status.pending} left", style = MaterialTheme.typography.titleSmall)
                            LinearProgressIndicator(progress = { if (total > 0) status.done.toFloat() / total else 0f }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
                            status.current?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        status.message != null -> Text(status.message ?: "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                        status.lastRun > 0 -> Text(
                            "Backed up · last checked ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(status.lastRun))}",
                            style = MaterialTheme.typography.titleSmall,
                        )
                        else -> Text("Waiting to start${if (settings.wifiOnly) " (needs Wi-Fi)" else ""}${if (settings.chargingOnly) " and charging" else ""}…", style = MaterialTheme.typography.titleSmall)
                    }
                    OutlinedButton(onClick = { BackupWorker.runNow(context, settings) }, enabled = !status.running, modifier = Modifier.padding(top = 8.dp)) { Text("Back up now") }
                }
            }

            if (partial) item {
                Card {
                    Text("TeleStore can see only the photos you picked.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = { askAccess() }, modifier = Modifier.padding(top = 8.dp)) { Text("Allow all photos") }
                }
            }

            if (settings.enabled && canRead && !keepsLocation) item {
                Card {
                    Text("Allow photo locations so backups keep where they were taken.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = { askAccess() }, modifier = Modifier.padding(top = 8.dp)) { Text("Allow photo locations") }
                }
            }

            item { Label("Options") }
            item {
                Card {
                    SwitchLine("Include videos", settings.includeVideos) { on -> apply { it.copy(includeVideos = on) } }
                    SwitchLine("Only on Wi-Fi", settings.wifiOnly) { on -> apply { it.copy(wifiOnly = on) } }
                    SwitchLine("Only while charging", settings.chargingOnly) { on -> apply { it.copy(chargingOnly = on) } }
                    Text(
                        "Saved in ${settings.destination}/<album name>",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            if (canRead) {
                item { Label("Albums to back up") }
                items(albums, key = { it.id }) { album ->
                    val checked = album.id in settings.albums
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            apply { s -> s.copy(albums = if (checked) s.albums - album.id else s.albums + album.id) }
                        }.padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = checked, onCheckedChange = null)
                        Text(album.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).padding(start = 8.dp))
                        Text("${album.count}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                item {
                    Card {
                        Text("TeleStore needs to see your photos and videos to back them up.", style = MaterialTheme.typography.bodyMedium)
                        Button(onClick = { askAccess() }, modifier = Modifier.padding(top = 8.dp)) { Text("Allow access") }
                    }
                }
            }

            if (freeable.isNotEmpty()) {
                item { Label("Free up space") }
                item {
                    Card {
                        Text("Free up ${formatBytes(freeable.sumOf { it.size })}", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "${freeable.size} photos and videos on this phone are safely in TeleStore. Removing them here keeps them in TeleStore.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            OutlinedButton(
                                onClick = {
                                    // Android shows its own "delete these?" confirmation
                                    val request = MediaStore.createDeleteRequest(context.contentResolver, freeable.map { it.uri })
                                    deleteRequest.launch(IntentSenderRequest.Builder(request.intentSender).build())
                                },
                                modifier = Modifier.padding(top = 8.dp),
                            ) { Text("Remove from this phone") }
                        } else {
                            Text("Needs Android 11 or newer.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) { content() }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun SwitchLine(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
