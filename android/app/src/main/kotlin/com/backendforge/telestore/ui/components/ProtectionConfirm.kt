package com.backendforge.telestore.ui.components

import android.os.SystemClock
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
import com.backendforge.telestore.core.ProtectedDelete
import com.backendforge.telestore.core.ProtectedException
import com.backendforge.telestore.core.ProtectedOutcome
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

/** One "confirm to delete protected items" question waiting for the user. */
class ProtectionAsk(val message: String, internal val answer: CompletableDeferred<String?>)

/**
 * Asks for the password (or an emailed code) before protected things are deleted, and keeps the
 * unlock token until it expires so a bulk delete asks once. Lives in AppContainer
 * (`container.protection`); [ProtectionConfirmHost] in MainScreen shows the dialog.
 */
class ProtectionGate {
    private val _ask = MutableStateFlow<ProtectionAsk?>(null)
    val ask: StateFlow<ProtectionAsk?> = _ask.asStateFlow()

    private val mutex = Mutex()
    private var token: String? = null
    private var expiresAt = 0L

    /** A token still valid for a while, else null. */
    fun cachedToken(): String? = token?.takeIf { SystemClock.elapsedRealtime() < expiresAt }

    /**
     * The unlock token: the cached one, or one the user confirms now; null when they cancel.
     * [message] is the server's words ("“Taxes” is protected…").
     */
    suspend fun unlock(message: String): String? = mutex.withLock {
        cachedToken()?.let { return@withLock it }
        val request = ProtectionAsk(message, CompletableDeferred())
        _ask.value = request
        try {
            request.answer.await()
        } finally {
            if (_ask.value === request) _ask.value = null
        }
    }

    /**
     * Runs [block] (with the cached token, if any); refused as protected, it asks once and runs it
     * again with the new token. Null when the user cancelled.
     */
    suspend fun <T> retrying(block: suspend (unlockToken: String?) -> T): T? {
        val cached = cachedToken()
        return try {
            block(cached)
        } catch (e: ProtectedException) {
            // The server no longer takes the kept token (restarted, or it expired there first)
            if (cached != null) forget(cached)
            val unlocked = unlock(e.message ?: "This is protected. Confirm to continue.") ?: return null
            block(unlocked)
        }
    }

    /** Deletes or trashes [items], asking at most once for the protected ones. */
    suspend fun <T> deleteAll(items: List<T>, action: suspend (item: T, unlockToken: String?) -> Unit): ProtectedOutcome<T> {
        val cached = cachedToken()
        return ProtectedDelete.run(
            items,
            token = cached,
            unlock = { message ->
                if (cached != null) forget(cached)
                unlock(message)
            },
            action = action,
        )
    }

    private fun forget(stale: String) {
        if (token == stale) {
            token = null
            expiresAt = 0L
        }
    }

    internal fun answer(ask: ProtectionAsk, token: String?, expiresInSeconds: Long) {
        if (token != null) {
            this.token = token
            // A little early, so a token never expires mid-request
            expiresAt = SystemClock.elapsedRealtime() + (expiresInSeconds - 10).coerceAtLeast(5) * 1000
        }
        ask.answer.complete(token)
        if (_ask.value === ask) _ask.value = null
    }

    /** Forgets the token (signing out). */
    fun clear() {
        token = null
        expiresAt = 0
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

    fun cancel() = gate.answer(ask, null, 0)

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
                val reply = if (m.usesPassword) api().unlockProtection(password = secret) else api().unlockProtection(code = secret)
                gate.answer(ask, reply.unlockToken, reply.expiresIn)
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
        title = { Text("Protected") },
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
                        "To delete protected items, first set a password for your account in Account.",
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

/** The snackbar line after deleting or trashing several items ("Moved to Trash 3 items", "Not deleted"…). */
fun protectedOutcomeMessage(outcome: ProtectedOutcome<*>, pastVerb: String): String {
    val done = outcome.done.size
    val kept = outcome.kept.size
    val failed = outcome.failed.size
    val error = outcome.firstError?.let { (it as? ApiException)?.message ?: it.message }
    val parts = mutableListOf<String>()
    if (done > 0 || (kept == 0 && failed == 0)) parts += "$pastVerb $done item${if (done != 1) "s" else ""}"
    if (kept > 0) parts += if (done == 0 && failed == 0) "Not deleted" else "$kept protected not deleted"
    if (failed > 0) parts += if (done == 0 && kept == 0) "Failed: $error" else "$failed failed: $error"
    return parts.joinToString(", ")
}
