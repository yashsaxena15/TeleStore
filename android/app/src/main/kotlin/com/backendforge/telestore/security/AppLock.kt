package com.backendforge.telestore.security

import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.backendforge.telestore.data.AppSettings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * App lock: after the app has been in the background for a while (or after it starts), the
 * screen is covered until fingerprint, face or the phone's PIN unlocks it. The short delay lets
 * a file picker or the Share sheet come and go without locking.
 */
class AppLock(private val settings: AppSettings) {
    private val _locked = MutableStateFlow(settings.appLock)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()
    private var hiddenAt = 0L
    /** The phone's own prompt is up (its PIN screen can send the app to the background). */
    private var prompting = false

    /** The app went to the background. */
    fun onHidden() {
        if (!prompting) hiddenAt = SystemClock.elapsedRealtime()
    }

    /** The app came back: lock if it was away long enough. */
    fun onShown() {
        if (!settings.appLock || hiddenAt == 0L) return
        if (SystemClock.elapsedRealtime() - hiddenAt >= settings.appLockAfterSeconds * 1000L) _locked.value = true
        hiddenAt = 0L
    }

    fun turnedOff() {
        _locked.value = false
    }

    /** Shows the phone's own prompt; [done] gets null on success or why it didn't unlock. */
    fun prompt(activity: FragmentActivity, title: String = "Unlock TeleStore", done: (String?) -> Unit = {}) {
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                prompting = false
                _locked.value = false
                done(null)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                prompting = false
                done(errString.toString())
            }
        })
        prompting = true
        runCatching {
            prompt.authenticate(
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle("Use your fingerprint, face or phone PIN")
                    .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
                    .build(),
            )
        }.onFailure {
            prompting = false
            done(it.message ?: "This phone can't ask for a fingerprint or PIN.")
        }
    }

    companion object {
        /** Null when the phone can lock the app; otherwise what's missing. */
        fun unavailableReason(activity: FragmentActivity): String? =
            when (BiometricManager.from(activity).canAuthenticate(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)) {
                BiometricManager.BIOMETRIC_SUCCESS -> null
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Set a screen lock (PIN, pattern or fingerprint) on your phone first."
                else -> "This phone can't ask for a fingerprint or PIN."
            }
    }
}
