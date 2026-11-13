package com.backendforge.telestore.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.telegram.TgState
import com.backendforge.telestore.ui.components.AppTopBar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Telegram on this phone: sign in once with the account that owns the TeleStore storage channel,
 * and uploads, backup, playback and downloads of your own files go straight between the phone and
 * Telegram, without using the TeleStore server.
 */
@Composable
fun TelegramScreen(container: AppContainer, onBack: (() -> Unit)?, onSignOutOfTeleStore: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val state by container.telegram.state.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var field by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        attempt("Couldn't start Telegram on this phone.", { scope.launch { snackbar.showSnackbar(it) } }) { container.startTelegram() }
    }
    // Signed in here: Telegram starts with the app from now on (and ends when TeleStore signs out)
    LaunchedEffect(state) {
        if (state is TgState.Ready) container.settings.telegramUsed = true
        if (state is TgState.SignedOut) container.settings.telegramUsed = false
    }

    fun step(work: suspend () -> Unit) {
        busy = true
        scope.launch {
            try {
                work()
                field = ""
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                snackbar.showSnackbar(e.message ?: "That didn't work. Try again.")
            } finally {
                busy = false
            }
        }
    }

    Scaffold(
        topBar = { if (onBack != null) AppTopBar(title = "Telegram on this phone", onBack = onBack) else AppTopBar(title = "Sign in to Telegram") },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Panel(Icons.Default.Bolt, "Your files live in your Telegram",
                    "TeleStore uses your own Telegram account on this phone: uploads, photo backup, playback, photos and downloads " +
                        "of your files go straight between this phone and your Telegram storage chat, at your connection's speed. " +
                        "Files shared with you and Private Vault files come through TeleStore.") {}
            }
            item {
                Panel(Icons.AutoMirrored.Filled.Send, "Telegram account") {
                    when (val s = state) {
                        TgState.Starting -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                            Text("Starting Telegram…")
                        }
                        TgState.Unavailable -> Text(
                            "This phone isn't supported (it needs a 64-bit ARM processor). Everything keeps working through TeleStore.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        is TgState.Unsupported -> Text(s.what, style = MaterialTheme.typography.bodyMedium)
                        TgState.SignedOut -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Your Telegram phone number, with the country code. Use the account that owns your TeleStore storage channel.",
                                style = MaterialTheme.typography.bodyMedium)
                            OutlinedTextField(field, { field = it }, label = { Text("Phone number") }, placeholder = { Text("+91 98765 43210") },
                                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
                            Button(onClick = { step { container.telegram.sendPhone(field) } }, enabled = !busy && field.isNotBlank()) { Text("Send code") }
                        }
                        is TgState.WaitCode -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Telegram sent a code ${s.via}. Enter it here.", style = MaterialTheme.typography.bodyMedium)
                            OutlinedTextField(field, { field = it }, label = { Text("Code") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                            Button(onClick = { step { container.telegram.sendCode(field) } }, enabled = !busy && field.isNotBlank()) { Text("Sign in") }
                        }
                        is TgState.WaitPassword -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("This account has two-step verification." + if (s.hint.isNotBlank()) " Hint: ${s.hint}" else "",
                                style = MaterialTheme.typography.bodyMedium)
                            PasswordField(field, "Two-step password") { field = it }
                            Button(onClick = { step { container.telegram.sendPassword(field) } }, enabled = !busy && field.isNotBlank()) { Text("Sign in") }
                        }
                        is TgState.Ready -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatusPill("Signed in as ${s.name}", good = true)
                            Text("Signing out of Telegram here also stops your uploads, backup and downloads until you sign in again.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedButton(onClick = { step { container.telegram.signOut() } }, enabled = !busy) { Text("Sign out of Telegram on this phone") }
                        }
                    }
                }
            }
            if (onSignOutOfTeleStore != null) {
                item {
                    TextButton(onClick = onSignOutOfTeleStore, modifier = Modifier.fillMaxWidth()) { Text("Sign out of TeleStore instead") }
                }
            }
        }
    }
}
