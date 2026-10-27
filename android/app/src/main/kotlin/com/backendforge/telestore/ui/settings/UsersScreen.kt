package com.backendforge.telestore.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.MIN_PASSWORD
import com.backendforge.telestore.core.ManagedUser
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.ConfirmDialog
import kotlinx.coroutines.launch

/** The owner's list of people: each has their own private library; nobody sees anyone else's files. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsersScreen(container: AppContainer, myUsername: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var users by remember { mutableStateOf<List<ManagedUser>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var emailFor by remember { mutableStateOf<ManagedUser?>(null) }
    var passwordFor by remember { mutableStateOf<ManagedUser?>(null) }
    var removing by remember { mutableStateOf<ManagedUser?>(null) }
    fun say(text: String) = scope.launch { snackbar.showSnackbar(text) }

    LaunchedEffect(Unit) {
        attempt("Couldn't load users.", { error = it }) { container.api().users() }?.let { users = it.users }
    }

    /** Shows the change at once and puts it back if the server refuses. */
    fun change(user: ManagedUser, patch: ManagedUser, done: String, call: suspend () -> Unit) {
        val before = users
        users = users?.map { if (it.id == user.id) patch else it }
        scope.launch {
            var failed = false
            attempt("Couldn't update ${user.name}.", { failed = true; users = before; say(it) }) { call() }
            if (!failed) say(done)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Users") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { adding = true }, icon = { Icon(Icons.Filled.PersonAdd, contentDescription = null) }, text = { Text("Add user") })
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val list = users
        when {
            list == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(24.dp)) } ?: CircularProgressIndicator()
            }
            else -> LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Text(
                        "Each person has their own private library; nobody sees anyone else's files.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (list.isEmpty()) item { Text("No users yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(list, key = { it.id }) { user ->
                    UserCard(
                        user = user,
                        isMe = user.username == myUsername,
                        onActive = { on ->
                            change(user, user.copy(active = on), if (on) "${user.name} can sign in again" else "${user.name} is turned off") {
                                container.api().updateUser(user.id, active = on)
                            }
                        },
                        onUpload = { on ->
                            change(user, user.copy(canUpload = on), if (on) "Uploads turned on for ${user.name}" else "Uploads turned off for ${user.name}") {
                                container.api().updateUser(user.id, canUpload = on)
                            }
                        },
                        onEmail = { emailFor = user },
                        onPassword = { passwordFor = user },
                        onRemove = { removing = user },
                    )
                }
            }
        }
    }

    if (adding) AddUserDialog(container, onDismiss = { adding = false }) { added ->
        users = users.orEmpty() + added
        say("${added.name} added")
    }

    emailFor?.let { user ->
        var email by remember(user.id) { mutableStateOf(user.email.orEmpty()) }
        AlertDialog(
            onDismissRequest = { emailFor = null },
            title = { Text("Email for ${user.name}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Google sign-in users sign in with this address.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(email, { email = it }, singleLine = true, label = { Text("Email") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(enabled = email.isNotBlank() && email.trim() != user.email, onClick = {
                    emailFor = null
                    val next = email.trim()
                    change(user, user.copy(email = next), "Email updated") { container.api().updateUser(user.id, email = next) }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { emailFor = null }) { Text("Cancel") } },
        )
    }

    passwordFor?.let { user ->
        val isSelf = user.username == myUsername
        PasswordDialog(
            title = if (isSelf) "Change your password" else "New password for ${user.name}",
            text = if (isSelf) "Enter your current password, then the new one." else "Use this when they've forgotten theirs. Tell them the new password; they can change it in their Account.",
            askCurrent = isSelf,
            onDismiss = { passwordFor = null },
        ) { current, new ->
            var problem: String? = null
            attempt("Couldn't change the password.", { problem = it }) { container.api().changePassword(user.id, if (isSelf) current else "", new) }
            if (problem == null) say(if (isSelf) "Password changed" else "New password set for ${user.name}. Let them know it.")
            problem
        }
    }

    removing?.let { user ->
        ConfirmDialog(
            title = "Remove ${user.name}?",
            message = "They can no longer sign in. Files they uploaded stay where they are.",
            confirmText = "Remove",
            isDestructive = true,
            onDismiss = { removing = null },
            onConfirm = {
                removing = null
                scope.launch {
                    attempt("Couldn't remove ${user.name}.", { say(it) }) { container.api().removeUser(user.id) }?.let {
                        users = users?.filter { it.id != user.id }
                        say("${user.name} removed")
                    }
                }
            },
        )
    }
}

