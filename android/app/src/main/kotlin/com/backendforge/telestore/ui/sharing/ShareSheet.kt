package com.backendforge.telestore.ui.sharing

import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.ExpiryPreset
import com.backendforge.telestore.core.LinkSettings
import com.backendforge.telestore.core.ShareLink
import com.backendforge.telestore.core.ShareMember
import com.backendforge.telestore.core.ShareRole
import com.backendforge.telestore.core.ShareRules
import com.backendforge.telestore.core.ShareView
import com.backendforge.telestore.core.TeleStoreApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The Share sheet, like Google Drive's: add people as viewer or editor, change or remove them,
 * and "Anyone with the link" (view-only) with its download switch, expiry and download limit.
 * [onChanged] runs after anything changes (lists refresh their "Shared" marker).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheet(
    api: TeleStoreApi,
    itemId: String,
    itemName: String,
    onDismiss: () -> Unit,
    onChanged: () -> Unit = {},
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var view by remember { mutableStateOf<ShareView?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    var confirmStop by remember { mutableStateOf(false) }

    LaunchedEffect(itemId) {
        try {
            view = api.shareView(itemId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = (e as? ApiException)?.message ?: "Couldn't load sharing."
        }
    }

    /** Runs a change; the server's answer is the new state. Errors show the server's message. */
    fun change(done: String? = null, block: suspend () -> ShareView) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                view = block()
                onChanged()
                done?.let { toast(context, it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast(context, (e as? ApiException)?.message ?: "Couldn't save that. Try again.")
            } finally {
                busy = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
        ) {
            Text(
                "Share “$itemName”",
                style = MaterialTheme.typography.titleLarge,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Box(Modifier.fillMaxWidth().height(4.dp).padding(top = 2.dp)) {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            val v = view
            when {
                loadError != null -> Text(loadError!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 24.dp))
                v == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> {
                    AddPeople(enabled = !busy) { who, role ->
                        change("Shared with $who.") { api.addShareMember(itemId, who, role) }
                    }

                    SectionTitle("People with access")
                    if (v.members.isEmpty()) {
                        Text("Only you", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    v.members.forEach { member ->
                        MemberRow(
                            member = member,
                            enabled = !busy,
                            onRole = { role -> change { api.setShareMemberRole(itemId, member.userId, role) } },
                            onRemove = { change("Removed ${member.name.ifBlank { member.username }}.") { api.removeShareMember(itemId, member.userId) } },
                        )
                    }

                    HorizontalDivider(Modifier.padding(vertical = 16.dp))
                    SectionTitle("General access")
                    val link = v.link
                    val linkOn = ShareRules.linkOn(link)
                    AccessChoice(
                        selected = !linkOn,
                        icon = { Icon(Icons.Default.Lock, contentDescription = null) },
                        title = "Restricted",
                        detail = "Only people added can open",
                        enabled = !busy,
                    ) { if (linkOn) change("Link turned off.") { api.setShareLink(itemId, LinkSettings(enabled = false)) } }
                    AccessChoice(
                        selected = linkOn,
                        icon = { Icon(Icons.Default.Public, contentDescription = null) },
                        title = "Anyone with the link",
                        detail = "Anyone with the link can view",
                        enabled = !busy,
                    ) { if (!linkOn) change("Link turned on.") { api.setShareLink(itemId, LinkSettings(enabled = true)) } }

                    if (linkOn && link != null) {
                        LinkControls(
                            link = link,
                            url = ShareRules.linkUrl(api.baseUrl.toString(), link.token),
                            enabled = !busy,
                            onAllowDownload = { on -> change { api.setShareLink(itemId, LinkSettings(enabled = true, allowDownload = on)) } },
                            onExpiry = { preset -> change("Expiry saved.") { api.setShareLink(itemId, ShareRules.expirySettings(preset)) } },
                            onLimit = { max -> change("Download limit saved.") { api.setShareLink(itemId, ShareRules.limitSettings(max)) } },
                            onCopy = { url ->
                                clipboard.setText(AnnotatedString(url))
                                toast(context, "Link copied.")
                            },
                            onSend = { url -> sendLink(context, itemName, url) },
                            onReset = { confirmReset = true },
                        )
                    }

                    if (v.shareId != null && (v.members.isNotEmpty() || linkOn)) {
                        HorizontalDivider(Modifier.padding(vertical = 16.dp))
                        TextButton(onClick = { confirmStop = true }, enabled = !busy) {
                            Text("Stop sharing", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Reset link?") },
            text = { Text("The current link stops working. Anyone who needs it gets the new one from you.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmReset = false
                    change("New link made.") { api.resetShareLink(itemId) }
                }) { Text("Reset") }
            },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Cancel") } },
        )
    }
    if (confirmStop) {
        AlertDialog(
            onDismissRequest = { confirmStop = false },
            title = { Text("Stop sharing?") },
            text = { Text("Everyone you added loses access and the link stops working.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmStop = false
                    change("Stopped sharing.") { api.stopSharing(itemId) }
                }) { Text("Stop sharing", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp, bottom = 8.dp),
    )
}

/** Username or email, the role, and Add. */
@Composable
private fun AddPeople(enabled: Boolean, onAdd: (String, ShareRole) -> Unit) {
    var who by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(ShareRole.VIEWER) }
    fun submit() {
        val text = who.trim()
        if (text.isEmpty()) return
        onAdd(text, role)
        who = ""
    }
    Column(Modifier.padding(top = 12.dp)) {
        OutlinedTextField(
            value = who,
            onValueChange = { who = it },
            label = { Text("Add people") },
            placeholder = { Text("Username or email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            RolePicker(role = role, enabled = enabled, onRole = { role = it })
            Spacer(Modifier.weight(1f))
            Button(onClick = ::submit, enabled = enabled && who.isNotBlank()) { Text("Add") }
        }
    }
}

/** "Viewer ▾" with Viewer / Editor, and Remove when [onRemove] is given. */
@Composable
private fun RolePicker(role: ShareRole, enabled: Boolean, onRole: (ShareRole) -> Unit, onRemove: (() -> Unit)? = null) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }, enabled = enabled) {
            Text(role.label)
            Icon(Icons.Default.ArrowDropDown, contentDescription = "Change role")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            ShareRole.entries.forEach { r ->
                DropdownMenuItem(
                    text = { Text(if (r == ShareRole.VIEWER) "Viewer (can view)" else "Editor (can change)") },
                    onClick = { open = false; if (r != role) onRole(r) },
                )
            }
            if (onRemove != null) {
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("Remove access", color = MaterialTheme.colorScheme.error) },
                    onClick = { open = false; onRemove() },
                )
            }
        }
    }
}

@Composable
private fun MemberRow(member: ShareMember, enabled: Boolean, onRole: (ShareRole) -> Unit, onRemove: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Icon(Icons.Default.AccountCircle, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(36.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(member.name.ifBlank { member.username }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                member.email?.takeIf { it.isNotBlank() } ?: member.username,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        RolePicker(role = member.shareRole, enabled = enabled, onRole = onRole, onRemove = onRemove)
    }
}

@Composable
private fun AccessChoice(
    selected: Boolean,
    icon: @Composable () -> Unit,
    title: String,
    detail: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 6.dp),
    ) {
        RadioButton(selected = selected, onClick = onClick, enabled = enabled)
        Spacer(Modifier.width(4.dp))
        icon()
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LinkControls(
    link: ShareLink,
    url: String,
    enabled: Boolean,
    onAllowDownload: (Boolean) -> Unit,
    onExpiry: (ExpiryPreset) -> Unit,
    onLimit: (Int?) -> Unit,
    onCopy: (String) -> Unit,
    onSend: (String) -> Unit,
    onReset: () -> Unit,
) {
    Column(Modifier.padding(start = 8.dp, top = 8.dp)) {
        if (link.state == "expired" || link.state == "used_up") {
            Text(ShareRules.linkStateText(link), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
        }
        Text(url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            Button(onClick = { onCopy(url) }, enabled = enabled) {
                Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Copy link")
            }
            OutlinedButton(onClick = { onSend(url) }, enabled = enabled) {
                Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Share")
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Viewers can download", style = MaterialTheme.typography.bodyLarge)
                Text(
                    if (link.allowDownload) "They can view and save the files" else "They can only view",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = link.allowDownload, onCheckedChange = onAllowDownload, enabled = enabled)
        }

        Text("Link expires", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 12.dp))
        Text(ShareRules.expiryText(link.expiresAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        // The server keeps only the date, so the preset picked is remembered while the sheet is
        // open (reopened later, the text above still says when the link ends)
        var picked by remember(link.token) { mutableStateOf<ExpiryPreset?>(null) }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp).horizontalScroll(rememberScrollState())) {
            ExpiryPreset.entries.forEach { preset ->
                FilterChip(
                    selected = if (link.expiresAt == null) preset == ExpiryPreset.NEVER else preset == picked && preset != ExpiryPreset.NEVER,
                    onClick = {
                        picked = preset
                        onExpiry(preset)
                    },
                    label = { Text(preset.label) },
                    enabled = enabled,
                )
            }
        }

        var limit by remember(link.maxDownloads) { mutableStateOf(link.maxDownloads?.toString().orEmpty()) }
        Text("Download limit", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 12.dp))
        Text(ShareRules.downloadsText(link), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            OutlinedTextField(
                value = limit,
                onValueChange = { limit = it.filter(Char::isDigit).take(6) },
                placeholder = { Text("No limit") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onLimit(limit.toIntOrNull()) }),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            TextButton(
                onClick = { onLimit(limit.toIntOrNull()) },
                enabled = enabled && limit != link.maxDownloads?.toString().orEmpty(),
            ) { Text("Save") }
        }

        TextButton(onClick = onReset, enabled = enabled, modifier = Modifier.padding(top = 8.dp)) {
            Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Reset link")
        }
    }
}

private fun toast(context: Context, text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

/** Android's share sheet with the link as text. */
private fun sendLink(context: Context, name: String, url: String) {
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_SUBJECT, name)
        .putExtra(Intent.EXTRA_TEXT, url)
    runCatching { context.startActivity(Intent.createChooser(send, "Share link")) }
}
