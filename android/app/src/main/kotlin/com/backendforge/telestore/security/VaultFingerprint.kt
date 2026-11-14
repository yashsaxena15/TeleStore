package com.backendforge.telestore.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Opening the Private Vault with a fingerprint. The vault PIN is kept on this phone, encrypted with
 * a key in the phone's secure hardware that only works right after a fingerprint check, so the PIN
 * can't be read without the finger, not even by someone holding the unlocked phone. The server
 * still gets the PIN as before. Adding a new fingerprint to the phone makes the key unusable (so a
 * newly added finger can't open the vault); then the PIN is asked once and it can be turned on again.
 *
 * One saved PIN per server and account.
 */
class VaultFingerprint(context: Context, private val account: String) {
    private val prefs = context.getSharedPreferences("vault_fingerprint", Context.MODE_PRIVATE)
    private val alias = "vault_pin_" + account.hashCode().toUInt().toString(16)

    /** Turned on for this account (a PIN is saved). */
    val enabled: Boolean get() = prefs.getString("pin_$alias", null) != null

    /** The user said "Not now" to turning it on; asked again only from Vault settings. */
    var declined: Boolean
        get() = prefs.getBoolean("declined_$alias", false)
        set(value) = prefs.edit().putBoolean("declined_$alias", value).apply()

    /** Forgets the saved PIN and its key (turned off, the PIN changed, or the key stopped working). */
    fun forget() {
        prefs.edit().remove("pin_$alias").remove("iv_$alias").apply()
        runCatching { keyStore().deleteEntry(alias) }
    }

    /** Asks for the fingerprint, then saves [pin]. [done] gets null on success, else why not. */
    fun enable(activity: FragmentActivity, pin: String, done: (String?) -> Unit) {
        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, newKey()) }
        } catch (e: Exception) {
            return done("This phone can't keep the PIN safely: ${e.message}")
        }
        prompt(activity, "Use fingerprint for the vault", "Touch the sensor to turn it on", cipher, done) { c ->
            val sealed = c.doFinal(pin.toByteArray())
            prefs.edit()
                .putString("pin_$alias", Base64.encodeToString(sealed, Base64.NO_WRAP))
                .putString("iv_$alias", Base64.encodeToString(c.iv, Base64.NO_WRAP))
                .putBoolean("declined_$alias", false)
                .apply()
            null
        }
    }

    /** Asks for the fingerprint and gives back the PIN. [done] gets (pin, null) or (null, why not);
     *  (null, null) when the user chose to type the PIN instead. */
    fun unlock(activity: FragmentActivity, done: (pin: String?, problem: String?) -> Unit) {
        val sealed = prefs.getString("pin_$alias", null)
        val iv = prefs.getString("iv_$alias", null)
        if (sealed == null || iv == null) return done(null, null)
        val cipher = try {
            val key = keyStore().getKey(alias, null) as? SecretKey ?: throw KeyPermanentlyInvalidatedException()
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))) }
        } catch (e: KeyPermanentlyInvalidatedException) {
            forget()
            return done(null, "A fingerprint was added or removed on this phone, so enter your PIN once. You can then turn fingerprint on again.")
        } catch (e: Exception) {
            forget()
            return done(null, "Fingerprint unlock stopped working on this phone. Enter your PIN.")
        }
        var pin: String? = null
        prompt(activity, "Open Private Vault", "Touch the sensor", cipher, { problem -> done(pin, problem) }) { c ->
            pin = String(c.doFinal(Base64.decode(sealed, Base64.NO_WRAP)))
            null
        }
    }

    private fun prompt(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        cipher: Cipher,
        done: (String?) -> Unit,
        use: (Cipher) -> String?,
    ) {
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val c = result.cryptoObject?.cipher ?: return done("The fingerprint check didn't finish. Try again.")
                done(runCatching { use(c) }.getOrElse { "Couldn't read the saved PIN: ${it.message}" })
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                val chosePin = errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON || errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                done(if (chosePin) null else errString.toString())
            }
        }
        runCatching {
            BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).authenticate(
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText("Use PIN")
                    .setAllowedAuthenticators(BIOMETRIC_STRONG)
                    .build(),
                BiometricPrompt.CryptoObject(cipher),
            )
        }.onFailure { done(it.message ?: "This phone can't ask for a fingerprint.") }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun newKey(): SecretKey {
        runCatching { keyStore().deleteEntry(alias) }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"

        /** Null when this phone has a fingerprint (or other strong biometric) set up; otherwise why not. */
        fun unavailableReason(context: Context): String? =
            when (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)) {
                BiometricManager.BIOMETRIC_SUCCESS -> null
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Add a fingerprint in your phone's settings first."
                else -> "This phone has no fingerprint sensor the vault can use."
            }
    }
}
