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
) {
    val isFolder: Boolean get() = type == "folder"
    val kind: FileKind get() = FileKinds.of(this)
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

enum class SortBy(val wire: String) { NAME("name"), DATE("date"), SIZE("size") }
