package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** How deleting a protected item is confirmed (GET /files/protection). */
@Serializable
data class ProtectionMethod(
    /** "password", "email" or "none" (no password and no email: set a password in Account first). */
    val method: String = "none",
    /** The account's email with most of it hidden ("y•••@gmail.com"), for "email". */
    @SerialName("email_hint") val emailHint: String? = null,
) {
    val usesPassword: Boolean get() = method == "password"
    val usesEmail: Boolean get() = method == "email"
}

/** A short-lived token that lets protected items be deleted (many requests, until it expires). */
@Serializable
data class UnlockReply(
    @SerialName("unlock_token") val unlockToken: String,
    @SerialName("expires_in") val expiresIn: Long = 300,
)

@Serializable
internal data class ProtectReply(val protected: Boolean = false)

@Serializable
internal data class ColorReply(val color: String? = null)

/** Folder colours, the same names and shades as the website. */
object FolderColors {
    /** Colour name → ARGB, in the order the picker shows them. */
    val palette: Map<String, Long> = linkedMapOf(
        "red" to 0xFFEF4444,
        "orange" to 0xFFF97316,
        "yellow" to 0xFFEAB308,
        "green" to 0xFF22C55E,
        "teal" to 0xFF14B8A6,
        "blue" to 0xFF3B82F6,
        "purple" to 0xFFA855F7,
        "grey" to 0xFF6B7280,
    )

    val names: List<String> get() = palette.keys.toList()

    /** The ARGB for [name], or null for the default colour (or a name this app doesn't know). */
    fun argb(name: String?): Long? = name?.lowercase()?.let { palette[if (it == "gray") "grey" else it] }

    /** "Red", "Grey"… for the picker. */
    fun label(name: String): String = name.replaceFirstChar { it.uppercase() }
}

/** What a delete over several items came to. */
data class ProtectedOutcome<T>(
    val done: List<T>,
    /** Protected items left alone because the confirmation was cancelled. */
    val kept: List<T>,
    /** Items that failed for another reason, with the error. */
    val failed: List<Pair<T, Throwable>>,
) {
    val firstError: Throwable? get() = failed.firstOrNull()?.second
}

/**
 * Deletes (or trashes) items, asking for confirmation at most once: every item is tried; those the
 * server refuses as protected (423) are retried with the token [unlock] returns for the first
 * refusal's message. [unlock] returning null (cancelled) keeps them.
 */
object ProtectedDelete {
    suspend fun <T> run(
        items: List<T>,
        token: String? = null,
        unlock: suspend (message: String) -> String?,
        action: suspend (item: T, unlockToken: String?) -> Unit,
    ): ProtectedOutcome<T> {
        val done = mutableListOf<T>()
        val failed = mutableListOf<Pair<T, Throwable>>()
        val refused = mutableListOf<T>()
        var message: String? = null
        for (item in items) {
            try {
                action(item, token)
                done += item
            } catch (e: ProtectedException) {
                if (message == null) message = e.message
                refused += item
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                failed += item to e
            }
        }
        if (refused.isEmpty()) return ProtectedOutcome(done, emptyList(), failed)
        val unlocked = unlock(message ?: "This is protected. Confirm to delete it.")
            ?: return ProtectedOutcome(done, refused, failed)
        for (item in refused) {
            try {
                action(item, unlocked)
                done += item
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                failed += item to e
            }
        }
        return ProtectedOutcome(done, emptyList(), failed)
    }
}
