package com.backendforge.telestore.ui.photos

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.GridOn
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.SpaceDashboard
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.backup.PhoneAlbum
import com.backendforge.telestore.backup.PhoneMedia
import com.backendforge.telestore.core.PhotosLayout
import com.backendforge.telestore.core.PhotosView
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** "Photos view": the timeline's layout, stacks, and which other apps' photos show (as in Google Photos). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotosViewScreen(container: AppContainer, onBack: () -> Unit, onCustomizeApps: () -> Unit) {
    val view by container.settings.photosView.collectAsStateWithLifecycle()
    fun set(change: (PhotosView) -> PhotosView) = container.settings.setPhotosView(change(container.settings.photosView.value))
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Photos view") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Text("Layout", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 20.dp))
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    LayoutChoice(Icons.Outlined.SpaceDashboard, PhotosLayout.COMFORTABLE, view.layout) { set { v -> v.copy(layout = it) } }
                    LayoutChoice(Icons.Outlined.GridView, PhotosLayout.DAY, view.layout) { set { v -> v.copy(layout = it) } }
                    LayoutChoice(Icons.Outlined.GridOn, PhotosLayout.MONTH, view.layout) { set { v -> v.copy(layout = it) } }
                }
            }
            item {
                SwitchRow(
                    "Stack similar photos", "Automatically group similar photos that were taken together.",
                    checked = view.stackSimilar, modifier = Modifier.padding(top = 24.dp),
                ) { on -> set { it.copy(stackSimilar = on) } }
                HorizontalDivider(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
            }
            item { SwitchRow("Show content from other apps", null, checked = view.otherApps) { on -> set { it.copy(otherApps = on) } } }
            if (view.otherApps) {
                item {
                    Text(
                        "Content from other apps", style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 4.dp),
                    )
                }
                item {
                    SwitchRow(
                        "Only show backed-up content", "See photos from other apps that are backed up or are waiting to be backed up.",
                        checked = view.onlyBackedUp,
                    ) { on -> set { it.copy(onlyBackedUp = on) } }
                }
                item {
                    SwitchRow(
                        "Hide clutter from other apps", "Photos like screenshots, GIFs, and memes are hidden after they are backed up.",
                        checked = view.hideClutter,
                    ) { on -> set { it.copy(hideClutter = on) } }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().clickable(onClick = onCustomizeApps).padding(horizontal = 20.dp, vertical = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Customize by app", style = MaterialTheme.typography.titleLarge.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize * 1.15f), modifier = Modifier.weight(1f))
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
                    }
                }
            }
        }
    }
}

/** One layout: its icon, and its name in a filled pill when it's the one in use. */
@Composable
private fun LayoutChoice(icon: ImageVector, layout: PhotosLayout, current: PhotosLayout, onPick: (PhotosLayout) -> Unit) {
    val on = layout == current
    Column(
        Modifier.clickable { onPick(layout) }.semantics { role = Role.RadioButton; selected = on }.padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(36.dp))
        Surface(
            shape = CircleShape,
            color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.background,
            modifier = Modifier.padding(top = 14.dp),
        ) {
            Text(
                layout.label, style = MaterialTheme.typography.labelLarge,
                color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun SwitchRow(title: String, text: String?, checked: Boolean, modifier: Modifier = Modifier, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(
        modifier.fillMaxWidth().clickable(enabled = enabled) { onChange(!checked) }.padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize * 1.15f))
            if (text != null) Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

/** "Customize by app": each phone album besides the backed-up ones, with its own switch. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomizeAppsScreen(container: AppContainer, onBack: () -> Unit) {
    val view by container.settings.photosView.collectAsStateWithLifecycle()
    val backup by container.backup.settings.collectAsStateWithLifecycle()
    var albums by remember { mutableStateOf<List<PhoneAlbum>?>(null) }
    LaunchedEffect(Unit) {
        albums = withContext(Dispatchers.IO) { if (PhoneMedia.canRead(container.context)) PhoneMedia.albums(container.context) else emptyList() }
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Customize by app") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        val list = albums
        if (list == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        // The backup albums always show (the camera when none is chosen)
        val chosen = backup.albums.ifEmpty { setOfNotNull(PhoneMedia.cameraAlbum(list)) }
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Text(
                    if (view.otherApps) "Choose which apps' photos show in Photos." else "Turn on \"Show content from other apps\" to choose apps here.",
                    style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
            items(list, key = { it.id }) { album ->
                val backedUp = album.id in chosen
                SwitchRow(
                    album.name, if (backedUp) "Backed up · always shown" else "${album.count} item${if (album.count != 1) "s" else ""}",
                    checked = backedUp || album.id !in view.hiddenApps,
                    enabled = view.otherApps && !backedUp,
                ) { on ->
                    val v = container.settings.photosView.value
                    container.settings.setPhotosView(v.copy(hiddenApps = if (on) v.hiddenApps - album.id else v.hiddenApps + album.id))
                }
            }
        }
    }
}
