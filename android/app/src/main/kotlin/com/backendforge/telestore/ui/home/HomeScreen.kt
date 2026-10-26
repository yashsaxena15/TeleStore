package com.backendforge.telestore.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKind
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.Session

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(container: AppContainer, session: Session) {
    val vm: HomeViewModel = viewModel(key = session.token) { HomeViewModel(container) }
    val state by vm.state.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }

    BackHandler(enabled = state.path.size > 1) { vm.up() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    if (state.path.size > 1) {
                        IconButton(onClick = { vm.up() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Filled.AccountCircle, contentDescription = "Account") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text("Signed in as ${session.username}") }, onClick = {}, enabled = false)
                            DropdownMenuItem(text = { Text("Sign out") }, onClick = { menuOpen = false; vm.signOut() })
                        }
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.loading,
            onRefresh = vm::load,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            when {
                state.error != null && state.items.isEmpty() -> Message(state.error ?: "", action = "Try again", onAction = vm::load)
                !state.loading && state.items.isEmpty() -> Message("This folder is empty.")
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.items, key = { it.id }) { item ->
                        FileRow(item, onClick = { if (item.isFolder) vm.open(item) })
                    }
                }
            }
        }
    }
}

@Composable
private fun FileRow(item: FileItem, onClick: () -> Unit) {
    val (icon, tint, ground) = kindStyle(item.kind)
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(44.dp).background(ground, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint)
        }
        Column(Modifier.weight(1f)) {
            Text(item.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val details = listOfNotNull(
                if (item.isFolder) null else formatBytes(item.size).takeIf { it.isNotEmpty() },
                item.modified?.take(10),
            ).joinToString(" · ")
            if (details.isNotEmpty()) Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private data class KindStyle(val icon: ImageVector, val tint: Color, val ground: Color)

private fun kindStyle(kind: FileKind): KindStyle = when (kind) {
    FileKind.FOLDER -> KindStyle(Icons.Filled.Folder, Color(0xFFA5B4FC), Color(0x334F46E5))
    FileKind.VIDEO -> KindStyle(Icons.Filled.Movie, Color(0xFFD4D4D8), Color(0x3371717A))
    FileKind.AUDIO -> KindStyle(Icons.Filled.AudioFile, Color(0xFF4ADE80), Color(0x3322C55E))
    FileKind.PHOTO -> KindStyle(Icons.Filled.Image, Color(0xFF93C5FD), Color(0x333B82F6))
    FileKind.DOCUMENT -> KindStyle(Icons.Filled.Description, Color(0xFFFCA5A5), Color(0x33EF4444))
    FileKind.ARCHIVE -> KindStyle(Icons.Filled.Archive, Color(0xFFFCD34D), Color(0x33F59E0B))
    FileKind.OTHER -> KindStyle(Icons.Filled.InsertDriveFile, Color(0xFFD4D4D8), Color(0x3371717A))
}

@Composable
private fun Message(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) Button(onClick = onAction, modifier = Modifier.padding(top = 16.dp)) { Text(action) }
    }
}
