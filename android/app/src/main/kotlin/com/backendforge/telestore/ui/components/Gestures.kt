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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Pull a full-screen player or viewer down to close it (as in YouTube and Google Photos). The
 * screen follows the finger, a small vibration says "let go now", and short pulls spring back.
 */
class PullDownState internal constructor(
    private val scope: CoroutineScope,
    private val haptics: Haptics,
    private val threshold: Float,
    private val onClose: () -> Unit,
) {
    /** How far the screen has been pulled down, in pixels. */
    var offset by mutableFloatStateOf(0f)
        private set

    /** 0 at rest, 1 once a release would close (for fading the background). */
    val progress: Float get() = (offset / threshold).coerceIn(0f, 1f)

    private var armed = false

    internal fun drag(delta: Float) {
        offset = (offset + delta).coerceAtLeast(0f)
        val now = offset >= threshold
        if (now && !armed) haptics.threshold()
        armed = now
    }

    internal fun release() {
        if (armed) {
            armed = false
            onClose()
        } else {
            scope.launch { animate(offset, 0f) { value, _ -> offset = value } }
        }
    }
}

@Composable
fun rememberPullDownState(onClose: () -> Unit): PullDownState {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val threshold = with(LocalDensity.current) { 120.dp.toPx() }
    val close by rememberUpdatedState(onClose)
    return remember(haptics, threshold) { PullDownState(scope, haptics, threshold) { close() } }
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

/** What moves: follows the pull down and shrinks a little, like a card being put away. */
fun Modifier.pullDownOffset(state: PullDownState): Modifier = graphicsLayer {
    translationY = state.offset
    val shrink = 1f - 0.08f * state.progress
    scaleX = shrink
    scaleY = shrink
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
                    lift = 0f
                },
                onDragCancel = { lift = 0f },
                onVerticalDrag = { change, amount ->
                    change.consume()
                    lift = (lift + amount).coerceAtMost(0f)
                },
            )
        }
        .swipeSideways(onNext, onPrevious)
}
