package com.backendforge.telestore.ui.components

import androidx.compose.animation.core.animate
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Pull a full-screen player or viewer down to close it (as in YouTube and Google Photos). The
 * screen follows the finger and shrinks toward the mini player, a small vibration says "let go
 * now", and short pulls spring back. With [onPullUp], a swipe up does that instead (full screen).
 */
class PullDownState internal constructor(
    private val scope: CoroutineScope,
    private val haptics: Haptics,
    private val threshold: Float,
    /** The screen's height: a pull this long shrinks the screen as far as it goes. */
    internal val distance: Float,
    private val onClose: () -> Unit,
    private val onPullUp: (() -> Unit)?,
) {
    /** How far the screen has been pulled down, in pixels. */
    var offset by mutableFloatStateOf(0f)
        private set

    /** How far it has been pushed up (0 or less), when a swipe up does something. */
    var lift by mutableFloatStateOf(0f)
        private set

    /** 0 at rest, 1 once a release would close (for fading the background). */
    val progress: Float get() = (offset / threshold).coerceIn(0f, 1f)

    /** 0 at rest, 1 once a release would act on the swipe up. */
    val upProgress: Float get() = (-lift / threshold).coerceIn(0f, 1f)

    private var armed = false
    private var upArmed = false

    internal fun drag(delta: Float) {
        val total = offset + lift + delta
        offset = total.coerceAtLeast(0f)
        lift = if (onPullUp != null) total.coerceAtMost(0f) else 0f
        val now = offset >= threshold
        if (now && !armed) haptics.threshold()
        armed = now
        val up = -lift >= threshold
        if (up && !upArmed) haptics.threshold()
        upArmed = up
    }

    internal fun release() {
        if (armed) {
            // The screen keeps its place; the closing transition carries it on down from there
            armed = false
            onClose()
            return
        }
        if (upArmed) onPullUp?.invoke()
        upArmed = false
        if (offset != 0f) scope.launch { animate(offset, 0f) { value, _ -> offset = value } }
        if (lift != 0f) scope.launch { animate(lift, 0f) { value, _ -> lift = value } }
    }
}

@Composable
fun rememberPullDownState(onClose: () -> Unit, onPullUp: (() -> Unit)? = null): PullDownState {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val threshold = with(LocalDensity.current) { 120.dp.toPx() }
    val distance = with(LocalDensity.current) { LocalConfiguration.current.screenHeightDp.dp.toPx() }
    val close by rememberUpdatedState(onClose)
    val pullUp by rememberUpdatedState(onPullUp)
    val canPullUp = onPullUp != null
    return remember(haptics, threshold, distance, canPullUp) {
        PullDownState(scope, haptics, threshold, distance, { close() }, if (canPullUp) ({ pullUp?.invoke() }) else null)
    }
}

/** Where the pull is felt: a vertical drag here moves [state]. */
fun Modifier.pullDownToClose(state: PullDownState, enabled: Boolean = true): Modifier =
    if (!enabled) this else pointerInput(state) {
        detectVerticalDragGestures(
            onDragEnd = { state.release() },
            onDragCancel = { state.release() },
            onVerticalDrag = { change, amount ->
                change.consume()
                state.drag(amount)
            },
        )
    }

/**
 * What moves: the top follows the finger while the screen shrinks and rounds its corners, heading
 * for the mini player. A swipe up (when it does something) gives a little and grows slightly.
 */
fun Modifier.pullDownOffset(state: PullDownState): Modifier = graphicsLayer {
    val travel = (state.offset / state.distance).coerceIn(0f, 1f)
    translationY = state.offset + state.lift * 0.35f
    val size = 1f - 0.45f * travel + 0.04f * state.upProgress
    scaleX = size
    scaleY = size
    transformOrigin = TransformOrigin(0.5f, 0f)
    shape = RoundedCornerShape((28f * (travel * 4f).coerceAtMost(1f)).dp)
    clip = state.offset > 0f
}

/** Swipe left for [onNext], right for [onPrevious] (album art, mini players). It follows the finger sideways. */
@Composable
fun Modifier.swipeSideways(onNext: () -> Unit, onPrevious: () -> Unit): Modifier {
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val limit = with(LocalDensity.current) { 72.dp.toPx() }
    val next by rememberUpdatedState(onNext)
    val previous by rememberUpdatedState(onPrevious)
    var shift by remember { mutableFloatStateOf(0f) }
    return this
        .pointerInput(Unit) {
            detectHorizontalDragGestures(
                onDragEnd = {
                    when {
                        shift <= -limit -> next()
                        shift >= limit -> previous()
                    }
                    scope.launch { animate(shift, 0f) { value, _ -> shift = value } }
                },
                onDragCancel = { scope.launch { animate(shift, 0f) { value, _ -> shift = value } } },
                onHorizontalDrag = { change, amount ->
                    change.consume()
                    val before = abs(shift) >= limit
                    shift += amount
                    if (!before && abs(shift) >= limit) haptics.threshold()
                },
            )
        }
        .graphicsLayer {
            translationX = shift * 0.6f
            alpha = 1f - (abs(shift) / (limit * 3)).coerceIn(0f, 0.5f)
        }
}

/** The mini players: swipe sideways for the next or previous track, swipe up to open the full player. */
@Composable
fun Modifier.miniPlayerSwipes(onNext: () -> Unit, onPrevious: () -> Unit, onOpen: () -> Unit): Modifier {
    val haptics = rememberHaptics()
    val limit = with(LocalDensity.current) { 36.dp.toPx() }
    val scope = rememberCoroutineScope()
    val open by rememberUpdatedState(onOpen)
    var lift by remember { mutableFloatStateOf(0f) }
    return this
        .pointerInput(Unit) {
            detectVerticalDragGestures(
                onDragEnd = {
                    if (lift <= -limit) {
                        haptics.click()
                        open()
                    }
                    scope.launch { animate(lift, 0f) { value, _ -> lift = value } }
                },
                onDragCancel = { scope.launch { animate(lift, 0f) { value, _ -> lift = value } } },
                onVerticalDrag = { change, amount ->
                    change.consume()
                    val before = lift <= -limit
                    lift = (lift + amount).coerceAtMost(0f)
                    if (!before && lift <= -limit) haptics.threshold()
                },
            )
        }
        // The bar rises with the finger (half as far), growing a little, as if being pulled open
        .graphicsLayer {
            translationY = lift * 0.5f
            val grow = 1f + 0.03f * (-lift / limit).coerceIn(0f, 1f)
            scaleX = grow
            scaleY = grow
        }
        .swipeSideways(onNext, onPrevious)
}
