package com.backendforge.telestore.ui.photos

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

/**
 * The Photos section's own colours, taken from Google Photos: pure black (or white) behind the
 * photos, grey cards, and a soft purple accent. It follows the app's light or dark choice, and
 * keeps the app's fonts and shapes. The rest of the app keeps its own theme.
 */
@Composable
fun PhotosTheme(content: @Composable () -> Unit) {
    val base = MaterialTheme.colorScheme
    val dark = base.background.luminance() < 0.5f
    val scheme = if (dark) {
        base.copy(
            background = Color.Black, onBackground = Color(0xFFE3E2E9),
            surface = Color.Black, onSurface = Color(0xFFE3E2E9), onSurfaceVariant = Color(0xFFC6C5D0),
            surfaceContainerLowest = Color.Black, surfaceContainerLow = Color(0xFF131316),
            surfaceContainer = Color(0xFF1E1F25), surfaceContainerHigh = Color(0xFF292A2F), surfaceContainerHighest = Color(0xFF34343A),
            surfaceVariant = Color(0xFF292A2F),
            primary = Color(0xFFBAC3FF), onPrimary = Color(0xFF212C61),
            primaryContainer = Color(0xFF394379), onPrimaryContainer = Color(0xFFDEE0FF),
            secondaryContainer = Color(0xFF3F4256), onSecondaryContainer = Color(0xFFDFE1F9),
            outline = Color(0xFF90909A), outlineVariant = Color(0xFF46464F),
        )
    } else {
        base.copy(
            background = Color.White, onBackground = Color(0xFF1B1B21),
            surface = Color.White, onSurface = Color(0xFF1B1B21), onSurfaceVariant = Color(0xFF46464F),
            surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF5F2FA),
            surfaceContainer = Color(0xFFEFEDF4), surfaceContainerHigh = Color(0xFFE9E7EF), surfaceContainerHighest = Color(0xFFE3E1E9),
            surfaceVariant = Color(0xFFE3E1EC),
            primary = Color(0xFF4355B9), onPrimary = Color.White,
            primaryContainer = Color(0xFFDEE0FF), onPrimaryContainer = Color(0xFF00105C),
            secondaryContainer = Color(0xFFE0E1F9), onSecondaryContainer = Color(0xFF181A2C),
            outline = Color(0xFF767680), outlineVariant = Color(0xFFC6C5D0),
        )
    }
    MaterialTheme(colorScheme = scheme, typography = MaterialTheme.typography, shapes = MaterialTheme.shapes, content = content)
}
