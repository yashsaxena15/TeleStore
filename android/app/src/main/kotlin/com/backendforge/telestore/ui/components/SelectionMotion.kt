package com.backendforge.telestore.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * How selecting looks everywhere (list rows, grid cards, photo tiles): the highlight fades in,
 * the item settles slightly smaller with a spring, and the check mark pops in.
 */
object SelectionMotion {
    private val bounce = spring<Float>(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow)

    /** Highlight behind a selected item. */
    @Composable
    fun background(selected: Boolean): State<Color> = animateColorAsState(
        targetValue = if (selected) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.55f) else Color.Transparent,
        animationSpec = tween(180),
        label = "selection background",
    )

    /** Scale of a selected item's picture (1 when not selected). */
    @Composable
    fun scale(selected: Boolean, selectedScale: Float = 0.92f): State<Float> =
        animateFloatAsState(if (selected) selectedScale else 1f, animationSpec = bounce, label = "selection scale")

    /** Inset of a selected photo tile (Google Photos style). */
    @Composable
    fun inset(selected: Boolean, amount: Dp = 10.dp): State<Dp> =
        animateDpAsState(if (selected) amount else 0.dp, animationSpec = spring(stiffness = Spring.StiffnessMediumLow), label = "selection inset")

    /** Check boxes appearing when selection starts (rows: they slide in from the start). */
    val checkboxEnter = fadeIn(tween(160)) + expandHorizontally(tween(200)) + scaleIn(initialScale = 0.6f)
    val checkboxExit = fadeOut(tween(120)) + shrinkHorizontally(tween(180)) + scaleOut(targetScale = 0.6f)

    /** A check mark popping over a tile. */
    val markEnter = fadeIn(tween(120)) + scaleIn(initialScale = 0.4f, animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy))
    val markExit = fadeOut(tween(100)) + scaleOut(targetScale = 0.4f)
}
