package com.backendforge.telestore.core

import okhttp3.HttpUrl

/**
 * Addresses for streaming, downloading and thumbnails. Players and image loaders can't always
 * send headers, so these carry the token in the address, which the server accepts.
 */
class MediaUrls(private val baseUrl: HttpUrl, private val token: () -> String?) {
    /** The file itself, with Range support: plays directly in ExoPlayer and resumes downloads. */
    fun file(item: FileItem, inline: Boolean = true): HttpUrl = baseUrl.newBuilder()
        .addPathSegment("dl")
        .addPathSegment(item.name)
        .addQueryParameter("file_id", item.id)
        .apply { if (inline) addQueryParameter("inline", "1") }
        .withToken("token")
        .build()

    /** A lower quality or another audio track, converted by the server (only when needed). */
    fun converted(item: FileItem, quality: String? = null, audioTrack: Int? = null, startSeconds: Double? = null): HttpUrl =
        baseUrl.newBuilder()
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

    /** Resolution, audio tracks and subtitles of a video. */
    fun info(item: FileItem): HttpUrl = baseUrl.newBuilder()
        .addPathSegments("media/info")
        .addPathSegment(item.name)
        .addQueryParameter("file_id", item.id)
        .withToken("token")
        .build()

    /** The small preview image Telegram made, or null when the file has none. */
    fun thumbnail(item: FileItem): HttpUrl? = item.thumbnail?.takeIf { it.isNotBlank() }?.let {
        baseUrl.newBuilder().addPathSegments("files/thumbnail").addPathSegment(it).withToken("auth_token").build()
    }

    /**
     * A preview the server makes from the original, for photos and videos Telegram has no
     * thumbnail for (HEIC, big photos, files sent as documents). Null for other kinds.
     */
    fun preview(item: FileItem): HttpUrl? = item.takeIf { it.kind == FileKind.PHOTO || it.kind == FileKind.VIDEO }?.let {
        baseUrl.newBuilder().addPathSegments("files/preview").addPathSegment(it.id).withToken("token").build()
    }

    /** What to show for a file: Telegram's thumbnail when there is one, else the server preview. */
    fun picture(item: FileItem): HttpUrl? = if (item.isFolder) null else thumbnail(item) ?: preview(item)

    private fun HttpUrl.Builder.withToken(name: String): HttpUrl.Builder = apply {
        token()?.let { addQueryParameter(name, it) }
    }
}
