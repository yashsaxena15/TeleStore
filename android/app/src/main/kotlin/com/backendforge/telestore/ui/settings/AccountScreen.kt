package com.backendforge.telestore.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.backendforge.telestore.core.TelegramVerification
import com.backendforge.telestore.core.UserProfile
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.openInBrowser
import kotlinx.coroutines.launch

/** Who you're signed in as, your password, your Telegram link and your index chat (the website's Settings › Account and Connection). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(container: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var profile by remember { mutableStateOf<UserProfile?>(null) }
    var chatId by remember { mutableStateOf<Long?>(null) }
    var chatLoaded by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var passwordOpen by remember { mutableStateOf(false) }
    var verification by remember { mutableStateOf<TelegramVerification?>(null) }
    var busy by remember { mutableStateOf(false) }
    fun say(text: String) = scope.launch { snackbar.showSnackbar(text) }

    // After connecting Telegram or adding the bot to a group, coming back shows the change
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) reload++ }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(reload) {
        val api = container.api()
        attempt("Couldn't load your account.", { error = it }) { api.profile() }?.let { profile = it; error = null }
        attempt("Couldn't load the index chat.", { }) { api.indexChat() }?.let { chatId = it.chatId; chatLoaded = true }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Account") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val me = profile
        if (me == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(24.dp)) } ?: CircularProgressIndicator()
            }
            return@Scaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Panel(Icons.Filled.AccountCircle, "Account", "Who you're signed in as") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(48.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
                            Text(me.displayName.take(1).uppercase(), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                        }
                        Column(Modifier.padding(start = 12.dp)) {
                            Text(me.displayName, style = MaterialTheme.typography.titleMedium)
                            Text(me.email ?: me.username, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Fact("Username", me.username)
                    Fact("Email", me.email ?: "Not set")
                    OutlinedButton(onClick = { passwordOpen = true }) {
                        Icon(Icons.Filled.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Change password", modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }

            item { DevicesPanel(container, onMessage = { say(it) }) }

            item {
                Panel(Icons.AutoMirrored.Filled.Send, "Telegram", "Connect your Telegram account so files you send to the bots land in your Inbox, and so you can upload.") {
                    if (me.telegramId != null) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusPill("Connected", good = true)
                            Text(me.telegramName.ifBlank { "Telegram account" }, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        }
                        Text("ID ${me.telegramId}", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        StatusPill("Not connected", good = false)
                    }
                    val start: () -> Unit = {
                        scope.launch {
                            busy = true
                            attempt("Couldn't make a verification link. Try again.", { say(it) }) { container.api().telegramVerification() }?.let { verification = it }
                            busy = false
                        }
                    }
                    if (me.telegramId != null) OutlinedButton(onClick = start, enabled = !busy) { Text("Re-verify") }
                    else Button(onClick = start, enabled = !busy) { Text("Connect Telegram") }
                }
            }

            item { IndexChatPanel(container, chatId, chatLoaded, onSaved = { chatId = it; say("Index chat saved") }, onMessage = { say(it) }) }
        }
    }

    if (passwordOpen) {
        val me = profile
        PasswordDialog(
            title = "Change password",
            text = "Used when you sign in as ${me?.username}. Leave the current password empty if you sign in with Telegram or Google and never set one.",
            askCurrent = true,
            onDismiss = { passwordOpen = false },
        ) { current, new ->
            var problem: String? = null
            attempt("Couldn't change the password.", { problem = it }) { container.api().changePassword(me?.username.orEmpty(), current, new) }
            if (problem == null) say("Password changed")
            problem
        }
    }

    verification?.let { v ->
        AlertDialog(
            onDismissRequest = { verification = null },
            title = { Text("Connect Telegram") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text("Verification code", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(v.code, style = MaterialTheme.typography.titleLarge, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                    Text("Open Telegram and press Start in the chat with @${v.botUsername}. The code is sent for you. Then come back here.")
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    openInBrowser(context, v.link)
                    verification = null
                }) { Text("Open Telegram") }
            },
            dismissButton = { TextButton(onClick = { verification = null }) { Text("Cancel") } },
        )
    }
}

/** The private Telegram group where every uploaded file is kept; uploads fail without one. */
@Composable
private fun IndexChatPanel(container: AppContainer, saved: Long?, loaded: Boolean, onSaved: (Long) -> Unit, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var value by remember(saved) { mutableStateOf(saved?.toString().orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    val trimmed = value.trim()
    // A number that fits (a very long one would not)
    val valid = Regex("""-?\d+""").matches(trimmed) && trimmed.toLongOrNull() != null
    val dirty = trimmed != saved?.toString().orEmpty()

    Panel(Icons.Filled.Tag, "Index chat", "The private Telegram group where your files are kept. Every file you upload is stored there as a message.") {
        if (loaded && saved == null) {
            Text("Not set up yet. Uploads won't work until the bot is in one of your groups.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        Text(
            "1. In Telegram, create a private group (or use one you have).\n2. Tap Add bot to a chat and pick that group.\n3. In the group, tap the button the bot posts. The chat ID fills in by itself.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            value = value, onValueChange = { value = it }, label = { Text("Chat ID") }, singleLine = true,
            placeholder = { Text("-1001234567890") },
            isError = trimmed.isNotEmpty() && !valid,
            supportingText = { Text(if (trimmed.isNotEmpty() && !valid) "A chat ID is a number, for example -1001234567890." else "Group IDs start with -100.") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = {
                scope.launch {
                    attempt("Couldn't find the bot. Try again.", onMessage) { container.api().telegramVerification() }
                        ?.let { openInBrowser(context, it.addToGroupLink) }
                }
            }) { Text("Add bot to a chat") }
            Spacer(Modifier.weight(1f))
            Button(
                enabled = dirty && valid && !busy,
                onClick = {
                    scope.launch {
                        val id = trimmed.toLongOrNull() ?: return@launch
                        busy = true
                        attempt("Couldn't save the index chat.", onMessage) { container.api().setIndexChat(id) }?.let { onSaved(it.chatId ?: id) }
                        busy = false
                    }
                },
            ) { Text(if (busy) "Saving…" else "Save") }
        }
    }
}
