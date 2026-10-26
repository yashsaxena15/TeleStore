package com.backendforge.telestore.ui.components

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
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.DriveFileMove
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Info
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
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
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
                    ActionRow(
                        icon = Icons.Default.DeleteForever,
                        label = "Delete forever",
                        color = MaterialTheme.colorScheme.error,
                        onClick = { onDismiss(); onDeleteForever?.invoke(item) },
                    )
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
                    ActionRow(
                        icon = Icons.Default.Delete,
                        label = "Move to Trash",
                        color = MaterialTheme.colorScheme.error,
                        onClick = { onDismiss(); onTrash?.invoke(item) },
                    )
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

@Composable
private fun ActionRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    color: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
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
