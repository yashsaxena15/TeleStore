package com.backendforge.telestore

import android.app.PictureInPictureParams
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.ui.MainScreen
import com.backendforge.telestore.ui.signin.SignInScreen
import com.backendforge.telestore.ui.theme.TeleStoreTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class MainActivity : ComponentActivity() {
    private val _inPictureInPicture = MutableStateFlow(false)
    /** True while the video plays in the small floating window. */
    val inPictureInPicture: StateFlow<Boolean> = _inPictureInPicture.asStateFlow()

    /**
     * Set by the video screen: the video's shape while it plays, null otherwise. Leaving the app
     * then moves the video into picture-in-picture instead of pausing it.
     */
    var pictureInPictureRatio: (() -> Rational?)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        addOnPictureInPictureModeChangedListener { _inPictureInPicture.value = it.isInPictureInPictureMode }
        val container = (application as TeleStoreApplication).container
        setContent {
            TeleStoreTheme {
                val session by container.session.state.collectAsStateWithLifecycle()
                val current = session
                if (current == null) {
                    SignInScreen(container)
                } else {
                    MainScreen(container, current)
                }
            }
        }
    }

    /** Opens picture-in-picture now (the video screen's button). False when nothing plays. */
    fun enterPictureInPicture(): Boolean {
        val ratio = pictureInPictureRatio?.invoke() ?: return false
        return runCatching { enterPictureInPictureMode(params(ratio, autoEnter = false)) }.getOrDefault(false)
    }

    /** Android 12+ moves a playing video into picture-in-picture by itself when the user leaves. */
    fun updatePictureInPicture(ratio: Rational?, playing: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching { setPictureInPictureParams(params(ratio ?: Rational(16, 9), autoEnter = playing && ratio != null)) }
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Before Android 12 there's no automatic entry, so do it when the user goes Home
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) enterPictureInPicture()
    }

    private fun params(ratio: Rational, autoEnter: Boolean): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder().setAspectRatio(clamp(ratio))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setAutoEnterEnabled(autoEnter).setSeamlessResizeEnabled(true)
        return builder.build()
    }

    /** Android refuses ratios wider than 2.39:1 or taller than 1:2.39. */
    private fun clamp(ratio: Rational): Rational {
        val value = ratio.toFloat()
        return when {
            value > 2.39f -> Rational(239, 100)
            value < 1 / 2.39f -> Rational(100, 239)
            else -> ratio
        }
    }
}
