package com.backendforge.telestore.ui.vault

import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.backendforge.telestore.ui.components.rememberHaptics
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FolderPaths
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.core.VaultPin
import com.backendforge.telestore.core.VaultStatus
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.player.findActivity
import com.backendforge.telestore.ui.components.FileInfoSheet
import com.backendforge.telestore.ui.components.FileRow
import com.backendforge.telestore.ui.components.NewFolderDialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class VaultStep { LOADING, SETUP_EMAIL, SETUP_CODE, SETUP_PIN, SETUP_CONFIRM, LOCKED, FORGOT_CODE, FORGOT_PIN, OPEN }

data class VaultState(
    val step: VaultStep = VaultStep.LOADING,
    val status: VaultStatus? = null,
    val email: String = "",
    val code: String = "",
    val firstPin: String = "",
    val path: String = TeleStoreApi.VAULT,
    val items: List<FileItem> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

/** The Private Vault: set up with an email and a PIN, opened with the PIN, locked when the app is left. */
class VaultViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(VaultState())
    val state: StateFlow<VaultState> = _state.asStateFlow()
    private val api get() = container.api()

    init {
        reload()
    }

    fun reload() = act {
        val status = api.vaultStatus()
        _state.update { it.copy(status = status, step = if (!status.isSetup) VaultStep.SETUP_EMAIL else if (status.isUnlocked) VaultStep.OPEN else VaultStep.LOCKED) }
        if (status.isUnlocked) load()
    }

    fun setEmail(v: String) = _state.update { it.copy(email = v, error = null) }
    fun setCode(v: String) = _state.update { it.copy(code = v.filter(Char::isDigit).take(6), error = null) }
    fun dismissMessage() = _state.update { it.copy(message = null) }

    // ── Setup ──────────────────────────────────────────────────────────────────
    fun sendSetupCode() = act {
        api.vaultSetupCode(_state.value.email)
        _state.update { it.copy(step = VaultStep.SETUP_CODE, message = "We sent a 6-digit code to ${it.email}.") }
    }

    fun checkSetupCode() = act {
        api.vaultCheckCode(_state.value.code, _state.value.email)
        _state.update { it.copy(step = VaultStep.SETUP_PIN) }
    }

    fun pinEntered(pin: String) {
        val s = _state.value
        when (s.step) {
            VaultStep.SETUP_PIN -> _state.update { it.copy(firstPin = pin, step = VaultStep.SETUP_CONFIRM, error = null) }
            VaultStep.SETUP_CONFIRM ->
                if (pin != s.firstPin) _state.update { it.copy(step = VaultStep.SETUP_PIN, firstPin = "", error = "The PINs didn't match. Choose your PIN again.") }
                else act {
                    api.vaultCreate(s.email, s.code, pin)
                    _state.update { it.copy(message = "Your Private Vault is ready.") }
                    reload()
                }
            VaultStep.LOCKED -> act {
                api.vaultUnlock(pin)
                reload()
            }
            VaultStep.FORGOT_PIN -> act {
                api.vaultResetPin(s.code, pin)
                _state.update { it.copy(message = "PIN changed. Your files are safe.", code = "") }
                reload()
            }
            else -> {}
        }
    }

    // ── Forgot PIN ─────────────────────────────────────────────────────────────
    fun forgotPin() = act {
        api.vaultForgotCode()
        _state.update { it.copy(step = VaultStep.FORGOT_CODE, code = "", message = "We sent a code to ${it.status?.email ?: "your recovery email"}.") }
    }

    fun forgotCodeEntered() = _state.update { it.copy(step = VaultStep.FORGOT_PIN, error = null) }
    fun cancelForgot() = _state.update { it.copy(step = VaultStep.LOCKED, code = "", error = null) }

    // ── Open vault ─────────────────────────────────────────────────────────────
    fun open(folder: FileItem) {
        _state.update { it.copy(path = FolderPaths.childPath(folder)) }
        act { load() }
    }

    /** Back inside the vault; false at its top. */
    fun up(): Boolean {
        val path = _state.value.path.trimEnd('/')
        if (path == TeleStoreApi.VAULT) return false
        _state.update { it.copy(path = path.substringBeforeLast('/')) }
        act { load() }
        return true
    }

    private suspend fun load() {
        val page = api.listFiles(path = _state.value.path, pageSize = 500)
        _state.update { it.copy(items = page.files, step = VaultStep.OPEN) }
    }

    fun lock() = act {
        runCatching { api.vaultLock() }
        _state.update { it.copy(step = VaultStep.LOCKED, items = emptyList(), path = TeleStoreApi.VAULT) }
    }

    /** The app was left: lock now (the server would also lock it after the auto-lock time). */
    fun lockQuietly() {
        if (_state.value.step != VaultStep.OPEN) return
        _state.update { it.copy(step = VaultStep.LOCKED, items = emptyList(), path = TeleStoreApi.VAULT) }
        container.lockVaultInBackground()
    }

    fun createFolder(name: String) = act {
        api.createVaultFolder(name, _state.value.path)
        load()
    }

    fun moveOut(item: FileItem) = act {
        api.moveOutOfVault(item, TeleStoreApi.HOME)
        _state.update { it.copy(message = "Moved ${item.name} to Home.") }
        load()
    }

    fun changePin(current: String, new: String) = act {
        api.vaultChangePin(current, new)
        _state.update { it.copy(message = "PIN changed.") }
    }

    /** Recovery email changed: show the new (partly hidden) address. */
    fun recoveryEmailChanged() = act {
        val status = api.vaultStatus()
        _state.update { it.copy(status = status, message = "Recovery email changed.") }
    }

    fun setAutoLock(minutes: Int) = act {
        api.vaultAutoLock(minutes)
        _state.update { it.copy(status = it.status?.copy(autoLockMinutes = minutes), message = "Locks after $minutes minutes without use.") }
    }

    private fun act(block: suspend () -> Unit) {
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? ApiException)?.message ?: "Something went wrong: ${e.message}"
                // The server locked it (time ran out): ask for the PIN again
                if ((e as? ApiException)?.status == 403) _state.update { it.copy(step = VaultStep.LOCKED, items = emptyList()) }
                _state.update { it.copy(error = msg) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultScreen(
    vm: VaultViewModel,
    container: AppContainer,
    onBack: () -> Unit,
    onOpenFile: (FileItem, List<FileItem>) -> Boolean,
    onDownload: (FileItem) -> Unit,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    val lifecycle = LocalLifecycleOwner.current
    var menu by remember { mutableStateOf<FileItem?>(null) }
    var info by remember { mutableStateOf<FileItem?>(null) }
    var newFolder by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(false) }
    var recoveryEmail by remember { mutableStateOf(false) }

    // No screenshots, and a blank preview in Recents, while the vault is on screen; lock when the app is left
    DisposableEffect(activity, lifecycle) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) vm.lockQuietly() }
        lifecycle.lifecycle.addObserver(observer)
        onDispose {
            lifecycle.lifecycle.removeObserver(observer)
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    val inSubfolder = state.step == VaultStep.OPEN && state.path.trimEnd('/') != TeleStoreApi.VAULT
    androidx.activity.compose.BackHandler(enabled = inSubfolder) { vm.up() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (inSubfolder) state.path.substringAfterLast('/') else "Private Vault") },
                navigationIcon = { IconButton(onClick = { if (!vm.up()) onBack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (state.step == VaultStep.OPEN) {
                        IconButton(onClick = { newFolder = true }) { Icon(Icons.Filled.CreateNewFolder, contentDescription = "New folder") }
                        IconButton(onClick = { settings = true }) { Icon(Icons.Filled.Settings, contentDescription = "Vault settings") }
                        IconButton(onClick = vm::lock) { Icon(Icons.Filled.Lock, contentDescription = "Lock now") }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (state.step) {
                VaultStep.LOADING -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                VaultStep.SETUP_EMAIL -> Form(
                    title = "Set up your Private Vault",
                    text = "Files in the vault are hidden from Home, search and WebDAV, and open only with your PIN. First, an email to recover the PIN if you forget it.",
                    error = state.error, busy = state.busy,
                ) {
                    OutlinedTextField(state.email, vm::setEmail, label = { Text("Recovery email") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                    Button(onClick = vm::sendSetupCode, enabled = state.email.contains('@') && !state.busy, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("Send code") }
                }
                VaultStep.SETUP_CODE, VaultStep.FORGOT_CODE -> Form(
                    title = "Enter the code",
                    text = state.message ?: "Check your email for a 6-digit code.",
                    error = state.error, busy = state.busy,
                ) {
                    OutlinedTextField(state.code, vm::setCode, label = { Text("6-digit code") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
                    Button(
                        onClick = { if (state.step == VaultStep.SETUP_CODE) vm.checkSetupCode() else vm.forgotCodeEntered() },
                        enabled = state.code.length == 6 && !state.busy, modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    ) { Text("Continue") }
                    if (state.step == VaultStep.FORGOT_CODE) TextButton(onClick = vm::cancelForgot) { Text("Cancel") }
                }
                VaultStep.SETUP_PIN -> PinPad("Choose a 4-digit PIN", state.error, state.busy, onPin = vm::pinEntered)
                VaultStep.SETUP_CONFIRM -> PinPad("Enter the PIN again", state.error, state.busy, onPin = vm::pinEntered)
                VaultStep.FORGOT_PIN -> PinPad("Choose a new PIN", state.error, state.busy, onPin = vm::pinEntered)
                VaultStep.LOCKED -> PinPad("Enter your vault PIN", state.error, state.busy, onPin = vm::pinEntered, extra = {
                    TextButton(onClick = vm::forgotPin, enabled = !state.busy) { Text("Forgot PIN?") }
                })
                VaultStep.OPEN -> if (state.items.isEmpty()) {
                    Text(
                        "The vault is empty. Use \"Move to Private Vault\" in any file's menu to put it here.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                    )
                } else {
                    val api = container.api()
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                        items(state.items, key = { it.id }) { item ->
                            FileRow(
                                item = item, api = api, isSelectionMode = false, isSelected = false, onToggleSelect = {},
                                onClick = { if (item.isFolder) vm.open(item) else if (!onOpenFile(item, state.items)) info = item },
                                onLongClick = { menu = item }, onOpenActions = { menu = item },
                            )
                        }
                    }
                }
            }
        }
    }

    LaunchedEffect(state.message) {
        if (state.message != null && state.step == VaultStep.OPEN) {
            kotlinx.coroutines.delay(2500)
            vm.dismissMessage()
        }
    }

    menu?.let { item ->
        ModalBottomSheet(onDismissRequest = { menu = null }) {
            Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                Text(item.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                SheetAction("Move out of the vault (to Home)") { menu = null; vm.moveOut(item) }
                if (!item.isFolder) SheetAction("Download to phone") { menu = null; onDownload(item) }
                SheetAction("Info") { menu = null; info = item }
            }
        }
    }
    info?.let { FileInfoSheet(item = it, api = container.api(), onDismiss = { info = null }) }
    if (newFolder) NewFolderDialog(onDismiss = { newFolder = false }, onConfirm = { newFolder = false; vm.createFolder(it) })
    if (settings) VaultSettingsDialog(
        state.status, onAutoLock = vm::setAutoLock, onChangePin = vm::changePin,
        onRecoveryEmail = { settings = false; recoveryEmail = true }, onDismiss = { settings = false },
    )
    if (recoveryEmail) RecoveryEmailDialog(container, state.status?.email, onDismiss = { recoveryEmail = false }, onChanged = vm::recoveryEmailChanged)
}

@Composable
private fun SheetAction(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Text(label, modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun Form(title: String, text: String, error: String?, busy: Boolean, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Filled.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(40.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
        if (busy) CircularProgressIndicator(Modifier.size(24.dp))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

/** Four dots and a number pad; [onPin] gets the PIN when the fourth digit is typed. */
@Composable
private fun PinPad(title: String, error: String?, busy: Boolean, onPin: (String) -> Unit, extra: @Composable () -> Unit = {}) {
    var pin by remember(title) { mutableStateOf("") }
    val haptics = rememberHaptics()
    LaunchedEffect(error) {
        if (error != null) {
            haptics.reject()
            pin = ""
        }
    }
    fun press(d: String) {
        if (busy || pin.length >= 4) return
        haptics.click()
        pin += d
        if (VaultPin.isValid(pin)) onPin(pin)
    }
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(24.dp))
        Icon(Icons.Filled.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(40.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
        Row(Modifier.padding(vertical = 24.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            repeat(4) { i ->
                Box(Modifier.size(16.dp).background(if (i < pin.length) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant, CircleShape))
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 8.dp)) }
        if (busy) CircularProgressIndicator(Modifier.size(24.dp))
        Spacer(Modifier.weight(1f))
        listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("", "0", "<")).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.padding(vertical = 8.dp)) {
                row.forEach { key ->
                    when (key) {
                        "" -> Spacer(Modifier.size(72.dp))
                        "<" -> IconButton(onClick = { haptics.click(); pin = pin.dropLast(1) }, modifier = Modifier.size(72.dp)) {
                            Icon(Icons.AutoMirrored.Filled.Backspace, contentDescription = "Delete")
                        }
                        else -> FilledTonalButton(onClick = { press(key) }, shape = CircleShape, modifier = Modifier.size(72.dp)) {
                            Text(key, fontSize = 24.sp)
                        }
                    }
                }
            }
        }
        extra()
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun VaultSettingsDialog(
    status: VaultStatus?,
    onAutoLock: (Int) -> Unit,
    onChangePin: (String, String) -> Unit,
    onRecoveryEmail: () -> Unit,
    onDismiss: () -> Unit,
) {
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Vault settings") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Lock after no use for", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(5, 15, 30, 60).forEach { m ->
                        FilterChip(selected = status?.autoLockMinutes == m, onClick = { onAutoLock(m) }, label = { Text("$m min") })
                    }
                }
                Text("It also locks as soon as you leave the app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Change PIN", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
                OutlinedTextField(current, { current = it.filter(Char::isDigit).take(4) }, label = { Text("Current PIN") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                OutlinedTextField(new, { new = it.filter(Char::isDigit).take(4) }, label = { Text("New PIN") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                Text("Recovery email", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
                Text(status?.email ?: "Not set", style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = onRecoveryEmail, contentPadding = PaddingValues(0.dp)) { Text("Change recovery email") }
            }
        },
        confirmButton = {
            TextButton(onClick = { onChangePin(current, new); onDismiss() }, enabled = VaultPin.isValid(current) && VaultPin.isValid(new)) { Text("Change PIN") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

/** New recovery email: your PIN and the new address, then the code sent there. */
@Composable
private fun RecoveryEmailDialog(container: AppContainer, current: String?, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var askCode by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Change recovery email") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!askCode) {
                    Text("Forgot-PIN codes go to this address. Now: ${current ?: "not set"}.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(email, { email = it; error = null }, label = { Text("New email") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(pin, { pin = it.filter(Char::isDigit).take(4); error = null }, label = { Text("Vault PIN") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
                } else {
                    Text(notice ?: "Enter the 6-digit code we sent to $email.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6); error = null }, label = { Text("6-digit code") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && if (askCode) code.length == 6 else email.contains('@') && VaultPin.isValid(pin),
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            if (!askCode) {
                                notice = container.api().vaultRecoveryCode(email, pin).message
                                askCode = true
                            } else {
                                container.api().vaultRecoveryConfirm(email, pin, code)
                                onChanged()
                                onDismiss()
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = (e as? ApiException)?.message ?: "Couldn't change the recovery email."
                        }
                        busy = false
                    }
                },
            ) { Text(if (busy) "Please wait…" else if (askCode) "Confirm" else "Send code") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
