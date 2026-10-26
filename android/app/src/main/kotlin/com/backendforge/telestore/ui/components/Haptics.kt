package com.backendforge.telestore.ui.components

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import com.backendforge.telestore.TeleStoreApplication

/**
 * Small vibrations for touches that matter (selecting, crossing a swipe's "let go now" point,
 * a right or wrong PIN). They follow the phone's own touch-vibration setting, and can be turned
 * off in More → Appearance.
 */
class Haptics(private val view: View, private val enabled: () -> Boolean) {
    /** A key press or a small toggle. */
    fun click() = perform(HapticFeedbackConstants.VIRTUAL_KEY)

    /** Long-press to start selecting. */
    fun longPress() = perform(HapticFeedbackConstants.LONG_PRESS)

    /** A light tick (moving between items, skipping 10 s). */
    fun tick() = perform(HapticFeedbackConstants.CLOCK_TICK)

    /** A swipe has gone far enough: letting go now will act. */
    fun threshold() = perform(
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE
        else HapticFeedbackConstants.CONTEXT_CLICK,
    )

    /** Something worked (vault opened, backup on, copied). */
    fun confirm() = perform(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)

    /** Something was refused (wrong PIN). */
    fun reject() = perform(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS)

    private fun perform(type: Int) {
        if (enabled()) view.performHapticFeedback(type)
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    val settings = (LocalContext.current.applicationContext as TeleStoreApplication).container.settings
    return remember(view) { Haptics(view) { settings.haptics } }
}
