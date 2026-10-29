package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginResponse(
    val message: String? = null,
    val username: String? = null,
    @SerialName("auth_token") val authToken: String,
    val user: GoogleUser? = null,
) {
    /** The account name, from a password sign-in or a Google one. */
    val account: String get() = username ?: user?.username.orEmpty()
}

@Serializable
data class GoogleUser(
    val email: String? = null,
    val name: String? = null,
    val picture: String? = null,
    val username: String? = null,
)

@Serializable
data class GoogleConfig(@SerialName("client_id") val clientId: String? = null)

@Serializable
data class AuthCheck(
    val authenticated: Boolean = false,
    val username: String? = null,
    @SerialName("user_picture") val userPicture: String? = null,
    @SerialName("is_admin") val isAdmin: Boolean = false,
)

/** A file or folder as GET /files returns it. */
@Serializable
data class FileItem(
    val id: String,
    @SerialName("file_name") val name: String,
    @SerialName("file_type") val type: String? = null,
    @SerialName("file_size") val size: Long? = null,
    @SerialName("file_path") val path: String = "/",
    @SerialName("modified_date") val modified: String? = null,
    val thumbnail: String? = null,
    @SerialName("file_unique_id") val uniqueId: String? = null,
    val starred: Boolean = false,
    val trashed: Boolean = false,
    @SerialName("trashed_at") val trashedAt: String? = null,
    @SerialName("original_path") val originalPath: String? = null,
    @SerialName("is_split") val isSplit: Boolean = false,
    @SerialName("is_vault") val isVault: Boolean = false,
    /** When a photo or video was taken (sent by the phone backup); null for other uploads. */
    @SerialName("taken_at") val takenAt: String? = null,
    /** Protected from deletion (the item itself): it can't be trashed or deleted until protection is removed. */
    val protected: Boolean = false,
    /** The name of a protected folder this item is inside (so it can't be deleted either); null when none. */
    @SerialName("protected_by") val protectedBy: String? = null,
    /** A folder's colour name (see [FolderColors]); null is the default colour. */
    val color: String? = null,
) {
    /** The date for timelines: when it was taken, else when it was uploaded. */
    val timelineDate: String? get() = takenAt ?: modified
    val isFolder: Boolean get() = type == "folder"
    val kind: FileKind get() = FileKinds.of(this)
    /** Can't be trashed or deleted: protected itself or inside a protected folder. */
    val isProtected: Boolean get() = protected || protectedBy != null
    /** In the Private Vault: never named or remembered outside it (Continue watching, lock screen). */
    val inVault: Boolean get() = isVault || TeleStoreApi.inVault(path)
}

@Serializable
data class Pagination(
    val page: Int = 1,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("total_items") val totalItems: Int = 0,
    @SerialName("total_pages") val totalPages: Int = 1,
    @SerialName("has_next") val hasNext: Boolean = false,
    @SerialName("has_prev") val hasPrev: Boolean = false,
)

@Serializable
data class FilePage(
    val files: List<FileItem> = emptyList(),
    val pagination: Pagination? = null,
)

@Serializable
data class MessageReply(val message: String? = null)

@Serializable
data class StarReply(val starred: Boolean = false)

enum class SortBy(val wire: String) { NAME("name"), DATE("date"), SIZE("size"), TAKEN("taken") }

/** What a folder holds, counting its subfolders (GET /folders/stats). */
@Serializable
data class FolderStats(
    @SerialName("total_size") val size: Long = 0,
    @SerialName("total_files") val files: Int = 0,
    @SerialName("total_subfolders") val folders: Int = 0,
) {
    /** "1,240 files · 35 folders" (the size is formatted by the app). */
    val counts: String get() = listOfNotNull(
        plural(files, "file"),
        folders.takeIf { it > 0 }?.let { plural(it, "folder") },
    ).joinToString(" · ")

    private fun plural(n: Int, word: String) = "%,d %s".format(java.util.Locale.US, n, if (n == 1) word else word + "s")
}
