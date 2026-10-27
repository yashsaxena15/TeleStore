package com.backendforge.telestore.ui.components

import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

@Composable
fun NewFolderDialog(
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New folder") },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Folder name") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name.trim()) },
                enabled = name.isNotBlank(),
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
fun RenameDialog(
    initialName: String,
    isFolder: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val dot = initialName.lastIndexOf('.')
    val selection = if (!isFolder && dot > 0) TextRange(0, dot) else TextRange(0, initialName.length)
    var nameValue by remember { mutableStateOf(TextFieldValue(initialName, selection = selection)) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isFolder) "Rename folder" else "Rename file") },
        text = {
            OutlinedTextField(
                value = nameValue,
                onValueChange = { nameValue = it },
                label = { Text("Name") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(nameValue.text.trim()) },
                enabled = nameValue.text.isNotBlank() && nameValue.text.trim() != initialName,
            ) {
                Text("Rename")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmText: String = "Confirm",
    isDestructive: Boolean = false,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors = if (isDestructive) {
                    ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                } else {
                    ButtonDefaults.textButtonColors()
                },
            ) {
                Text(confirmText)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

/** Name for the ZIP of [items]; it's saved next to them. */
@Composable
fun CompressDialog(
    items: List<com.backendforge.telestore.core.FileItem>,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val suggested = remember(items) {
        (if (items.size == 1) items[0].name.substringBeforeLast('.').ifBlank { items[0].name } else "Archive") + ".zip"
    }
    var name by remember { mutableStateOf(suggested) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Compress to ZIP") },
        text = {
            androidx.compose.foundation.layout.Column {
                Text(
                    if (items.size == 1) "${items[0].name} is packed into one ZIP in this folder." else "${items.size} items are packed into one ZIP in this folder.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("ZIP name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name.trim().let { if (it.lowercase().endsWith(".zip")) it else "$it.zip" }) },
                enabled = name.isNotBlank() && '/' !in name,
            ) { Text("Compress") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
