package com.backendforge.telestore.ui.transfers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.backendforge.telestore.core.TransferActions
import com.backendforge.telestore.core.TransferKind
import com.backendforge.telestore.core.TransferRow
import com.backendforge.telestore.core.TransferRows
import com.backendforge.telestore.core.TransferState
import com.backendforge.telestore.core.TransferTone
import com.backendforge.telestore.transfers.Direction
import com.backendforge.telestore.transfers.PhoneTransfer
import com.backendforge.telestore.transfers.TransferStatus
import com.backendforge.telestore.ui.components.ProgressBar
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Amber: waiting for Google Drive's limit (the website uses its warning colour the same way). */
internal val AmberColor = Color(0xFFF5B942)
private val DoneColor = Color(0xFF4ADE80)

@Composable
internal fun toneColor(tone: TransferTone): Color = when (tone) {
    TransferTone.MOVING -> MaterialTheme.colorScheme.primary
    TransferTone.AMBER -> AmberColor
    TransferTone.SUCCESS -> DoneColor
    TransferTone.ERROR -> MaterialTheme.colorScheme.error
    TransferTone.WAITING, TransferTone.MUTED -> MaterialTheme.colorScheme.onSurfaceVariant
}

/** A phone transfer as a row of the shared list. */
internal fun PhoneTransfer.toRow(): TransferRow = TransferRows.phone(
    id = id, upload = direction == Direction.UPLOAD, name = name,
    state = when (status) {
        TransferStatus.QUEUED -> TransferState.WAITING
        TransferStatus.RUNNING -> TransferState.RUNNING
        TransferStatus.SAVING -> TransferState.SAVING
        TransferStatus.PAUSED -> TransferState.PAUSED
        TransferStatus.DONE -> TransferState.DONE
        TransferStatus.FAILED -> TransferState.FAILED
        TransferStatus.CANCELLED -> TransferState.CANCELLED
    },
    done = done, size = size, speedBps = speedBps, createdAt = createdAt,
    // A waiting one may say why ("Waiting for the connection…")
    error = error,
    destination = if (direction == Direction.UPLOAD) folder ?: "/Home" else if (offline) null else
        // Where it's saved on the phone: the downloads location and the folders it came in ("Download/TeleStore/Trip/Day 1")
        listOfNotNull(com.backendforge.telestore.transfers.DownloadFiles.describe(targetTree), subPath).joinToString("/"),
)

/**
 * A plain, continuous bar (drawn here so it never breaks into segments, whatever the progress).
 */
@Composable
internal fun TransferBar(progress: Float, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(6.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)),
    ) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).background(color))
    }
}

