package com.backendforge.telestore.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.AppRelease
import com.backendforge.telestore.core.StorageStats
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.AppVersion
import com.backendforge.telestore.data.ThemeMode
import com.backendforge.telestore.data.openInBrowser
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun SectionLabel(text: String) {
    Text(
        text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 20.dp, bottom = 4.dp),
    )
}

@Composable
private fun SectionCard(content: @Composable () -> Unit) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.fillMaxWidth(),
    ) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() } }
}

/** Space used out of the account's quota, by kind of file. */
@Composable
fun StorageSection(container: AppContainer) {
    var stats by remember { mutableStateOf<StorageStats?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        try {
            stats = container.api().storage()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = (e as? ApiException)?.message ?: "Couldn't load your storage."
        }
    }
    SectionLabel("Storage")
    SectionCard {
        val s = stats
        when {
            s != null -> {
                Text(
                    "${formatBytes(s.usedBytes)} used" + if (s.quotaBytes > 0) " of ${formatBytes(s.quotaBytes)}" else "",
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                )
                if (s.quotaBytes > 0) {
                    LinearProgressIndicator(progress = { s.usedFraction.coerceAtLeast(0.005f) }, modifier = Modifier.fillMaxWidth())
                    Text("${formatBytes(s.freeBytes)} free", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    "${s.files} files in ${s.folders} folders" + if (s.trashCount > 0) " · Trash: ${s.trashCount} (${formatBytes(s.trashBytes)})" else "",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                s.categories.entries.filter { it.value.count > 0 }.sortedByDescending { it.value.bytes }.forEach { (kind, stat) ->
                    Row {
                        Text(kind.replaceFirstChar { it.titlecase(Locale.ROOT) }, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Text("${stat.count} · ${formatBytes(stat.bytes)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            error != null -> Text(error ?: "", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            else -> Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
fun AppearanceSection(container: AppContainer) {
    val theme by container.settings.theme.collectAsStateWithLifecycle()
    SectionLabel("Appearance")
    SectionCard {
        Text("Theme", style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ThemeMode.entries.forEach { mode ->
                FilterChip(selected = theme == mode, onClick = { container.settings.setTheme(mode) }, label = { Text(mode.label) })
            }
        }
        var haptics by remember { mutableStateOf(container.settings.haptics) }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Vibration feedback", style = MaterialTheme.typography.bodyLarge)
                Text("On long-press, swipes and PIN keys", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            androidx.compose.material3.Switch(checked = haptics, onCheckedChange = { haptics = it; container.settings.haptics = it })
        }
    }
}

/** The installed version, and a button to look for a newer APK on GitHub. */
@Composable
fun AboutSection(container: AppContainer) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val version = remember { AppVersion.of(context) }
    var checking by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var available by remember { mutableStateOf<AppRelease?>(null) }

    SectionLabel("About")
    SectionCard {
        Text("TeleStore ${version.name}", style = MaterialTheme.typography.bodyLarge)
        Text("Build ${version.build}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        status?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        val update = available
        if (update != null) {
            OutlinedButton(onClick = { openInBrowser(context, update.apkUrl) }) { Text("Download TeleStore ${update.version}") }
        } else {
            OutlinedButton(
                enabled = !checking,
                onClick = {
                    checking = true
                    scope.launch {
                        status = try {
                            val newer = container.updates.newerThan(version.build)
                            container.settings.lastUpdateCheck = System.currentTimeMillis()
                            available = newer
                            if (newer != null) "TeleStore ${newer.version} is available." else "You have the newest version."
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            (e as? ApiException)?.message ?: "Couldn't look for updates."
                        }
                        checking = false
                    }
                },
            ) { Text(if (checking) "Checking…" else "Check for updates") }
        }
    }
}
