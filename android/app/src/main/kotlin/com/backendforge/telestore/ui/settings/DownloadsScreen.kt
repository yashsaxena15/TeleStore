package com.backendforge.telestore.ui.settings

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.DateFormatter
import com.backendforge.telestore.core.InstagramSession
import com.backendforge.telestore.core.MediaSettings
import com.backendforge.telestore.core.MediaSync
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Downloads the server makes from links: synced playlists (everyone's own), and for the owner the
 * yt-dlp cookies and updates and the Instagram account (the website's Settings › Integrations).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var settings by remember { mutableStateOf<MediaSettings?>(null) }
    var syncs by remember { mutableStateOf<List<MediaSync>>(emptyList()) }
    var everyHours by remember { mutableStateOf(6.0) }
    var instagram by remember { mutableStateOf<InstagramSession?>(null) }
    var isOwner by remember { mutableStateOf(false) }
    fun say(text: String) = scope.launch { snackbar.showSnackbar(text) }

    LaunchedEffect(Unit) {
        val api = container.api()
        attempt("", { }) { api.mediaSyncs() }?.let { syncs = it.syncs; everyHours = it.everyHours }
        isOwner = attempt("", { }) { api.isOwner() } == true
        if (isOwner) {
            attempt("Couldn't load the download settings.", { say(it) }) { api.mediaSettings() }?.let { settings = it }
            attempt("", { }) { api.instagramSession() }?.let { instagram = it }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Video downloads") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (isOwner) item { DownloaderPanel(container, settings, onSettings = { settings = it }, onMessage = { say(it) }) }

            item {
                Panel(Icons.AutoMirrored.Filled.PlaylistPlay, "Synced playlists", "New videos download by themselves; each one is checked every ${everyHours.toInt()} hours.") {
                    if (syncs.isEmpty()) {
                        Text(
                            "None yet. When you download a playlist or channel from a link, turn on \"Keep downloading new videos\".",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            items(syncs, key = { it.id }) { sync ->
                SyncRow(
                    sync = sync,
                    onCheck = {
                        scope.launch {
                            attempt("Couldn't check for new videos.", { say(it) }) { container.api().checkSync(sync.id) }?.let {
                                say(if (it.new > 0) "${it.new} new video${if (it.new == 1) "" else "s"} queued" else "No new videos")
                                attempt("", { }) { container.api().mediaSyncs() }?.let { r -> syncs = r.syncs }
                            }
                        }
                    },
                    onPause = {
                        scope.launch {
                            attempt("Couldn't change the sync.", { say(it) }) { container.api().setSyncEnabled(sync.id, !sync.enabled) }
                                ?.let { updated -> syncs = syncs.map { if (it.id == sync.id) updated else it } }
                        }
                    },
                    onRemove = {
                        scope.launch {
                            attempt("Couldn't remove the sync.", { say(it) }) { container.api().removeSync(sync.id) }?.let {
                                syncs = syncs.filter { it.id != sync.id }
                                say("Stopped syncing")
                            }
                        }
                    },
                )
            }

            if (isOwner) item { InstagramPanel(container, instagram, onSession = { instagram = it }, onMessage = { say(it) }) }
        }
    }
}

/** yt-dlp: the cookies of a signed-in browser, the bot-check helper and updates. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DownloaderPanel(container: AppContainer, settings: MediaSettings?, onSettings: (MediaSettings) -> Unit, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var showHow by remember { mutableStateOf(false) }

    fun act(what: String, fallback: String, call: suspend () -> MediaSettings, done: (MediaSettings) -> String) {
        scope.launch {
            busy = what
            attempt(fallback, onMessage) { call() }?.let {
                onSettings(it)
                onMessage(done(it))
            }
            busy = null
        }
    }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        act("cookies", "Couldn't save the cookies.", {
            // A cookies.txt is small; the server refuses anything over 2 MB
            val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } ?: ByteArray(0)
            container.api().uploadCookies("cookies.txt", bytes)
        }) { if (it.youtubeSignIn == "signed_in") "Cookies saved. YouTube confirmed the sign-in." else "Cookies saved." }
    }

    Panel(Icons.Filled.Movie, "Downloader", "YouTube, YouTube Music, Facebook and other sites, downloaded by the server with yt-dlp.") {
        if (settings == null) {
            Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Panel
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            when {
                !settings.hasCookies -> StatusPill("No cookies", good = null)
                settings.youtubeSignIn == "signed_out" -> StatusPill("YouTube not signed in", good = false)
                settings.youtubeSignIn == "signed_in" -> StatusPill("Signed in", good = true)
                else -> StatusPill("Cookies added", good = true)
            }
        }
        Text(settings.cookiesStatus, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { pick.launch("text/*") }, enabled = busy == null) {
                Text(if (busy == "cookies") "Checking…" else if (settings.hasCookies) "Replace cookies" else "Add cookies")
            }
            if (settings.hasCookies) {
                TextButton(onClick = { act("remove", "Couldn't remove the cookies.", { container.api().removeCookies() }) { "Cookies removed" } }, enabled = busy == null) {
                    Text("Remove cookies", color = MaterialTheme.colorScheme.error)
                }
            }
        }
        TextButton(onClick = { showHow = !showHow }, contentPadding = PaddingValues(0.dp)) { Text(if (showHow) "Hide how to get a cookies.txt" else "How to get a cookies.txt") }
        if (showHow) {
            Text(
                "1. Use a spare account, not your main one: heavy downloading can get an account flagged.\n" +
                    "2. Install the \"Get cookies.txt LOCALLY\" extension (Chrome, Edge, or Firefox on Android).\n" +
                    "3. In a private window, sign in on youtube.com (not music.youtube.com) or facebook.com.\n" +
                    "4. For YouTube, open youtube.com/robots.txt in that same tab so YouTube doesn't replace the cookies while you export.\n" +
                    "5. Export the cookies for the current site with the extension.\n" +
                    "6. Close the private window without signing out, then tap Add cookies here and pick the file.\n" +
                    "7. Add each site's file the same way: a new file replaces only that site's cookies.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        HorizontalDivider()
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusPill(if (settings.potHelper) "Bot-check helper running" else "Bot-check helper not running", good = settings.potHelper)
        }
        Text(
            if (settings.potHelper) "It answers YouTube's \"prove you're not a bot\" checks for the server."
            else "Start the pot service from docker-compose; YouTube blocks the server more often without it.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider()
        Text(
            "yt-dlp ${settings.version}" + if (settings.updated && settings.builtinVersion != null) " (updated; built-in ${settings.builtinVersion})" else "",
            style = MaterialTheme.typography.bodyMedium,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { act("update", "Couldn't update the downloader.", { container.api().updateDownloader() }) { "yt-dlp is now ${it.version}" } }, enabled = busy == null) {
                Text(if (busy == "update") "Updating… (up to a few minutes)" else "Update yt-dlp")
            }
            if (settings.updated) {
                TextButton(onClick = { act("builtin", "Couldn't switch the downloader.", { container.api().useBuiltinDownloader() }) { "Back to the built-in yt-dlp ${it.version}" } }, enabled = busy == null) {
                    Text("Use the built-in version")
                }
            }
        }
        Text(
            "Sites change often. When downloads start failing everywhere, update yt-dlp; downloads that are running finish first.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SyncRow(sync: MediaSync, onCheck: () -> Unit, onPause: () -> Unit, onRemove: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    androidx.compose.material3.Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(sync.title ?: sync.url.orEmpty(), style = MaterialTheme.typography.titleSmall, maxLines = 2)
            Text(sync.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val status = when {
                sync.lastError != null -> sync.lastError.orEmpty()
                sync.lastChecked != null -> "Checked ${DateFormatter.formatShort(sync.lastChecked)}" + if (sync.lastNewCount > 0) ", ${sync.lastNewCount} new" else ""
                else -> "Not checked yet"
            } + if (!sync.enabled) " · Paused" else ""
            Text(status, style = MaterialTheme.typography.bodySmall, color = if (sync.lastError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { busy = true; onCheck() }, enabled = sync.enabled && !busy) { Text("Check now") }
                OutlinedButton(onClick = onPause) { Text(if (sync.enabled) "Pause" else "Resume") }
                TextButton(onClick = onRemove) { Text("Stop syncing", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

/** The owner signs in one Instagram account; the server uses it for every "Import from Instagram". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InstagramPanel(container: AppContainer, session: InstagramSession?, onSession: (InstagramSession) -> Unit, onMessage: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var form by remember { mutableStateOf(false) }
    var browser by remember { mutableStateOf(false) }
    var needsCode by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var sessionId by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun reset() {
        form = false; browser = false; needsCode = false
        username = ""; password = ""; code = ""; sessionId = ""; error = null
    }

    Panel(Icons.Filled.CameraAlt, "Instagram", "Instagram only lets signed-in accounts download posts, so imports use the account connected here.") {
        when {
            session?.connected == true -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusPill("Connected", good = true)
                    Text("Imports use @${session.username}", style = MaterialTheme.typography.bodyMedium)
                }
                OutlinedButton(onClick = {
                    scope.launch {
                        attempt("Couldn't disconnect Instagram.", onMessage) { container.api().instagramLogout() }?.let {
                            onSession(it)
                            onMessage("Instagram disconnected")
                        }
                    }
                }) { Text("Disconnect") }
            }
            !form -> {
                Text(
                    "Not connected. Use a spare Instagram account rather than your personal one: Instagram can limit accounts that download a lot.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = { form = true }) { Text("Connect") }
            }
            else -> {
                when {
                    browser -> {
                        Text(
                            "1. On a computer, sign in at instagram.com with the account to use.\n2. Press F12, open Application (Chrome, Edge) or Storage (Firefox), then Cookies › https://www.instagram.com.\n3. Copy the Value of the row named sessionid and paste it here.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        PasswordField(sessionId, "sessionid") { sessionId = it; error = null }
                        Text("It works like a password for that Instagram account: paste it only here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    needsCode -> OutlinedTextField(
                        code, { code = it; error = null }, singleLine = true, label = { Text("Code from your authenticator app or SMS") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
                    )
                    else -> {
                        OutlinedTextField(username, { username = it; error = null }, singleLine = true, label = { Text("Instagram username") }, modifier = Modifier.fillMaxWidth())
                        PasswordField(password, "Password") { password = it; error = null }
                        Text("Used once to sign in. TeleStore keeps only Instagram's sign-in session, never the password.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                val ready = when {
                    browser -> sessionId.isNotBlank()
                    needsCode -> code.isNotBlank()
                    else -> username.isNotBlank() && password.isNotEmpty()
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = ready && !busy, onClick = {
                        scope.launch {
                            busy = true
                            val api = container.api()
                            attempt("Couldn't sign in to Instagram.", { error = it }) {
                                when {
                                    browser -> api.instagramBrowserSession(sessionId)
                                    needsCode -> api.instagramCode(code)
                                    else -> api.instagramLogin(username, password)
                                }
                            }?.let { reply ->
                                if (reply.needsCode) {
                                    needsCode = true
                                    password = ""
                                } else {
                                    onSession(reply)
                                    onMessage("Instagram connected as @${reply.username}")
                                    reset()
                                }
                            }
                            busy = false
                        }
                    }) { Text(if (busy) "Signing in…" else if (browser) "Connect" else if (needsCode) "Confirm code" else "Sign in") }
                    TextButton(onClick = { reset() }) { Text("Cancel") }
                }
                if (!needsCode) {
                    TextButton(onClick = { browser = !browser; error = null }, contentPadding = PaddingValues(0.dp)) {
                        Text(if (browser) "Sign in with username and password instead" else "Use my browser's sign-in")
                    }
                }
            }
        }
    }
}
