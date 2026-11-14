package com.backendforge.telestore.ui.links

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.ui.components.AppTopBar

/** Leeches, video / Instagram downloads and Google Drive use the server's bandwidth, so the owner
 *  allows them per user (Settings › Users). Shown when a link or the Drive screen opens without that. */
@Composable
fun CloudOffScreen(onBack: () -> Unit) {
    Scaffold(topBar = { AppTopBar(title = "Cloud features", onBack = onBack) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Filled.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(48.dp))
            Text("Cloud features are turned off for your account", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(
                "Leeching links and torrents, video and Instagram downloads and Google Drive use the server's bandwidth, " +
                    "so the owner turns them on for each person. Ask the owner to allow them.",
                style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
