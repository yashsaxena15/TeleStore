package com.backendforge.telestore.ui.photos

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.PhotoAlbum
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.backendforge.telestore.backup.PhoneItem
import com.backendforge.telestore.backup.PhoneMedia
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FolderPaths
import com.backendforge.telestore.core.SortBy
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.PhotoSource
import com.backendforge.telestore.ui.components.FileThumbnail
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** An album with its newest photo. */
private data class AlbumCover(val folder: FileItem, val cover: FileItem?)

/** A folder on this phone (Camera, WhatsApp Images, Screenshots…) with its photos, newest first. */
private data class PhoneFolder(val id: String, val name: String, val items: List<PhoneItem>)

/**
 * Collections, as in Google Photos: Favourites, Archive and Trash; then the albums (folders in the
 * backup folder) with their newest photo; then the folders on this phone.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionsScreen(
    container: AppContainer,
    onBack: () -> Unit,
    /** Opens a TeleStore folder ("starred", "archive", "trash", or an album's path). */
    onOpenFolder: (String) -> Unit,
    /** Opens photos in the viewer (a phone folder's). */
    onOpenPhotos: (List<PhotoSource>, Int) -> Unit,
) {
    val settings by container.backup.settings.collectAsStateWithLifecycle()
    var albums by remember { mutableStateOf<List<AlbumCover>>(emptyList()) }
    var phone by remember { mutableStateOf<List<PhoneFolder>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    val api = container.api()

    LaunchedEffect(settings.destination) {
        try {
            val folders = api.listFiles(path = settings.destination, pageSize = 200).files.filter { it.isFolder }
            albums = folders.map { AlbumCover(it, null) }
            loaded = true
            // Covers fill in one by one
            folders.forEach { folder ->
                val cover = runCatching {
                    api.listFiles(path = "all", pageSize = 1, sortBy = SortBy.TAKEN, ascending = false, mediaOnly = true, under = FolderPaths.childPath(folder)).files.firstOrNull()
                }.getOrNull()
                if (cover != null) albums = albums.map { if (it.folder.id == folder.id) it.copy(cover = cover) else it }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            loaded = true
        }
    }
    LaunchedEffect(Unit) {
        phone = withContext(Dispatchers.IO) {
            if (!PhoneMedia.canRead(container.context)) emptyList()
            else PhoneMedia.scan(container.context).groupBy { it.bucketId }
                .map { (id, items) -> PhoneFolder(id, items.first().bucket, items.sortedByDescending { it.takenAt }) }
                .sortedWith(compareByDescending<PhoneFolder> { it.name.equals("Camera", true) }.thenByDescending { it.items.size })
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Collections") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Fixed(6),
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Three big buttons, two columns each
            item(span = { GridItemSpan(2) }) { Shortcut(Icons.Outlined.StarOutline, "Favourites") { onOpenFolder("starred") } }
            item(span = { GridItemSpan(2) }) { Shortcut(Icons.Outlined.Archive, "Archive") { onOpenFolder("archive") } }
            item(span = { GridItemSpan(2) }) { Shortcut(Icons.Outlined.Delete, "Trash") { onOpenFolder("trash") } }

            heading("Albums")
            if (albums.isEmpty() && loaded) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        "Each phone album you back up gets its own album here. Make your own with + on Photos.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(albums, key = { it.folder.id }, span = { GridItemSpan(3) }) { album ->
                Tile(album.folder.name, null, onClick = { onOpenFolder(FolderPaths.childPath(album.folder)) }) {
                    if (album.cover != null) FileThumbnail(item = album.cover, api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 16.dp, iconSize = 30.dp)
                    else Icon(Icons.Outlined.PhotoAlbum, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp))
                }
            }

            if (phone.isNotEmpty()) {
                heading("On this device")
                items(phone, key = { "phone-${it.id}" }, span = { GridItemSpan(2) }) { folder ->
                    Tile(folder.name, "${folder.items.size}", onClick = {
                        onOpenPhotos(
                            folder.items.map { p -> PhotoSource(item = null, localUri = p.uri, name = p.name, takenAtMillis = p.takenAt, video = p.video, backedUp = false) },
                            0,
                        )
                    }) {
                        AsyncImage(model = folder.items.first().uri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    }
                }
            }
        }
    }
}

private fun LazyGridScope.heading(title: String) {
    item(span = { GridItemSpan(maxLineSpan) }) {
        Text(title, style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp), modifier = Modifier.padding(top = 16.dp))
    }
}

/** Favourites, Archive or Trash: an icon and its name on a grey rounded button. */
@Composable
private fun Shortcut(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainer).clickable(onClick = onClick)
            .padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(26.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
}

/** A square cover with the name (and count) under it. */
@Composable
private fun Tile(name: String, count: String?, onClick: () -> Unit, cover: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick)) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) { cover() }
        Text(name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp, start = 2.dp))
        count?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 2.dp)) }
    }
}
