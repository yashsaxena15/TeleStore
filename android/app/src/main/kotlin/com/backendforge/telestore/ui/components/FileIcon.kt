package com.backendforge.telestore.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKind
import com.backendforge.telestore.core.TeleStoreApi

object FileKindColors {
    val VideoAccent = Color(0xFFA78BFA)
    val VideoBg = Color(0xFF2E1065)

    val AudioAccent = Color(0xFFFBBF24)
    val AudioBg = Color(0xFF451A03)

    val PhotoAccent = Color(0xFF34D399)
    val PhotoBg = Color(0xFF064E3B)

    val DocAccent = Color(0xFFFB7185)
    val DocBg = Color(0xFF4C0519)

    val ArchiveAccent = Color(0xFFFB923C)
    val ArchiveBg = Color(0xFF431407)

    val OtherAccent = Color(0xFFA1A1AA)
    val OtherBg = Color(0xFF27272A)
}

fun fileKindIcon(kind: FileKind): ImageVector = when (kind) {
    FileKind.FOLDER -> Icons.Default.Folder
    FileKind.VIDEO -> Icons.Default.Movie
    FileKind.AUDIO -> Icons.Default.AudioFile
    FileKind.PHOTO -> Icons.Default.Image
    FileKind.DOCUMENT -> Icons.Default.Description
    FileKind.ARCHIVE -> Icons.Default.Archive
    FileKind.OTHER -> Icons.Default.InsertDriveFile
}

@Composable
fun FileKindBox(
    kind: FileKind,
    modifier: Modifier = Modifier,
    iconSize: Dp = 24.dp,
    shapeRadius: Dp = 10.dp,
) {
    val (iconColor, bgColor) = when (kind) {
        FileKind.FOLDER -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.secondaryContainer
        FileKind.VIDEO -> FileKindColors.VideoAccent to FileKindColors.VideoBg
        FileKind.AUDIO -> FileKindColors.AudioAccent to FileKindColors.AudioBg
        FileKind.PHOTO -> FileKindColors.PhotoAccent to FileKindColors.PhotoBg
        FileKind.DOCUMENT -> FileKindColors.DocAccent to FileKindColors.DocBg
        FileKind.ARCHIVE -> FileKindColors.ArchiveAccent to FileKindColors.ArchiveBg
        FileKind.OTHER -> FileKindColors.OtherAccent to FileKindColors.OtherBg
    }

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(shapeRadius))
            .background(bgColor),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = fileKindIcon(kind),
            contentDescription = kind.name,
            tint = iconColor,
            modifier = Modifier.size(iconSize),
        )
    }
}

@Composable
fun FileThumbnail(
    item: FileItem,
    api: TeleStoreApi,
    modifier: Modifier = Modifier,
    shapeRadius: Dp = 10.dp,
    iconSize: Dp = 24.dp,
) {
    // Telegram's thumbnail when there is one, else a preview the server makes from the original
    // (photos and videos sent as documents, e.g. HEIC or big photos, have no Telegram thumbnail)
    val thumbnailUrl = if (!item.isFolder) api.media.thumbnail(item)?.toString() else null
    val previewUrl = if (!item.isFolder) api.media.preview(item)?.toString() else null
    val shape = RoundedCornerShape(shapeRadius)
    val kindBox: @Composable () -> Unit = {
        FileKindBox(kind = item.kind, modifier = Modifier.fillMaxSize(), iconSize = iconSize, shapeRadius = shapeRadius)
    }

    when {
        thumbnailUrl != null -> SubcomposeAsyncImage(
            model = thumbnailUrl,
            contentDescription = item.name,
            contentScale = ContentScale.Crop,
            modifier = modifier.clip(shape),
            loading = { kindBox() },
            // A Telegram thumbnail that is gone: try the server's preview before giving up
            error = {
                if (previewUrl != null) {
                    SubcomposeAsyncImage(
                        model = previewUrl,
                        contentDescription = item.name,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                        loading = { kindBox() },
                        error = { kindBox() },
                    )
                } else {
                    kindBox()
                }
            },
        )
        previewUrl != null -> SubcomposeAsyncImage(
            model = previewUrl,
            contentDescription = item.name,
            contentScale = ContentScale.Crop,
            modifier = modifier.clip(shape),
            loading = { kindBox() },
            error = { kindBox() },
        )
        else -> FileKindBox(kind = item.kind, modifier = modifier, iconSize = iconSize, shapeRadius = shapeRadius)
    }
}
