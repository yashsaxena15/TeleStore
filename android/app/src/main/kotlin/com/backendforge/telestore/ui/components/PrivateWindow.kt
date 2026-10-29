package com.backendforge.telestore.ui.components

import android.app.Activity
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import com.backendforge.telestore.player.findActivity

/**
 * No screenshots, and a blank preview in Recents, while anything private is on screen (the vault, a
 * vault video, full screen or minimized). Counted, so leaving the vault doesn't lift the protection
 * while one of its videos still plays.
 */
object PrivateWindow {
    private var holders = 0

    fun hold(activity: Activity) {
        if (holders++ == 0) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    fun release(activity: Activity) {
        holders = (holders - 1).coerceAtLeast(0)
        if (holders == 0) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}

/** Keeps the window private while [active] and this is on screen. */
@Composable
fun PrivateWhile(active: Boolean) {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity, active) {
        if (active) PrivateWindow.hold(activity)
        onDispose { if (active) PrivateWindow.release(activity) }
    }
}
