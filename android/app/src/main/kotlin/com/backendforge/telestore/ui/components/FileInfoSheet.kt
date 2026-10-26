package com.backendforge.telestore.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DividerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.DateFormatter
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.TeleStoreApi

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileInfoSheet(
    item: FileItem,
    api: TeleStoreApi,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            // Header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                FileThumbnail(
                    item = item,
                    api = api,
                    modifier = Modifier.size(48.dp),
                    shapeRadius = 10.dp,
                    iconSize = 26.dp,
                )
                Spacer(modifier = Modifier.width(16.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = if (item.isFolder) "Folder" else item.kind.name.lowercase().replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 16.dp),
                color = DividerDefaults.color.copy(alpha = 0.5f),
            )

            InfoRow(label = "Kind", value = if (item.isFolder) "Folder" else item.kind.name.lowercase().replaceFirstChar { it.uppercase() })
            if (!item.isFolder) {
                val sizeBytes = item.size ?: 0L
                val byteCount = if (sizeBytes > 0) " ($sizeBytes bytes)" else ""
                InfoRow(label = "Size", value = "${formatBytes(item.size)}$byteCount")
            }
            InfoRow(label = "Location", value = item.path.ifEmpty { "/" })
            val modified = DateFormatter.formatFull(item.modified)
            if (modified.isNotEmpty()) {
                InfoRow(label = "Modified", value = modified)
            }
            InfoRow(label = "Starred", value = if (item.starred) "Yes" else "No")

            if (item.trashed) {
                val trashedDate = DateFormatter.formatFull(item.trashedAt)
                if (trashedDate.isNotEmpty()) {
                    InfoRow(label = "Deleted on", value = trashedDate)
                }
                if (!item.originalPath.isNullOrEmpty()) {
                    InfoRow(label = "Original path", value = item.originalPath!!)
                }
            }
        }
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
