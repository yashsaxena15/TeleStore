package com.backendforge.telestore.ui.components

import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * A progress bar whose unfilled part is a faint track. Material's default draws the empty part in a
 * strong colour with a gap and an end dot, so 0.5% looked like a full bar.
 */
@Composable
fun ProgressBar(
    progress: () -> Float,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
) {
    LinearProgressIndicator(
        progress = progress,
        modifier = modifier,
        color = color,
        trackColor = trackColor,
        gapSize = 0.dp,
        drawStopIndicator = {},
    )
}

/** The same bar, moving, for work whose size isn't known yet. */
@Composable
fun ProgressBar(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary) {
    LinearProgressIndicator(
        modifier = modifier,
        color = color,
        trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
        gapSize = 0.dp,
    )
}
