package com.backendforge.telestore.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FolderColors

/** "Folder colour": Default and the eight colours the website has. [onPick] gets null for Default. */
@Composable
fun FolderColorDialog(
    folder: FileItem,
    onPick: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val choices: List<String?> = listOf<String?>(null) + FolderColors.names
    val current = folder.color?.lowercase()?.let { if (it == "gray") "grey" else it }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Folder colour") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(folder.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                choices.chunked(5).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        row.forEach { name ->
                            ColorSwatch(name = name, selected = name == current, onClick = { onPick(name) })
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ColorSwatch(name: String?, selected: Boolean, onClick: () -> Unit) {
    val tint: Color? = folderTint(name)
    val fill: Color = tint ?: MaterialTheme.colorScheme.secondaryContainer
    val mark: Color = if (tint != null) Color.White else MaterialTheme.colorScheme.primary
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(fill)
            .border(if (selected) 3.dp else 0.dp, if (selected) MaterialTheme.colorScheme.onSurface else Color.Transparent, CircleShape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = if (name == null) "Default" else FolderColors.label(name) },
    ) {
        when {
            selected -> Icon(Icons.Filled.Check, contentDescription = if (name == null) "Default (chosen)" else "${FolderColors.label(name)} (chosen)", tint = mark, modifier = Modifier.size(20.dp))
            name == null -> Icon(Icons.Filled.Folder, contentDescription = "Default", tint = mark, modifier = Modifier.size(20.dp))
            else -> {} // the colour itself is the swatch
        }
    }
}