@Composable
private fun UserCard(
    user: ManagedUser,
    isMe: Boolean,
    onActive: (Boolean) -> Unit,
    onUpload: (Boolean) -> Unit,
    onEmail: () -> Unit,
    onPassword: () -> Unit,
    onRemove: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 8.dp, end = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(user.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        StatusPill(if (user.isGoogle) "Google" else "Password", good = null)
                    }
                    if (!user.email.isNullOrBlank() && user.email != user.name) {
                        Text(user.email.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(
                        user.setup + (user.telegramUsername?.let { " · @$it" } ?: ""),
                        style = MaterialTheme.typography.labelMedium,
                        color = if (user.ready) Color(0xFF16A34A) else Color(0xFFD97706),
                    )
                }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "Actions for ${user.name}") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Change email") }, leadingIcon = { Icon(Icons.Filled.Email, null) }, onClick = { menu = false; onEmail() })
                        if (!user.isGoogle) {
                            DropdownMenuItem(
                                text = { Text(if (isMe) "Change password" else "Set a new password") },
                                leadingIcon = { Icon(Icons.Filled.Key, null) },
                                onClick = { menu = false; onPassword() },
                            )
                        }
                        if (user.username != "admin") {
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("Remove user", color = MaterialTheme.colorScheme.error) },
                                leadingIcon = { Icon(Icons.Filled.Delete, null, tint = MaterialTheme.colorScheme.error) },
                                onClick = { menu = false; onRemove() },
                            )
                        }
                    }
                }
            }
            SwitchLine("Active", if (user.locked) "The owner account can't be turned off" else "Turned-off accounts can't sign in. Their files are kept.", user.active, !user.locked, onActive)
            SwitchLine("Can upload", if (user.locked) "The owner account can always upload" else "Uploads, leeches, Drive transfers and compressing", user.canUpload, !user.locked, onUpload)
        }
    }
}

@Composable
private fun SwitchLine(label: String, detail: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(end = 12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

/** A password account (username, email, password) or a Google one (email only). */
@Composable
private fun AddUserDialog(container: AppContainer, onDismiss: () -> Unit, onAdded: (ManagedUser) -> Unit) {
    val scope = rememberCoroutineScope()
    var google by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var canUpload by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val valid = email.isNotBlank() && (google || (username.isNotBlank() && password.isNotEmpty()))

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add user") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "They get their own private library, empty to start. To upload, they connect Telegram and add the bot to their own group once they sign in.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !google, onClick = { google = false; error = null }, label = { Text("Username & password") })
                    FilterChip(selected = google, onClick = { google = true; error = null }, label = { Text("Google") })
                }
                if (!google) OutlinedTextField(username, { username = it; error = null }, singleLine = true, label = { Text("Username") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    email, { email = it; error = null }, singleLine = true, label = { Text("Email") },
                    supportingText = if (google) ({ Text("They sign in with this Google account.") }) else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth(),
                )
                if (!google) PasswordField(password, "Password") { password = it; error = null }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Can upload", style = MaterialTheme.typography.bodyMedium)
                        Text("Uses your bots and bandwidth.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = canUpload, onCheckedChange = { canUpload = it })
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = valid && !busy, onClick = {
                if (!google && password.length < MIN_PASSWORD) {
                    error = "Use a password of at least $MIN_PASSWORD characters."
                    return@TextButton
                }
                scope.launch {
                    busy = true
                    attempt("Couldn't add the user.", { error = it }) {
                        if (google) container.api().addUser(email, canUpload) else container.api().addUser(email, canUpload, username, password)
                    }?.let {
                        onAdded(it)
                        onDismiss()
                    }
                    busy = false
                }
            }) { Text(if (busy) "Adding…" else "Add user") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
