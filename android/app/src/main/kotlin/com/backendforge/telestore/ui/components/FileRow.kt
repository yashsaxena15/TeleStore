package com.backendforge.telestore.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.DateFormatter
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.TeleStoreApi

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileRow(
    item: FileItem,
    api: TeleStoreApi,
    isSelectionMode: Boolean,
    isSelected: Boolean,
    onToggleSelect: () -> Unit,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onOpenActions: () -> Unit,
    modifier: Modifier = Modifier,
    /** A downloaded copy is on this phone. */
    offline: Boolean = false,
) {
    val haptics = rememberHaptics()
    val dateStr = DateFormatter.formatShort(item.modified)
    val detailsText = when {
        item.isFolder -> dateStr
        dateStr.isNotEmpty() -> "${formatBytes(item.size)} • $dateStr"
        else -> formatBytes(item.size)
    }.let { if (offline) "$it • Offline" else it
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = { if (isSelectionMode) onToggleSelect() else onClick() },
                onLongClick = { haptics.longPress(); onLongClick() },
            )
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        if (isSelectionMode) {
            Checkbox(
                checked = isSelected,
                onCheckedChange = { onToggleSelect() },
                modifier = Modifier.padding(end = 8.dp),
            )
        }

        FileThumbnail(
            item = item,
            api = api,
            modifier = Modifier.size(44.dp),
            shapeRadius = 10.dp,
            iconSize = 22.dp,
        )

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = item.name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (item.starred) {
                    Spacer(modifier = Modifier.width(6.dp))
                    Icon(
                        imageVector = Icons.Default.Star,
                        contentDescription = "Starred",
                        tint = Color(0xFFFBBF24),
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            if (detailsText.isNotEmpty()) {
                Text(
                    text = detailsText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (!isSelectionMode) {
            IconButton(onClick = onOpenActions) {
                Icon(
                    imageVector = Icons.Default.MoreVert,
                    contentDescription = "Actions for ${item.name}",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