@Composable
internal fun StatusChip(row: TransferRow) {
    val label = TransferRows.label(row)
    val color = toneColor(label.tone)
    Text(
        label.text,
        color = color,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.4.sp,
        maxLines = 1,
        modifier = Modifier.background(color.copy(alpha = 0.14f), RoundedCornerShape(5.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

internal fun iconFor(row: TransferRow): ImageVector = when (row.kind) {
    TransferKind.UPLOAD -> Icons.Filled.ArrowUpward
    TransferKind.DOWNLOAD -> Icons.Filled.ArrowDownward
    TransferKind.SERVER_FOLDER -> Icons.Filled.Folder
    TransferKind.SERVER_FILE -> Icons.Filled.Cloud
}

@Composable
private fun KindIcon(row: TransferRow) {
    val (tint, ground) = when (row.kind) {
        TransferKind.UPLOAD -> Color(0xFFA5B4FC) to Color(0x334F46E5)
        TransferKind.DOWNLOAD -> Color(0xFF4ADE80) to Color(0x3322C55E)
        else -> Color(0xFF93C5FD) to Color(0x333B82F6)
    }
    Box(Modifier.size(36.dp).background(ground, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
        Icon(iconFor(row), contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
    }
}

/** Google's limit, in amber, with its Resume now button. */
@Composable
internal fun GoogleNote(row: TransferRow, onResumeNow: (() -> Unit)?) {
    val note = TransferRows.googleNote(row) ?: return
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(note, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = AmberColor, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (onResumeNow != null) TextButton(onClick = onResumeNow) { Text("Resume now", color = AmberColor) }
    }
}

/**
 * One transfer that hasn't finished: name and coloured status, "size of total · speed · time left",
 * a bar with the percentage, and the machine working on it (or the phone's pause and cancel).
 */
@Composable
internal fun TransferCard(
    row: TransferRow,
    onClick: () -> Unit,
    onPause: () -> Unit = {},
    onResume: () -> Unit = {},
    onCancel: () -> Unit = {},
    onRetry: () -> Unit = {},
    onResumeNow: (() -> Unit)? = null,
    showFileButtons: Boolean = false,
) {
    val can = TransferRows.actions(row)
    val label = TransferRows.label(row)
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick),
    ) {
        Column(Modifier.padding(start = 12.dp, end = 8.dp, top = 10.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KindIcon(row)
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(row.name, Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                        StatusChip(row)
                    }
                    val detail = TransferRows.detail(row)
                    if (detail.isNotEmpty()) {
                        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            GoogleNote(row, onResumeNow.takeIf { can.resumeNow })
            val message = row.error ?: row.phase?.takeIf { row.state == TransferState.SCANNING }
            if (message != null) {
                Text(
                    message, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = if (row.state == TransferState.FAILED || row.filesFailed > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val unknownSize = row.isPhone && (row.state == TransferState.SAVING || (row.state == TransferState.RUNNING && row.total <= 0))
                if (unknownSize) {
                    ProgressBar(Modifier.weight(1f))
                } else {
                    TransferBar(row.progress, toneColor(label.tone).takeIf { label.tone != TransferTone.WAITING } ?: MaterialTheme.colorScheme.outline, Modifier.weight(1f))
                    Text("${(row.progress * 100).toInt()}%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TransferRows.workerLabel(row.worker)?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
                if (row.isPhone || showFileButtons) {
                    if (can.pause) SmallIcon(Icons.Filled.Pause, "Pause ${row.name}", onPause)
                    if (can.resume) SmallIcon(Icons.Filled.PlayArrow, "Resume ${row.name}", onResume)
                    if (can.retry) SmallIcon(Icons.Filled.Refresh, "Retry ${row.name}", onRetry)
                    if (can.cancel) SmallIcon(Icons.Filled.Close, "Cancel ${row.name}", onCancel)
                } else {
                    Box(Modifier.width(4.dp))
                }
            }
        }
    }
}

@Composable
private fun SmallIcon(icon: ImageVector, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(36.dp)) { Icon(icon, contentDescription = label, modifier = Modifier.size(20.dp)) }
}

/** A finished transfer: one compact line ("✓ Railway Men S01E01.mkv   1.9 GB"). */
@Composable
internal fun FinishedRow(row: TransferRow, onClick: () -> Unit, onRetry: () -> Unit) {
    val (icon, tint) = when (row.state) {
        TransferState.DONE -> Icons.Filled.CheckCircle to DoneColor
        TransferState.FAILED -> Icons.Filled.ErrorOutline to MaterialTheme.colorScheme.error
        else -> Icons.Filled.Block to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).clickable(onClick = onClick).padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = TransferRows.label(row).text.lowercase(Locale.ENGLISH), tint = tint, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            Text(row.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            val sub = when {
                row.state == TransferState.FAILED && !row.isFolder -> row.error ?: "Failed"
                row.state == TransferState.CANCELLED -> "Cancelled"
                else -> TransferRows.detail(row)
            }
            if (sub.isNotEmpty()) {
                Text(
                    sub, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (row.state == TransferState.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (TransferRows.actions(row).retry) SmallIcon(Icons.Filled.Refresh, "Retry ${row.name}", onRetry)
    }
}

/** What the details sheet can do; null hides that button. */
internal class DetailHandlers(
    val open: (() -> Unit)? = null,
    val showInFolder: (() -> Unit)? = null,
    val pause: (() -> Unit)? = null,
    val resume: (() -> Unit)? = null,
    val retry: (() -> Unit)? = null,
    val cancel: (() -> Unit)? = null,
    val copyLink: (() -> Unit)? = null,
    val resumeNow: (() -> Unit)? = null,
)

/** Everything about one transfer, and what can be done with it (only what applies). */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun TransferDetailsSheet(row: TransferRow, handlers: DetailHandlers, onDismiss: () -> Unit) {
    val can: TransferActions = TransferRows.actions(row)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(row.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                StatusChip(row)
            }
            TransferRows.detail(row).takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            GoogleNote(row, null)
            row.sourceUrl?.takeIf { it.isNotBlank() }?.let { Fact("Source link", it) }
            row.destination?.let { Fact(if (row.kind == TransferKind.DOWNLOAD) "Saved in" else "Destination folder", it) }
            if (row.kind == TransferKind.DOWNLOAD) Fact("Saved in", "Downloads/TeleStore")
            val size = maxOf(row.total, row.done)
            if (size > 0) Fact("Size", TransferRows.bytes(size))
            if (row.startedAt > 0) Fact("Started", formatTime(row.startedAt))
            TransferRows.workerLabel(row.worker)?.let { Fact("Machine", it) }
            row.error?.let { Fact(if (row.state == TransferState.FAILED || row.filesFailed > 0) "Error" else "Note", it, error = row.state == TransferState.FAILED || row.filesFailed > 0) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (can.open) handlers.open?.let { Action(Icons.AutoMirrored.Filled.OpenInNew, "Open", it) }
                if (can.showInFolder) handlers.showInFolder?.let { Action(Icons.Filled.FolderOpen, "Show in folder", it) }
                if (can.resumeNow) handlers.resumeNow?.let { Action(Icons.Filled.PlayArrow, "Resume now", it) }
                if (can.pause) handlers.pause?.let { Action(Icons.Filled.Pause, "Pause", it) }
                if (can.resume) handlers.resume?.let { Action(Icons.Filled.PlayArrow, "Resume", it) }
                if (can.retry) handlers.retry?.let { Action(Icons.Filled.Refresh, "Retry", it) }
                if (can.copyLink) handlers.copyLink?.let { Action(Icons.Filled.ContentCopy, "Copy link", it) }
                if (can.cancel) handlers.cancel?.let { Action(Icons.Filled.Close, "Cancel", it) }
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String, error: Boolean = false) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer {
            Text(value, style = MaterialTheme.typography.bodyMedium, color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun Action(icon: ImageVector, label: String, onClick: () -> Unit) {
    AssistChip(onClick = onClick, label = { Text(label) }, leadingIcon = { Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp)) })
}

private fun formatTime(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.getDefault()))
