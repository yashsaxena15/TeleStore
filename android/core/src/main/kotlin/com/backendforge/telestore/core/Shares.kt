package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Sharing, like Google Drive: a file or folder shared with other TeleStore accounts as viewer or
 * editor, and by a view-only link. See docs/sharing-api.md.
 */

/** A file or folder as shown in sharing views. [path] is the folder it sits in, relative to the shared folder ("" = directly inside). */
@Serializable
data class ShareItem(
    val id: String,
    val name: String = "",
    val type: String = "document",
    val size: Long = 0,
    @SerialName("modified_date") val modified: String? = null,
    @SerialName("taken_at") val takenAt: String? = null,
    val duration: Double? = null,
    @SerialName("has_thumb") val hasThumb: Boolean = false,
    val path: String = "",
) {
    val isFolder: Boolean get() = type == "folder"

    /**
     * The item as a [FileItem] so the app's rows, viewers and players can show it. With [shareId]
     * its addresses go through the share (see [MediaUrls]).
     */
    fun toFileItem(shareId: String? = null): FileItem = FileItem(
        id = id,
        name = name,
        type = type,
        size = size,
        path = path,
        modified = modified,
        takenAt = takenAt,
        duration = duration,
        // Any non-blank value makes the rows ask for a picture; the share's thumb address is used
        thumbnail = if (hasThumb && !isFolder) SHARE_THUMB else null,
        shareId = shareId,
    )

    companion object {
        internal const val SHARE_THUMB = "share"
    }
}

enum class ShareRole(val wire: String, val label: String) {
    VIEWER("viewer", "Viewer"),
    EDITOR("editor", "Editor");

    companion object {
        fun of(wire: String?): ShareRole = entries.firstOrNull { it.wire == wire } ?: VIEWER
    }
}

/** "Anyone with the link" for an item. */
@Serializable
data class ShareLink(
    val enabled: Boolean = false,
    val token: String = "",
    @SerialName("allow_download") val allowDownload: Boolean = true,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("max_downloads") val maxDownloads: Int? = null,
    val downloads: Int = 0,
    /** active, off, expired or used_up. */
    val state: String = "active",
)

@Serializable
data class ShareMember(
    @SerialName("user_id") val userId: String,
    val username: String = "",
    val name: String = "",
    val email: String? = null,
    val role: String = "viewer",
) {
    val shareRole: ShareRole get() = ShareRole.of(role)
}

/** What the Share dialog shows. */
@Serializable
data class ShareView(
    @SerialName("share_id") val shareId: String? = null,
    val item: ShareItem,
    val link: ShareLink? = null,
    val members: List<ShareMember> = emptyList(),
)

@Serializable
data class ShareOwner(val username: String? = null, val name: String = "")

/** One row of Shared by me. [members] is how many people it's shared with. */
@Serializable
data class MyShare(
    @SerialName("share_id") val shareId: String,
    val item: ShareItem,
    val trashed: Boolean = false,
    val link: ShareLink? = null,
    val members: Int = 0,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class SharedByMe(val shares: List<MyShare> = emptyList())

/** One row of Shared with me. */
@Serializable
data class ShareWithMe(
    @SerialName("share_id") val shareId: String,
    val role: String = "viewer",
    val owner: ShareOwner = ShareOwner(),
    val item: ShareItem,
    @SerialName("shared_at") val sharedAt: String? = null,
) {
    val shareRole: ShareRole get() = ShareRole.of(role)
}

@Serializable
data class SharedWithMe(val shares: List<ShareWithMe> = emptyList())

/** A folder inside a share ([path] relative to the shared folder). */
@Serializable
data class ShareBrowse(
    @SerialName("share_id") val shareId: String = "",
    val role: String = "viewer",
    val owner: ShareOwner = ShareOwner(),
    val root: ShareItem,
    val path: String = "",
    val items: List<ShareItem> = emptyList(),
) {
    val shareRole: ShareRole get() = ShareRole.of(role)
}

/**
 * Changes to an item's link. Null fields keep what's there; [clearExpiry] and [clearLimit]
 * remove the expiry date and the download limit.
 */
data class LinkSettings(
    val enabled: Boolean = true,
    val allowDownload: Boolean? = null,
    /** ISO date-time. */
    val expiresAt: String? = null,
    val clearExpiry: Boolean = false,
    val maxDownloads: Int? = null,
    val clearLimit: Boolean = false,
)
