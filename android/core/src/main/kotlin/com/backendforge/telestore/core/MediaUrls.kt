package com.backendforge.telestore.core

import okhttp3.HttpUrl

/**
 * Addresses for streaming, downloading and thumbnails. Players and image loaders can't always
 * send headers, so these carry the token in the address, which the server accepts.
 *
 * Items opened from Shared with me ([FileItem.shareId]) go through the share's own routes, so
 * every viewer and player works for them unchanged.
 */
class MediaUrls(private val baseUrl: HttpUrl, private val token: () -> String?) {
    /** The file itself, with Range support: plays directly in ExoPlayer and resumes downloads. */
    fun file(item: FileItem, inline: Boolean = true): HttpUrl {
        item.shareId?.let { return shareFile(it, item.id, inline) }
        return baseUrl.newBuilder()
            .addPathSegment("dl")
            .addPathSegment(item.name)
            .addQueryParameter("file_id", item.id)
            .apply { if (inline) addQueryParameter("inline", "1") }
            .withToken("token")
            .build()
    }

    /** A lower quality or another audio track, converted by the server (only when needed). Shared files play as they are. */
    fun converted(item: FileItem, quality: String? = null, audioTrack: Int? = null, startSeconds: Double? = null): HttpUrl {
        item.shareId?.let { return shareFile(it, item.id, inline = true) }
        return baseUrl.newBuilder()
            .addPathSegments("media/stream")
            .addPathSegment(item.name)
            .addQueryParameter("file_id", item.id)
            .apply {
                quality?.let { addQueryParameter("quality", it) }
                audioTrack?.let { addQueryParameter("audio_track", it.toString()) }
                startSeconds?.let { addQueryParameter("start_time", it.toString()) }
            }
            .withToken("token")
            .build()
    }

    /** Resolution, audio tracks and subtitles of a video. */
    fun info(item: FileItem): HttpUrl = baseUrl.newBuilder()
        .addPathSegments("media/info")
        .addPathSegment(item.name)
        .addQueryParameter("file_id", item.id)
        .withToken("token")
        .build()

    /** The small preview image Telegram made, or null when the file has none. */
    fun thumbnail(item: FileItem): HttpUrl? {
        val thumb = item.thumbnail?.takeIf { it.isNotBlank() } ?: return null
        item.shareId?.let { return shareThumb(it, item.id) }
        return baseUrl.newBuilder().addPathSegments("files/thumbnail").addPathSegment(thumb).withToken("auth_token").build()
    }

    /**
     * A preview the server makes from the original, for photos and videos Telegram has no
     * thumbnail for (HEIC, big photos, files sent as documents). Null for other kinds, and for
     * shared files (their thumbnail address already falls back to a preview on the server).
     */
    fun preview(item: FileItem): HttpUrl? = item.takeIf { (it.kind == FileKind.PHOTO || it.kind == FileKind.VIDEO) && it.shareId == null }?.let {
        baseUrl.newBuilder().addPathSegments("files/preview").addPathSegment(it.id).withToken("token").build()
    }

    /** What to show for a file: Telegram's thumbnail when there is one, else the server preview. */
    fun picture(item: FileItem): HttpUrl? = if (item.isFolder) null else thumbnail(item) ?: preview(item)

    // ── Shared with me ─────────────────────────────────────────────────────────
    /** A file in a share; [inline] to play or view it. */
    fun shareFile(shareId: String, fileId: String, inline: Boolean = true): HttpUrl = shareUrl(shareId, "dl", fileId)
        .apply { if (inline) addQueryParameter("inline", "1") }
        .withToken("token")
        .build()

    /** A shared file's thumbnail (JPEG). */
    fun shareThumb(shareId: String, fileId: String): HttpUrl = shareUrl(shareId, "thumb", fileId).withToken("token").build()

    /** One zip part of a folder in a share ([path] relative to the shared folder). */
    fun shareZip(shareId: String, path: String = "", part: Int = 1): HttpUrl = shareUrl(shareId, "zip")
        .addQueryParameter("path", path)
        .addQueryParameter("part", part.toString())
        .withToken("token")
        .build()

    private fun shareUrl(shareId: String, vararg segments: String): HttpUrl.Builder =
        baseUrl.newBuilder().addPathSegment("shares").addPathSegment(shareId).apply { segments.forEach { addPathSegment(it) } }

    private fun HttpUrl.Builder.withToken(name: String): HttpUrl.Builder = apply {
        token()?.let { addQueryParameter(name, it) }
    }
}
