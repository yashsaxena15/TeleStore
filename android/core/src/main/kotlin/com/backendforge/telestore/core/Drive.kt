package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CloudAccount(
    val id: String,
    val provider: String = "google_drive",
    @SerialName("account_name") val name: String? = null,
    @SerialName("account_email") val email: String? = null,
)

@Serializable
data class CloudAccounts(val accounts: List<CloudAccount> = emptyList())

@Serializable
data class DriveAuthUrl(@SerialName("auth_url") val url: String)

/** A file or folder in Google Drive (or one of its places: My Drive, Shared with me, Starred, Trash). */
@Serializable
data class DriveItem(
    val id: String,
    val name: String,
    val mimeType: String? = null,
    val size: Long = 0,
    val modified: String? = null,
    val thumbnailLink: String? = null,
    @SerialName("is_folder") val isFolder: Boolean = false,
    @SerialName("is_virtual") val isPlace: Boolean = false,
    val starred: Boolean = false,
    val trashed: Boolean = false,
) {
    val kind: FileKind get() = if (isFolder) FileKind.FOLDER else FileKinds.of(name)
}

@Serializable
data class DriveList(val items: List<DriveItem> = emptyList(), val nextPageToken: String? = null)

@Serializable
data class DriveQuota(val limit: Long = 0, val usage: Long = 0) {
    val usedFraction: Float get() = if (limit > 0) (usage.toFloat() / limit).coerceIn(0f, 1f) else 0f
}
