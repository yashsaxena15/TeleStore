package com.backendforge.telestore.ui.signin

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Asks Android for a Google ID token for [serverClientId] (the website's Google client ID, from
 * GET /auth/google/config). Returns null when the user closes the picker.
 */
suspend fun requestGoogleIdToken(activityContext: Context, serverClientId: String): String? {
    val option = GetGoogleIdOption.Builder()
        .setServerClientId(serverClientId)
        .setFilterByAuthorizedAccounts(false)
        .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    return try {
        val credential = CredentialManager.create(activityContext).getCredential(activityContext, request).credential
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            GoogleIdTokenCredential.createFrom(credential.data).idToken
        } else {
            throw IllegalStateException("Google didn't return an ID token.")
        }
    } catch (e: GetCredentialCancellationException) {
        null
    } catch (e: GetCredentialException) {
        throw IllegalStateException(e.message ?: "Google sign-in isn't available on this phone.", e)
    }
}
