package com.backendforge.telestore.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Laptop
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.SignedInDevice
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.notify.ago
import kotlinx.coroutines.launch

/** "Password · signed in yesterday · active 5 min ago" (the same line as the website). */
internal fun deviceDetails(device: SignedInDevice): String = listOfNotNull(
    if (device.method == "google") "Google" else "Password",
    ago(device.signedInAt).takeIf { it.isNotEmpty() }?.let { "signed in $it" },
    ago(device.lastSeen).takeIf { it.isNotEmpty() && !device.current }?.let { "active $it" },
).joinToString(" · ")

/** Where this account is signed in; any other device can be signed out from here. */
@Composable
internal fun DevicesPanel(container: AppContainer, onMessage: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<SignedInDevice>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    // A device to sign out, or null with [confirmOthers] for all the others
    var confirm by remember { mutableStateOf<SignedInDevice?>(null) }
    var confirmOthers by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(reload) {
        attempt("Couldn't load your devices.", { error = it }) { container.api().devices() }?.let { devices = it; error = null }
    }
    val others = devices.orEmpty().filterNot { it.current }

    Panel(Icons.Filled.Devices, "Your devices", "Where your account is signed in. Sign out any you don't recognise.") {
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        if (devices == null && error == null) Text("Loading your devices…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        devices.orEmpty().forEach { device ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (device.kind == "app") Icons.Filled.Smartphone else Icons.Filled.Laptop, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(device.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (device.current) StatusPill("This device", good = true)
                    }
                    Text(deviceDetails(device), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (!device.current) TextButton(onClick = { confirm = device }) { Text("Sign out") }
            }
        }
        if (devices != null && others.isEmpty()) Text("You're only signed in here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (others.size > 1) {
            OutlinedButton(onClick = { confirmOthers = true }) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Sign out all others", modifier = Modifier.padding(start = 8.dp))
            }
        }
    }

    if (confirm != null || confirmOthers) {
        val target = confirm
        val close = { confirm = null; confirmOthers = false }
        AlertDialog(
            onDismissRequest = { if (!busy) close() },
            title = { Text(if (target != null) "Sign out ${target.name}?" else "Sign out ${others.size} other devices?") },
            text = { Text("They'll need your password (or Google) to sign in again. Uploads running there stop.") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    scope.launch {
                        busy = true
                        if (target != null) {
                            attempt("Couldn't sign out that device.", onMessage) { container.api().signOutDevice(target.id) }?.let { onMessage("Signed out ${target.name}") }
                        } else {
                            attempt("Couldn't sign out the other devices.", onMessage) { container.api().signOutOtherDevices() }?.let {
                                onMessage(if (it == 1) "Signed out 1 device" else "Signed out $it devices")
                            }
                        }
                        busy = false
                        close()
                        reload++
                    }
                }) { Text(if (busy) "Signing out…" else "Sign out") }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("Cancel") } },
        )
    }
}
