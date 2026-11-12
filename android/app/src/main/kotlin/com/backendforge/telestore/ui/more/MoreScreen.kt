package com.backendforge.telestore.ui.more

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.automirrored.filled.ArrowForwardIos
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Lan
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.FolderShared
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Group
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DividerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.Session
import com.backendforge.telestore.ui.components.ConfirmDialog
import kotlinx.coroutines.launch
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.ui.text.style.TextOverflow
import com.backendforge.telestore.ui.components.AppTopBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreScreen(
    container: AppContainer,
    session: Session,
    onNavigateTrash: () -> Unit,
    onNavigateInbox: () -> Unit,
    onNavigateStarred: () -> Unit = {},
    onNavigatePlaylists: () -> Unit = {},
    onNavigateNotifications: () -> Unit = {},
    onNavigateOffline: () -> Unit = {},
    onNavigateRecent: () -> Unit = {},
    onNavigateVault: () -> Unit = {},
    onNavigateDrive: () -> Unit = {},
    onNavigateWebDav: () -> Unit = {},
    onNavigateAccount: () -> Unit = {},
    onNavigateDownloads: () -> Unit = {},
    onNavigateTelegram: () -> Unit = {},
    onNavigateUsers: () -> Unit = {},
    onNavigateSharedWithMe: () -> Unit = {},
    onNavigateSharedByMe: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var showSignOutConfirm by remember { mutableStateOf(false) }
    // Users is for the owner only
    var isOwner by remember { mutableStateOf(false) }
    LaunchedEffect(session.token) { isOwner = runCatching { container.api().isOwner() }.getOrDefault(false) }

    val unread by container.unreadNotifications.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = { AppTopBar(title = "More") },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp),
        ) {
            // Who's signed in, and to which server (opens Account)
            Card(
                onClick = onNavigateAccount,
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Icon(
                        imageVector = Icons.Default.AccountCircle,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(36.dp),
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = session.username,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Dns,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(14.dp),
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = session.server,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowForwardIos,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }

            StorageSection(container)

            SectionLabel("Your files")
            NavGroup {
                MoreNavRow(icon = Icons.Default.FolderShared, label = "Shared with me", onClick = onNavigateSharedWithMe)
                MoreNavRow(icon = Icons.Default.People, label = "Shared by me", onClick = onNavigateSharedByMe)
                MoreNavRow(icon = Icons.Default.Star, label = "Starred", onClick = onNavigateStarred)
                MoreNavRow(icon = Icons.Default.Schedule, label = "Recent", onClick = onNavigateRecent)
                MoreNavRow(icon = Icons.Default.CloudDone, label = "Offline files", onClick = onNavigateOffline)
                MoreNavRow(icon = Icons.AutoMirrored.Filled.QueueMusic, label = "Playlists", onClick = onNavigatePlaylists)
                MoreNavRow(icon = Icons.Default.Inbox, label = "Telegram Inbox", onClick = onNavigateInbox)
                MoreNavRow(icon = Icons.Default.Delete, label = "Trash", onClick = onNavigateTrash)
            }

            SectionLabel("Private and connected")
            NavGroup {
                MoreNavRow(icon = Icons.Default.Lock, label = "Private Vault", onClick = onNavigateVault)
                MoreNavRow(icon = Icons.Default.Cloud, label = "Google Drive", onClick = onNavigateDrive)
                MoreNavRow(icon = Icons.Default.Lan, label = "WebDAV (use in other apps)", onClick = onNavigateWebDav)
            }

            SectionLabel("Settings")
            NavGroup {
                MoreNavRow(icon = Icons.Default.Person, label = "Account and Telegram", onClick = onNavigateAccount)
                MoreNavRow(icon = Icons.Default.Notifications, label = if (unread > 0) "Notifications · $unread new" else "Notifications", onClick = onNavigateNotifications)
                MoreNavRow(icon = Icons.Default.Movie, label = "Video downloads", onClick = onNavigateDownloads)
                MoreNavRow(icon = Icons.Default.Bolt, label = "Telegram on this phone", onClick = onNavigateTelegram)
                if (isOwner) {
                    MoreNavRow(icon = Icons.Default.Group, label = "Users", onClick = onNavigateUsers)
                }
            }

            AppearanceSection(container)
            SecuritySection(container)
            AboutSection(container)

            OutlinedButton(
                onClick = { showSignOutConfirm = true },
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 20.dp, bottom = 8.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Sign out")
            }
        }
    }

    if (showSignOutConfirm) {
        ConfirmDialog(
            title = "Sign out?",
            message = "Are you sure you want to sign out from this account?",
            confirmText = "Sign out",
            isDestructive = true,
            onDismiss = { showSignOutConfirm = false },
            onConfirm = {
                showSignOutConfirm = false
                scope.launch {
                    try {
                        container.api().logout()
                    } catch (_: Exception) {
                        // ignore network errors on sign-out
                    } finally {
                        container.session.signedOut()
                    }
                }
            },
        )
    }
}

/** A card of navigation rows with a thin line between each (the rows come from [content]). */
@Composable
private fun NavGroup(content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(
                space = 1.dp,
            ),
            modifier = Modifier.background(DividerDefaults.color.copy(alpha = 0.35f)),
        ) { content() }
    }
}

@Composable
private fun MoreNavRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(22.dp),
        )
        Spacer(modifier = Modifier.width(16.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowForwardIos,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
    }
}
