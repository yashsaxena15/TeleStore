package com.backendforge.telestore.ui.drive

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.Session

/** How to open TeleStore as a drive in other apps (WebDAV), with the details to copy. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebDavScreen(container: AppContainer, session: Session, onBack: () -> Unit) {
    val address = container.api().url("webdav").toString().trimEnd('/') + "/"
    val google = session.username.startsWith("google_")
    Scaffold(
        topBar = { TopAppBar(title = { Text("WebDAV") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } }) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "Open TeleStore like a drive in file managers and backup apps (CX File Explorer, Solid Explorer, Swift Backup), on Windows (Map network drive) or a Mac (Connect to Server).",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            CopyField("Address", address)
            CopyField("Username", session.username)
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text("Password", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        if (google) "Your account signs in with Google and has no password. Ask the owner to set one for WebDAV."
                        else "Your TeleStore password (the one you sign in with).",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
            Text("Tips", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            Text(
                "• Choose \"WebDAV\" with HTTPS in the other app and paste the address.\n" +
                    "• You'll see Home, Telegram Inbox, Starred and Trash. The Private Vault never shows over WebDAV.\n" +
                    "• Apps that ask for free space see your 100 TB plan.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CopyField(label: String, value: String) {
    val clipboard = LocalClipboardManager.current
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value, style = MaterialTheme.typography.bodyLarge, fontFamily = FontFamily.Monospace)
            }
            IconButton(onClick = { clipboard.setText(AnnotatedString(value)) }) { Icon(Icons.Filled.ContentCopy, contentDescription = "Copy $label") }
        }
    }
}
