package com.backendforge.telestore.ui.transfers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.Machine
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.settings.attempt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Transfers › Workers (owner only): each machine that runs cloud transfers, with Pause / Resume.
 * A paused machine takes nothing new; "Stop now" also hands what it runs to the other machines.
 */
@Composable
fun WorkersCard(container: AppContainer, onMessage: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var machines by remember { mutableStateOf<List<Machine>>(emptyList()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }

    // Every 5 s while Transfers is open
    LaunchedEffect(tick) {
        while (true) {
            try {
                machines = container.api().machines().machines
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
            delay(5_000)
        }
    }
    if (machines.isEmpty()) return

    fun act(m: Machine, call: suspend () -> String) {
        busy = m.id
        scope.launch {
            attempt("Couldn't change ${m.name}.", onMessage) { call() }?.let(onMessage)
            busy = null
            tick++
        }
    }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.Dns, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Workers", style = MaterialTheme.typography.labelLarge)
                Text("· machines that run cloud transfers", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            machines.forEach { m ->
                MachineRow(
                    m,
                    busy = busy == m.id,
                    onPause = { stopNow ->
                        act(m) {
                            val res = container.api().pauseMachine(m.id, stopNow)
                            when {
                                !stopNow -> "${m.name} paused. What it's running finishes; it takes nothing new."
                                res.handedBack > 0 -> "${m.name} paused. ${res.handedBack} transfer${if (res.handedBack == 1) "" else "s"} went back to the queue."
                                else -> "${m.name} paused."
                            }
                        }
                    },
                    onResume = { act(m) { container.api().resumeMachine(m.id); "${m.name} resumed" } },
                )
            }
        }
    }
}

@Composable
private fun MachineRow(m: Machine, busy: Boolean, onPause: (stopNow: Boolean) -> Unit, onResume: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val tone = when {
        m.paused -> Color(0xFFD97706)
        !m.online -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> Color(0xFF16A34A)
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(m.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(m.state, style = MaterialTheme.typography.labelSmall, color = tone)
            }
            Text(m.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
        when {
            busy -> CircularProgressIndicator(Modifier.size(20.dp).padding(2.dp), strokeWidth = 2.dp)
            m.paused -> OutlinedButton(onClick = onResume) {
                Icon(Icons.Filled.PlayArrow, null, Modifier.size(16.dp))
                Text("Resume", Modifier.padding(start = 4.dp))
            }
            else -> Box {
                OutlinedButton(onClick = { menu = true }) {
                    Icon(Icons.Filled.Pause, null, Modifier.size(16.dp))
                    Text("Pause", Modifier.padding(start = 4.dp))
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text("Pause after current transfers")
                                Text("What it's running finishes; it takes nothing new.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        },
                        onClick = { menu = false; onPause(false) },
                    )
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text("Stop now")
                                Text("What it's running goes back to the queue for the other machines.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        },
                        onClick = { menu = false; onPause(true) },
                    )
                }
            }
        }
    }
}
