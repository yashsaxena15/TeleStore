package com.backendforge.telestore.ui.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.MIN_PASSWORD
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.ui.settings.PasswordField
import com.backendforge.telestore.ui.settings.attempt
import kotlinx.coroutines.launch

/**
 * "Forgot password?": username, then a 6-digit code emailed to the account's address, then a new
 * password. Accounts without an email (or Google ones) ask the owner, who sets one in Users.
 */
@Composable
fun ForgotPasswordDialog(api: TeleStoreApi?, initialUsername: String, onDismiss: () -> Unit, onDone: (username: String) -> Unit) {
    val scope = rememberCoroutineScope()
    var askCode by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf(initialUsername) }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var repeat by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Reset your password") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!askCode) {
                    Text("We'll email a 6-digit code to the address on your account.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(username, { username = it; error = null }, singleLine = true, label = { Text("Username") }, modifier = Modifier.fillMaxWidth())
                    Text(
                        "No email on your account, or signing in with Google? Ask the owner to set a new password for you.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    OutlinedTextField(
                        code, { code = it.filter(Char::isDigit).take(6); error = null }, singleLine = true, label = { Text("Code from the email") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
                    )
                    PasswordField(password, "New password") { password = it; error = null }
                    PasswordField(repeat, "Repeat new password") { repeat = it; error = null }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            if (!askCode) {
                TextButton(enabled = !busy && username.isNotBlank(), onClick = {
                    val server = api
                    if (server == null) {
                        error = "Enter the server address first."
                        return@TextButton
                    }
                    scope.launch {
                        busy = true
                        attempt("Couldn't send the code.", { error = it }) { server.forgotPassword(username) }?.let {
                            notice = it.message
                            askCode = true
                        }
                        busy = false
                    }
                }) { Text(if (busy) "Sending…" else "Send code") }
            } else {
                TextButton(enabled = !busy && code.length == 6 && password.isNotEmpty(), onClick = {
                    when {
                        password.length < MIN_PASSWORD -> error = "Use a password of at least $MIN_PASSWORD characters."
                        password != repeat -> error = "The new passwords don't match."
                        else -> {
                            val server = api ?: return@TextButton
                            scope.launch {
                                busy = true
                                attempt("Couldn't reset the password.", { error = it }) { server.resetPassword(username, code, password) }?.let {
                                    onDone(username.trim())
                                    onDismiss()
                                }
                                busy = false
                            }
                        }
                    }
                }) { Text(if (busy) "Saving…" else "Set new password") }
            }
        },
        dismissButton = {
            TextButton(onClick = { if (askCode) { askCode = false; error = null } else onDismiss() }) { Text(if (askCode) "Back" else "Cancel") }
        },
    )
}
