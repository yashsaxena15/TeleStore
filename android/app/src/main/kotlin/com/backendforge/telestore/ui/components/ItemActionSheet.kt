package com.backendforge.telestore.ui.components

import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import com.backendforge.telestore.ui.playlists.PlaylistStore
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.DriveFileMove
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.RemoveModerator
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarOutline
import androidx.compose.material3.DividerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.TeleStoreApi

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemActionSheet(
    item: FileItem,
    api: TeleStoreApi,
    isTrash: Boolean,
    isInbox: Boolean,
    onOpenFolder: ((FileItem) -> Unit)? = null,
    onInfo: (FileItem) -> Unit,
    onRename: ((FileItem) -> Unit)? = null,
    onMove: ((FileItem) -> Unit)? = null,
    onCopy: ((FileItem) -> Unit)? = null,
    onToggleStar: ((FileItem) -> Unit)? = null,
    onTrash: ((FileItem) -> Unit)? = null,
    onRestore: ((FileItem) -> Unit)? = null,
    onDeleteForever: ((FileItem) -> Unit)? = null,
    /** Saves the file (or the folder as ZIP) to Downloads/TeleStore on the phone. */
    onDownload: ((FileItem) -> Unit)? = null,
    onMoveToVault: ((FileItem) -> Unit)? = null,
    onCopyToDrive: ((FileItem) -> Unit)? = null,
    onShare: ((FileItem) -> Unit)? = null,
    onOpenWith: ((FileItem) -> Unit)? = null,
    onCompress: ((FileItem) -> Unit)? = null,
    /** Music and videos: opens "Add to playlist". */
    onAddToPlaylist: ((FileItem) -> Unit)? = null,
    /** Kept on this phone already (file or folder): the row then removes the copy. */
    isOffline: Boolean = false,
    onToggleOffline: ((FileItem) -> Unit)? = null,
    /** "Protect from deletion" / "Remove protection"; null hides it. */
    onToggleProtected: ((FileItem) -> Unit)? = null,
    /** Folders: opens "Folder colour"; null hides it. */
    onFolderColor: ((FileItem) -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                // Many actions: scrolls on small phones
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            // Header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
            ) {
                FileThumbnail(
                    item = item,
                    api = api,
                    modifier = Modifier.size(40.dp),
                    shapeRadius = 10.dp,
                    iconSize = 22.dp,
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.name,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = if (item.isFolder) "Folder" else "${item.kind.name.lowercase().replaceFirstChar { it.uppercase() }} • ${formatBytes(item.size)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 8.dp),
                color = DividerDefaults.color.copy(alpha = 0.5f),
            )

            // Actions
            when {
                isTrash -> {
                    ActionRow(
                        icon = Icons.Default.Restore,
                        label = "Restore",
                        onClick = { onDismiss(); onRestore?.invoke(item) },
                    )
                    // Protected items can't be deleted (restore, then remove protection)
                    if (item.isProtected) {
                        ProtectedInfoRow(item)
                    } else {
                        ActionRow(
                            icon = Icons.Default.DeleteForever,
                            label = "Delete forever",
                            color = MaterialTheme.colorScheme.error,
                            onClick = { onDismiss(); onDeleteForever?.invoke(item) },
                        )
                    }
                    ActionRow(
                        icon = Icons.Default.Info,
                        label = "Info",
                        onClick = { onDismiss(); onInfo(item) },
                    )
                }

                isInbox -> {
                    ActionRow(
                        icon = Icons.Default.Info,
                        label = "Info",
                        onClick = { onDismiss(); onInfo(item) },
                    )
                    if (onDownload != null) {
                        ActionRow(
                            icon = Icons.Default.Download,
                            label = "Download to phone",
                            onClick = { onDismiss(); onDownload(item) },
                        )
                    }
                    ActionRow(
                        icon = Icons.Default.DriveFileMove,
                        label = "Move...",
                        onClick = { onDismiss(); onMove?.invoke(item) },
                    )
                    ActionRow(
                        icon = if (item.starred) Icons.Default.StarOutline else Icons.Default.Star,
                        label = if (item.starred) "Unstar" else "Star",
                        onClick = { onDismiss(); onToggleStar?.invoke(item) },
                    )
                    if (!item.isProtected) {
                        ActionRow(
                            icon = Icons.Default.Delete,
                            label = "Move to Trash",
                            color = MaterialTheme.colorScheme.error,
                            onClick = { onDismiss(); onTrash?.invoke(item) },
                        )
                    }
                }

                else -> {
                    if (item.isFolder && onOpenFolder != null) {
                        ActionRow(
                            icon = Icons.Default.FolderOpen,
                            label = "Open folder",
                            onClick = { onDismiss(); onOpenFolder(item) },
                        )
                    }
                    ActionRow(
                        icon = Icons.Default.Info,
                        label = "Info",
                        onClick = { onDismiss(); onInfo(item) },
                    )
                    if (onToggleOffline != null && !item.isVault) {
                        ActionRow(
                            icon = if (isOffline) Icons.Default.CloudOff else Icons.Default.CloudDownload,
                            label = if (isOffline) "Remove offline copy" else "Make available offline",
                            onClick = { onDismiss(); onToggleOffline(item) },
                        )
                    }
                    if (onAddToPlaylist != null && PlaylistStore.canAdd(item)) {
                        ActionRow(
                            icon = Icons.AutoMirrored.Filled.PlaylistAdd,
                            label = "Add to playlist",
                            onClick = { onDismiss(); onAddToPlaylist(item) },
                        )
                    }
                    if (!item.isFolder && onShare != null) {
                        ActionRow(
                            icon = Icons.Default.Share,
                            label = "Share to an app",
                            onClick = { onDismiss(); onShare(item) },
                        )
                    }
                    if (!item.isFolder && onOpenWith != null) {
                        ActionRow(
                            icon = Icons.AutoMirrored.Filled.OpenInNew,
                            label = "Open with another app",
                            onClick = { onDismiss(); onOpenWith(item) },
                        )
                    }
                    if (onDownload != null) {
                        ActionRow(
                            icon = Icons.Default.Download,
                            label = if (item.isFolder) "Download as ZIP" else "Download to phone",
                            onClick = { onDismiss(); onDownload(item) },
                        )
                    }
                    if (onCompress != null) {
                        ActionRow(
                            icon = Icons.Default.FolderZip,
                            label = "Compress to ZIP",
                            onClick = { onDismiss(); onCompress(item) },
                        )
                    }
                    ActionRow(
                        icon = Icons.Default.Edit,
                        label = "Rename",
                        onClick = { onDismiss(); onRename?.invoke(item) },
                    )
                    ActionRow(
                        icon = Icons.Default.DriveFileMove,
                        label = "Move...",
                        onClick = { onDismiss(); onMove?.invoke(item) },
                    )
                    ActionRow(
                        icon = Icons.Default.ContentCopy,
                        label = "Copy...",
                        onClick = { onDismiss(); onCopy?.invoke(item) },
                    )
                    ActionRow(
                        icon = if (item.starred) Icons.Default.StarOutline else Icons.Default.Star,
                        label = if (item.starred) "Unstar" else "Star",
                        onClick = { onDismiss(); onToggleStar?.invoke(item) },
                    )
                    if (onCopyToDrive != null) {
                        ActionRow(
                            icon = Icons.Default.Cloud,
                            label = "Copy to Google Drive",
                            onClick = { onDismiss(); onCopyToDrive(item) },
                        )
                    }
                    if (item.isFolder && onFolderColor != null && !item.isVault) {
                        ActionRow(
                            icon = Icons.Default.Palette,
                            label = "Folder colour",
                            onClick = { onDismiss(); onFolderColor(item) },
                        )
                    }
                    when {
                        // Inside a protected folder: only that folder's protection can be removed
                        !item.protected && item.protectedBy != null -> ProtectedInfoRow(item)
                        onToggleProtected != null && !item.isVault -> ActionRow(
                            icon = if (item.protected) Icons.Default.RemoveModerator else Icons.Default.Shield,
                            label = if (item.protected) "Remove protection" else "Protect from deletion",
                            onClick = { onDismiss(); onToggleProtected(item) },
                        )
                    }
                    if (onMoveToVault != null) {
                        ActionRow(
                            icon = Icons.Default.Lock,
                            label = "Move to Private Vault",
                            onClick = { onDismiss(); onMoveToVault(item) },
                        )
                    }
                    if (!item.isProtected) {
                        ActionRow(
                            icon = Icons.Default.Delete,
                            label = "Move to Trash",
                            color = MaterialTheme.colorScheme.error,
                            onClick = { onDismiss(); onTrash?.invoke(item) },
                        )
                    }
                }
            }
        }
    }
}

/** A non-clickable line saying why the item can't be deleted. */
@Composable
private fun ProtectedInfoRow(item: FileItem) {
    val by = item.protectedBy
    ActionRow(
        icon = Icons.Default.Shield,
        label = if (!item.protected && by != null) "Protected by folder “$by”" else "Protected from deletion",
        onClick = null,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** One row of the sheet; a null [onClick] makes it a plain, non-clickable line. */
@Composable
private fun ActionRow(
    icon: ImageVector,
    label: String,
    onClick: (() -> Unit)?,
    color: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = color,
            modifier = Modifier.size(22.dp),
        )
        Spacer(modifier = Modifier.width(16.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = color,
        )
    }
}
