package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** How removing protection is confirmed (GET /files/protection). */
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

/** A short-lived, single-use token that removes protection from one item (POST /files/protect). */
@Serializable
data class UnlockReply(
    @SerialName("unlock_token") val unlockToken: String,
    @SerialName("expires_in") val expiresIn: Long = 120,
)

/** POST /files/trash/empty: protected items stay in the trash; [kept] counts them. */
@Serializable
data class EmptyTrashReply(
    val message: String? = null,
    val kept: Int = 0,
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
    /** Items the server refused because they're protected (or hold / sit in something protected). */
    val kept: List<T>,
    /** Items that failed for another reason, with the error. */
    val failed: List<Pair<T, Throwable>>,
    /** The server's words for the first refused item ("“passport.pdf” is protected. Remove protection first."). */
    val protectedMessage: String? = null,
) {
    val firstError: Throwable? get() = failed.firstOrNull()?.second
}

/**
 * Deletes (or trashes) items one by one. Protected items can't be deleted at all, so the server
 * refuses them (423) and they're simply kept; nothing is asked and nothing is retried.
 */
object ProtectedDelete {
    suspend fun <T> run(items: List<T>, action: suspend (item: T) -> Unit): ProtectedOutcome<T> {
        val done = mutableListOf<T>()
        val kept = mutableListOf<T>()
        val failed = mutableListOf<Pair<T, Throwable>>()
        var message: String? = null
        for (item in items) {
            try {
                action(item)
                done += item
            } catch (e: ProtectedException) {
                if (message == null) message = e.message
                kept += item
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                failed += item to e
            }
        }
        return ProtectedOutcome(done, kept, failed, message)
    }

    /** The snackbar line: "Moved to Trash 3 items", the server's message for one refused item, "2 protected items not deleted"… */
    fun message(outcome: ProtectedOutcome<*>, pastVerb: String): String {
        val done = outcome.done.size
        val kept = outcome.kept.size
        val failed = outcome.failed.size
        val error = outcome.firstError?.message
        val parts = mutableListOf<String>()
        if (done > 0 || (kept == 0 && failed == 0)) parts += "$pastVerb $done item${if (done != 1) "s" else ""}"
        if (kept > 0) {
            parts += if (kept == 1 && done == 0 && failed == 0 && outcome.protectedMessage != null) outcome.protectedMessage
            else "$kept protected item${if (kept != 1) "s" else ""} not deleted"
        }
        if (failed > 0) parts += if (done == 0 && kept == 0) "Failed: $error" else "$failed failed: $error"
        return parts.joinToString(", ")
    }

    /** Why Delete / Trash does nothing for a selection holding [count] protected items. */
    fun selectionBlockedMessage(count: Int): String = "$count protected — remove protection first"

    /** "Trash emptied", plus "2 protected items kept" when the server left some. */
    fun emptyTrashMessage(kept: Int): String =
        if (kept > 0) "Trash emptied, $kept protected item${if (kept != 1) "s" else ""} kept" else "Trash emptied"
}
