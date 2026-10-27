package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Something that happened on the server (a leech finished, a file arrived in the Telegram
 * Inbox, a new sign-in…). The app checks for new ones and shows them as phone notifications;
 * there is no push service.
 */
@Serializable
data class ServerNotification(
    val id: String,
    val kind: String = "",
    val title: String = "",
    val body: String = "",
    val target: NotificationTarget? = null,
    @SerialName("created_at") val createdAt: String? = null,
    val read: Boolean = false,
)

/** Where tapping a notification goes: "transfers", "folder" (with [path]), "file", "playlists" or "settings". */
@Serializable
data class NotificationTarget(val type: String = "", val path: String? = null, val id: String? = null)

@Serializable
data class NotificationList(
    val items: List<ServerNotification> = emptyList(),
    val unread: Int = 0,
    val latest: String? = null,
)

@Serializable
internal data class UnreadReply(val unread: Int = 0)

/** A place this account is signed in (Settings › Your devices). */
@Serializable
data class SignedInDevice(
    val id: String,
    val name: String = "",
    /** "app" or "browser". */
    val kind: String = "browser",
    /** "password" or "google". */
    val method: String = "password",
    @SerialName("signed_in_at") val signedInAt: String? = null,
    @SerialName("last_seen") val lastSeen: String? = null,
    /** The device asking: it can't be signed out from the list. */
    val current: Boolean = false,
)

@Serializable
internal data class DevicesReply(val devices: List<SignedInDevice> = emptyList())

@Serializable
internal data class SignedOutReply(@SerialName("signed_out") val signedOut: Int = 0)

/** Every kind of notification, each with its own switch in Settings › Notifications. */
enum class NotificationKind(val wire: String, val label: String, val detail: String) {
    PHONE_TRANSFERS("phone_transfers", "Uploads and downloads", "Finished or failed on this phone"),
    OFFLINE("offline", "Offline files", "Saved for offline, or not enough space"),
    BACKUP("backup", "Photo backup", "When the backup runs into a problem"),
    TRANSFER("transfer", "Server transfers", "Links and torrents the server saves for you"),
    MEDIA("media", "Video downloads", "YouTube and other video links"),
    INSTAGRAM("instagram", "Instagram", "Posts and reels saved from Instagram"),
    PLAYLIST_SYNC("playlist_sync", "Synced playlists", "New videos found in a playlist you follow"),
    INBOX("inbox", "Telegram Inbox", "Files sent to your Telegram Inbox"),
    STORAGE("storage", "Storage", "When your storage is almost full"),
    SIGN_IN("sign_in", "New sign-ins", "When your account is signed in somewhere new");

    companion object {
        fun of(wire: String): NotificationKind? = entries.firstOrNull { it.wire == wire }
    }
}

object NotificationRules {
    /** At most this many separate notifications per check; more become one summary. */
    const val MAX_SHOWN = 3

    /**
     * Which of [items] (newest first, from a check after the last seen id) the phone should show,
     * oldest first, given the switches the user turned off. Already-read ones are skipped (seen on
     * the website), and unknown kinds are shown (a newer server may add some).
     */
    fun toShow(items: List<ServerNotification>, off: Set<String>): List<ServerNotification> =
        items.filter { !it.read && it.kind !in off }.reversed()

    /** The id to remember after a check: the newest seen, or the previous one when nothing came. */
    fun nextSeen(previous: String?, list: NotificationList): String? = list.items.firstOrNull()?.id ?: list.latest ?: previous
}

/** What to change in a folder kept offline: files to save and saved copies to delete. */
data class OfflineDiff(val add: List<FileItem>, val remove: Set<String>)

object OfflineSync {
    /** Compares what the server has in the folder with what is saved for it. */
    fun diff(server: List<FileItem>, saved: Set<String>): OfflineDiff {
        val files = server.filter { !it.isFolder && !it.trashed && !it.isVault }
        val ids = files.map { it.id }.toSet()
        return OfflineDiff(add = files.filter { it.id !in saved }, remove = saved - ids)
    }

    /** True when [needed] bytes fit while leaving [reserve] free on the phone. */
    fun fits(needed: Long, free: Long, reserve: Long = RESERVE_BYTES): Boolean = needed <= free - reserve

    /** Space kept free for the phone itself (offline saves stop before it). */
    const val RESERVE_BYTES = 500L * 1024 * 1024

    /** Below this much free space the app warns. */
    const val LOW_SPACE_BYTES = 1024L * 1024 * 1024
}
