package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** GET /user/profile. */
@Serializable
data class UserProfile(
    val username: String = "",
    val email: String? = null,
    @SerialName("telegram_user_id") val telegramId: Long? = null,
    @SerialName("telegram_username") val telegramUsername: String? = null,
    @SerialName("telegram_first_name") val telegramFirstName: String? = null,
    @SerialName("telegram_last_name") val telegramLastName: String? = null,
) {
    val telegramName: String
        get() = telegramUsername?.let { "@$it" } ?: listOfNotNull(telegramFirstName, telegramLastName).joinToString(" ")

    /** What to call the person: their Telegram name, else the username. */
    val displayName: String
        get() = listOfNotNull(telegramFirstName, telegramLastName).joinToString(" ").ifBlank { username }
}

@Serializable
data class OwnerReply(@SerialName("is_owner") val isOwner: Boolean = false)

/** GET /user/features: what this account may use, so only those options are shown. */
@Serializable
data class Features(
    /** Compress to ZIP, Extract and Look inside (the owner can turn them off). */
    val archives: Boolean = true,
    @SerialName("is_owner") val isOwner: Boolean = false,
)

/** Settings › Server (owner only): GET/PUT /system/settings. */
@Serializable
data class ServerSettings(@SerialName("archives_enabled") val archivesEnabled: Boolean = true)

/** A user's archive tools: follow Settings › Server, or decide for this user. */
enum class ArchiveChoice(val wire: String, val label: String) {
    DEFAULT("default", "Follow server setting"),
    ALLOW("allow", "Always allow"),
    BLOCK("block", "Block");

    companion object {
        fun of(wire: String?): ArchiveChoice = entries.firstOrNull { it.wire == wire } ?: DEFAULT
    }
}

@Serializable
data class IndexChat(@SerialName("index_chat_id") val chatId: Long? = null)

/** POST /telegram/generate-verification: send [code] to [botUsername], or just open [link]. */
@Serializable
data class TelegramVerification(
    @SerialName("bot_username") val botUsername: String = "",
    @SerialName("verification_link") val link: String = "",
    val code: String = "",
) {
    /** Opens a chat picker in Telegram to add the bot to a group (the index chat). */
    val addToGroupLink: String get() = "https://t.me/$botUsername?startgroup=true"
}

/** A row of the owner's user list (GET /user). */
@Serializable
data class ManagedUser(
    val id: String,
    val username: String = "",
    val email: String? = null,
    @SerialName("telegram_username") val telegramUsername: String? = null,
    val active: Boolean = true,
    @SerialName("can_upload") val canUpload: Boolean = true,
    /** "default" (follows Settings › Server), "allow" or "block". */
    @SerialName("archives") val archives: String = "default",
    /** Whether compress and extract work for them right now. */
    @SerialName("archives_allowed") val archivesAllowed: Boolean = true,
    @SerialName("is_owner") val isOwner: Boolean = false,
    @SerialName("has_telegram") val hasTelegram: Boolean = false,
    @SerialName("has_index_chat") val hasIndexChat: Boolean = false,
    @SerialName("user_type") val userType: String? = null,
) {
    val name: String get() = username.ifBlank { email.orEmpty() }.ifBlank { "Unknown" }
    val isGoogle: Boolean get() = userType == "google"

    /** The owner and the built-in admin can't be turned off, limited or removed. */
    val locked: Boolean get() = isOwner || username == "admin"

    /** What they still need before they can upload, as the website says it. */
    val setup: String
        get() = when {
            !hasTelegram -> "Needs Telegram"
            !hasIndexChat -> "Needs index chat"
            else -> "Ready to upload"
        }
    val ready: Boolean get() = hasTelegram && hasIndexChat
}

@Serializable
data class ManagedUsers(val users: List<ManagedUser> = emptyList())

/** GET /transfers/remote/media/settings (yt-dlp, the owner's cookies, the bot-check helper). */
@Serializable
data class MediaSettings(
    val version: String = "",
    @SerialName("builtin_version") val builtinVersion: String? = null,
    val updated: Boolean = false,
    @SerialName("has_cookies") val hasCookies: Boolean = false,
    @SerialName("cookie_sites") val cookieSites: List<String> = emptyList(),
    /** "signed_in", "signed_out" or null (not checked). */
    @SerialName("youtube_sign_in") val youtubeSignIn: String? = null,
    @SerialName("pot_helper") val potHelper: Boolean = false,
) {
    val hasYouTube: Boolean get() = cookieSites.any { "youtube" in it }

    /** The cookies line, as the website words it. */
    val cookiesStatus: String
        get() = when {
            !hasCookies -> "No cookies. Most public videos download without them; cookies let the server use a signed-in account " +
                "for age-restricted and private videos, and YouTube asks it to prove it isn't a bot less often."
            else -> "Cookies for ${cookieSites.joinToString(", ").ifEmpty { "your sites" }}." + when {
                !hasYouTube -> ""
                youtubeSignIn == "signed_in" -> " YouTube confirmed the sign-in."
                youtubeSignIn == "signed_out" -> " YouTube says its cookies aren't signed in: export them again while signed in."
                else -> " YouTube couldn't be asked to confirm its sign-in just now."
            }
        }
}

/** A playlist or channel that downloads its new videos by itself. */
@Serializable
data class MediaSync(
    val id: String,
    val title: String? = null,
    val url: String? = null,
    @SerialName("is_channel") val isChannel: Boolean = false,
    val choice: JsonObject? = null,
    @SerialName("destination_label") val destination: String? = null,
    val enabled: Boolean = true,
    @SerialName("last_checked") val lastChecked: String? = null,
    @SerialName("last_new_count") val lastNewCount: Int = 0,
    @SerialName("last_error") val lastError: String? = null,
) {
    /** "Playlist · 1080p video · to /Home/Music" */
    val summary: String
        get() {
            val mode = choice?.get("mode")?.jsonPrimitive?.contentOrNull
            val what = if (mode == "audio") (choice["audio_format"]?.jsonPrimitive?.contentOrNull ?: "mp3").uppercase() else {
                val q = choice?.get("quality")?.jsonPrimitive?.contentOrNull
                if (q != null && q != "best") "${q}p video" else "Best video"
            }
            return listOfNotNull(if (isChannel) "Channel" else "Playlist", what, destination?.let { "to $it" }).joinToString(" · ")
        }
}

@Serializable
data class MediaSyncs(val syncs: List<MediaSync> = emptyList(), @SerialName("every_hours") val everyHours: Double = 6.0)

@Serializable
data class SyncCheck(val new: Int = 0)

/** The Instagram account the server uses for imports. [needsCode]: sign-in wants the 2FA code next. */
@Serializable
data class InstagramSession(
    val connected: Boolean = false,
    val username: String? = null,
    @SerialName("needs_2fa") val needsCode: Boolean = false,
)

/** Passwords are at least this long (the server checks too). */
const val MIN_PASSWORD = 6
