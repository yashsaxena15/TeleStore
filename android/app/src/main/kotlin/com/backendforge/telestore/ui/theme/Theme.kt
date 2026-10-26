package com.backendforge.telestore.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.backendforge.telestore.R

/** Inter, bundled (SIL Open Font License, see assets/licenses/Inter-OFL.txt). */
val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
)

// Dark: "Midnight" (design A). Near-black ground, indigo accent.
private val Dark = darkColorScheme(
    primary = Color(0xFF818CF8),
    onPrimary = Color(0xFF0B0B0F),
    primaryContainer = Color(0xFF6366F1),
    onPrimaryContainer = Color.White,
    secondary = Color(0xFFA5B4FC),
    secondaryContainer = Color(0xFF312E81),
    onSecondaryContainer = Color(0xFFE0E7FF),
    tertiary = Color(0xFF86EFAC),
    tertiaryContainer = Color(0xFF14532D),
    onTertiaryContainer = Color(0xFF86EFAC),
    background = Color(0xFF0B0B0F),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF0B0B0F),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF17171D),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceContainerLowest = Color(0xFF08080B),
    surfaceContainerLow = Color(0xFF101015),
    surfaceContainer = Color(0xFF13131A),
    surfaceContainerHigh = Color(0xFF1A1A21),
    surfaceContainerHighest = Color(0xFF1F1F27),
    outline = Color(0xFF3F3F46),
    outlineVariant = Color(0xFF26262E),
    error = Color(0xFFFCA5A5),
    inverseSurface = Color(0xFFF4F4F5),
    inverseOnSurface = Color(0xFF0B0B0F),
)

// Light: "Daylight" (design B colours on the same layout). Soft grey ground, Google-blue accent.
private val Light = lightColorScheme(
    primary = Color(0xFF1A73E8),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF1A73E8),
    onPrimaryContainer = Color.White,
    secondary = Color(0xFF1557B0),
    secondaryContainer = Color(0xFFD3E3FD),
    onSecondaryContainer = Color(0xFF0B3D82),
    tertiary = Color(0xFF137333),
    tertiaryContainer = Color(0xFFE6F4EA),
    onTertiaryContainer = Color(0xFF137333),
    background = Color(0xFFF6F7F9),
    onBackground = Color(0xFF101828),
    surface = Color(0xFFF6F7F9),
    onSurface = Color(0xFF101828),
    surfaceVariant = Color(0xFFF2F4F7),
    onSurfaceVariant = Color(0xFF5B6472),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color.White,
    surfaceContainer = Color.White,
    surfaceContainerHigh = Color(0xFFF2F4F7),
    surfaceContainerHighest = Color(0xFFE9ECF1),
    outline = Color(0xFFD0D5DD),
    outlineVariant = Color(0xFFE4E7EC),
    error = Color(0xFFD92D20),
    inverseSurface = Color(0xFF101828),
    inverseOnSurface = Color(0xFFF6F7F9),
)

private val Base = Typography()

/** Material's type scale, set in Inter with the weights the designs use. */
private val AppTypography = Typography(
    displaySmall = Base.displaySmall.inter(FontWeight.Bold),
    headlineLarge = Base.headlineLarge.inter(FontWeight.Bold),
    headlineMedium = Base.headlineMedium.inter(FontWeight.Bold),
    headlineSmall = Base.headlineSmall.inter(FontWeight.Bold),
    titleLarge = Base.titleLarge.inter(FontWeight.Bold).copy(fontSize = 20.sp),
    titleMedium = Base.titleMedium.inter(FontWeight.SemiBold),
    titleSmall = Base.titleSmall.inter(FontWeight.SemiBold),
    bodyLarge = Base.bodyLarge.inter(FontWeight.Normal).copy(fontSize = 15.sp),
    bodyMedium = Base.bodyMedium.inter(FontWeight.Normal),
    bodySmall = Base.bodySmall.inter(FontWeight.Normal),
    labelLarge = Base.labelLarge.inter(FontWeight.SemiBold),
    labelMedium = Base.labelMedium.inter(FontWeight.Medium),
    labelSmall = Base.labelSmall.inter(FontWeight.Medium),
)

private fun TextStyle.inter(weight: FontWeight) = copy(fontFamily = Inter, fontWeight = weight)

@Composable
fun TeleStoreTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, typography = AppTypography, content = content)
}
