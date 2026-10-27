package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A playlist as GET /files/playlists lists it. "Liked music" has id [LIKED] and can't be renamed or deleted. */
@Serializable
data class Playlist(
    val id: String,
    val name: String,
    val kind: String = "user",
    val count: Int = 0,
    /** The file ids in order (for "already in this playlist" and the heart). */
    @SerialName("file_ids") val fileIds: List<String> = emptyList(),
    /** The first item, for the playlist's picture. */
    val cover: FileItem? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    /** The playable items, in order (only from GET /files/playlists/{id}). */
    val items: List<FileItem> = emptyList(),
    /** How many of the files sent were new (only from adding). */
    val added: Int? = null,
) {
    val isLiked: Boolean get() = kind == LIKED

    companion object {
        const val LIKED = "liked"
    }
}

@Serializable
internal data class PlaylistsReply(val playlists: List<Playlist> = emptyList())

@Serializable
internal data class LikeReply(val liked: Boolean = false)
