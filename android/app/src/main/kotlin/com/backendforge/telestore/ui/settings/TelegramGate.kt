package com.backendforge.telestore.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.telegram.TgState
import com.backendforge.telestore.ui.components.AppTopBar
import kotlinx.coroutines.launch

/**
 * Telegram is required: your files live in your own Telegram and this phone reads and writes them
 * with your own Telegram account. Until that's set up the app shows only the steps:
 *  1. your Telegram linked to TeleStore and your storage chat made (Account › Telegram, Index chat);
 *  2. Telegram signed in on this phone, with an account that can open that storage chat.
 * Once done it never shows again, unless Telegram is signed out on this phone. Phones that can't run
 * Telegram (not 64-bit ARM) skip it and use TeleStore as before. Without a connection the app opens
 * (offline files keep working) and checks again later.
 */
@Composable
fun TelegramGate(container: AppContainer, content: @Composable () -> Unit) {
    if (!container.telegram.available) {
        content()
        return
    }
    val scope = rememberCoroutineScope()
    val state by container.telegram.state.collectAsState()
    var signedInHere by remember { mutableStateOf(container.settings.telegramUsed) }
    var missing by remember { mutableStateOf<String?>(null) } // "link" or "chat": TeleStore's side isn't set up yet
    var wrongAccount by remember { mutableStateOf<String?>(null) }
    var showAccount by remember { mutableStateOf(false) }
    var recheck by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) { runCatching { container.startTelegram() } }
    // TeleStore's side: Telegram linked and a storage chat (no connection: let the app open, check next time)
    LaunchedEffect(recheck) {
        if (signedInHere && state is TgState.Ready) return@LaunchedEffect
        missing = runCatching {
            val me = container.api().profile()
            when {
                me.telegramId == null -> "link"
                container.api().indexChat().chatId == null -> "chat"
                else -> null
            }
        }.getOrNull()
    }
    // Signed in here: check this account can open the storage chat, then the app opens
    LaunchedEffect(state) {
        when (state) {
            is TgState.Ready -> {
                val chat = runCatching { container.api().indexChat().chatId }.getOrNull()
                val problem = if (chat == null) null else runCatching { container.telegram.ensureChat(chat) }.exceptionOrNull()
                wrongAccount = problem?.message
                if (problem == null) {
                    container.settings.telegramUsed = true
                    signedInHere = true
                }
            }
            TgState.SignedOut -> {
                container.settings.telegramUsed = false
                signedInHere = false
            }
            else -> Unit
        }
    }

    val needsSetup = !signedInHere || state is TgState.SignedOut || state is TgState.WaitCode ||
        state is TgState.WaitPassword || state is TgState.Unsupported
    if (!needsSetup) {
        content()
        return
    }

    fun signOutOfTeleStore() {
        scope.launch {
            runCatching { container.api().logout() }
            container.session.signedOut()
        }
    }

    when {
        showAccount -> AccountScreen(container, onBack = { showAccount = false; recheck++ })
        missing != null -> Steps(
            title = if (missing == "link") "Connect your Telegram" else "Make your storage chat",
            text = if (missing == "link") {
                "TeleStore keeps your files in your own Telegram. First connect your Telegram account to TeleStore: " +
                    "open Account, tap Connect Telegram and press Start in the bot's chat. Then come back here.\n\n" +
                    "Each Telegram account can belong to only one TeleStore account. If the bot says yours is already " +
                    "connected to another account, use a different Telegram account (another phone number)."
            } else {
                "Your files are kept in a private Telegram group or channel of your own. Open Account › Index chat, " +
                    "add the TeleStore bot to a new group and tap Ok when it asks. Then come back here."
            },
            action = "Open Account" to { showAccount = true },
            secondary = "Check again" to { recheck++ },
            onSignOut = ::signOutOfTeleStore,
        )
        wrongAccount != null && state is TgState.Ready -> Steps(
            title = "Use your storage chat's Telegram account",
            text = "${wrongAccount}\n\nSign out of Telegram here and sign in with the account that owns your TeleStore storage chat.",
            action = "Sign out of Telegram" to { scope.launch { runCatching { container.telegram.signOut() }; wrongAccount = null } },
            secondary = "Check again" to { wrongAccount = null; recheck++ },
            onSignOut = ::signOutOfTeleStore,
        )
        state is TgState.Ready -> Waiting("Opening your storage chat…")
        else -> TelegramScreen(container, onBack = null, onSignOutOfTeleStore = ::signOutOfTeleStore)
    }
}

@Composable
private fun Steps(
    title: String,
    text: String,
    action: Pair<String, () -> Unit>,
    secondary: Pair<String, () -> Unit>,
    onSignOut: () -> Unit,
) {
    Scaffold(topBar = { AppTopBar(title = "Set up Telegram") }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))
            Icon(Icons.Default.Bolt, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(48.dp))
            Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            Text(text, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = action.second, modifier = Modifier.fillMaxWidth()) { Text(action.first) }
            OutlinedButton(onClick = secondary.second, modifier = Modifier.fillMaxWidth()) { Text(secondary.first) }
            TextButton(onClick = onSignOut) { Text("Sign out of TeleStore") }
        }
    }
}

@Composable
private fun Waiting(text: String) {
    Scaffold { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CircularProgressIndicator()
            Spacer(Modifier.height(16.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
