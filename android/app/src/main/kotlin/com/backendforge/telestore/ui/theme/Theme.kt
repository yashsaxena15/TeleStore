package com.backendforge.telestore.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// The website's colours: near-black ground, indigo accent
private val Indigo600 = Color(0xFF4F46E5)
private val Indigo300 = Color(0xFFA5B4FC)
private val Indigo950 = Color(0xFF1E1B4B)

private val Dark = darkColorScheme(
    primary = Indigo300,
    onPrimary = Color(0xFF09090B),
    primaryContainer = Indigo600,
    onPrimaryContainer = Color.White,
    secondaryContainer = Color(0xFF312E81),
    onSecondaryContainer = Color(0xFFE0E7FF),
    background = Color(0xFF09090B),
    onBackground = Color(0xFFFAFAFA),
    surface = Color(0xFF09090B),
    onSurface = Color(0xFFFAFAFA),
    surfaceVariant = Color(0xFF18181B),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceContainer = Color(0xFF131316),
    surfaceContainerHigh = Color(0xFF18181B),
    outline = Color(0xFF3F3F46),
    outlineVariant = Color(0xFF27272A),
    error = Color(0xFFFCA5A5),
)

private val Light = lightColorScheme(
    primary = Indigo600,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E7FF),
    onPrimaryContainer = Indigo950,
    secondaryContainer = Color(0xFFE0E7FF),
    onSecondaryContainer = Indigo950,
    background = Color(0xFFFAFAFA),
    onBackground = Color(0xFF09090B),
    surface = Color(0xFFFAFAFA),
    onSurface = Color(0xFF09090B),
    surfaceVariant = Color(0xFFF4F4F5),
    onSurfaceVariant = Color(0xFF52525B),
    outline = Color(0xFFD4D4D8),
    outlineVariant = Color(0xFFE4E4E7),
    error = Color(0xFFDC2626),
)

@Composable
fun TeleStoreTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}
