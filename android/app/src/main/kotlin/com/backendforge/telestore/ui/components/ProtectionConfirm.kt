package com.backendforge.telestore.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.ProtectionMethod
import com.backendforge.telestore.core.TeleStoreApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One "confirm to remove protection from [item]" question waiting for the user. */
class ProtectionAsk(val item: FileItem, val message: String, internal val answer: CompletableDeferred<String?>)

/**
 * Asks for the password (or an emailed code) before protection is removed from one item and hands
 * back the single-use unlock token for it. Nothing is kept: every removal asks again, and deleting
 * never asks (protected items can't be deleted at all). Lives in AppContainer
 * (`container.protection`); [ProtectionConfirmHost] in MainScreen shows the dialog.
 */
class ProtectionGate {
    private val _ask = MutableStateFlow<ProtectionAsk?>(null)
    val ask: StateFlow<ProtectionAsk?> = _ask.asStateFlow()

    private val mutex = Mutex()

    /** A fresh single-use token for removing protection from [item]; null when the user cancels. */
    suspend fun unlockFor(item: FileItem): String? = mutex.withLock {
        val request = ProtectionAsk(item, "Confirm it's you to remove protection from “${item.name}”. It can then be moved to the trash or deleted.", CompletableDeferred())
        _ask.value = request
        try {
            request.answer.await()
        } finally {
            if (_ask.value === request) _ask.value = null
        }
    }

    internal fun answer(ask: ProtectionAsk, token: String?) {
        ask.answer.complete(token)
        if (_ask.value === ask) _ask.value = null
    }

    /** Cancels a question still open (signing out). */
    fun clear() {
        _ask.value?.answer?.complete(null)
        _ask.value = null
    }
}

/** Shows the confirm dialog whenever [gate] asks. [onOpenAccount] opens Account (to set a password). */
@Composable
fun ProtectionConfirmHost(gate: ProtectionGate, api: () -> TeleStoreApi, onOpenAccount: () -> Unit) {
    val ask by gate.ask.collectAsStateWithLifecycle()
    val current = ask ?: return
    // A fresh dialog for each question
    androidx.compose.runtime.key(current) {
        ProtectionDialog(current, gate, api, onOpenAccount)
    }
}

@Composable
private fun ProtectionDialog(ask: ProtectionAsk, gate: ProtectionGate, api: () -> TeleStoreApi, onOpenAccount: () -> Unit) {
    val scope = rememberCoroutineScope()
    var method by remember { mutableStateOf<ProtectionMethod?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var secret by remember { mutableStateOf("") }
    var codeSent by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(ask) {
        try {
            method = api().protectionMethod()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = (e as? ApiException)?.message ?: "Couldn't reach the server."
        }
    }

    fun cancel() = gate.answer(ask, null)

    fun sendCode() {
        busy = true
        error = null
        scope.launch {
            try {
                api().sendProtectionCode()
                codeSent = true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = (e as? ApiException)?.message ?: "Couldn't send the code."
            } finally {
                busy = false
            }
        }
    }

    fun confirm() {
        val m = method ?: return
        busy = true
        error = null
        scope.launch {
            try {
                val reply = if (m.usesPassword) {
                    api().unlockProtection(ask.item, password = secret)
                } else {
                    api().unlockProtection(ask.item, code = secret)
                }
                gate.answer(ask, reply.unlockToken)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = (e as? ApiException)?.message ?: "Couldn't confirm. Try again."
            } finally {
                busy = false
            }
        }
    }

    val m = method
    val needsSetup = m != null && !m.usesPassword && !m.usesEmail
    val canConfirm = !busy && m != null && when {
        m.usesPassword -> secret.isNotEmpty()
        m.usesEmail -> codeSent && secret.trim().length == 6
        else -> false
    }

    AlertDialog(
        onDismissRequest = { if (!busy) cancel() },
        icon = { Icon(Icons.Filled.Shield, contentDescription = null) },
        title = { Text("Remove protection?") },
        text = {
            Column {
                Text(ask.message, style = MaterialTheme.typography.bodyMedium)
                when {
                    loadError != null -> Text(
                        loadError.orEmpty(),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    m == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp).size(24.dp))
                    m != null && m.usesPassword -> OutlinedTextField(
                        value = secret,
                        onValueChange = { secret = it },
                        label = { Text("Password") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                    m != null && m.usesEmail && !codeSent -> Text(
                        "We'll email a 6-digit code to ${m.emailHint ?: "your email"}.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    m != null && m.usesEmail -> OutlinedTextField(
                        value = secret,
                        onValueChange = { v -> secret = v.filter { it.isDigit() }.take(6) },
                        label = { Text("6-digit code") },
                        supportingText = { Text("Sent to ${m.emailHint ?: "your email"}") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                    else -> Text(
                        "To remove protection, first set a password for your account in Account.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                }
            }
        },
        confirmButton = {
            when {
                needsSetup -> TextButton(onClick = { cancel(); onOpenAccount() }) { Text("Open Account") }
                m != null && m.usesEmail && !codeSent -> TextButton(onClick = ::sendCode, enabled = !busy) {
                    Text("Send code to ${m.emailHint ?: "your email"}")
                }
                else -> TextButton(onClick = ::confirm, enabled = canConfirm) { Text("Confirm") }
            }
        },
        dismissButton = {
            TextButton(onClick = ::cancel, enabled = !busy) { Text("Cancel") }
        },
    )
}
