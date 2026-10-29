package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl

/** One audio or subtitle track of a video, as GET /media/info describes it. */
@Serializable
data class MediaTrack(
    val index: Int = 0,
    val codec: String? = null,
    val language: String? = null,
    val title: String? = null,
) {
    val label: String get() = title?.takeIf { it.isNotBlank() } ?: language?.takeIf { it.isNotBlank() } ?: "Track ${index + 1}"
}

/** GET /media/info: the server's ffprobe of a video. */
@Serializable
data class MediaInfo(
    val width: Int? = null,
    val height: Int? = null,
    @SerialName("video_codec") val videoCodec: String? = null,
    val duration: Double = 0.0,
    @SerialName("audio_tracks") val audioTracks: List<MediaTrack> = emptyList(),
    @SerialName("subtitle_tracks") val subtitleTracks: List<MediaTrack> = emptyList(),
) {
    val durationMs: Long get() = (duration * 1000).toLong()
}

/** Picture quality. ORIGINAL plays the file itself; the others ask the server to make a smaller copy. */
enum class Quality(val wire: String?, val label: String, val height: Int?) {
    ORIGINAL(null, "Original", null),
    P1080("1080p", "1080p", 1080),
    P720("720p", "720p", 720),
    P480("480p", "480p", 480),
    P360("360p", "360p", 360),
    P240("240p", "240p", 240);

    companion object {
        /** Original plus every smaller size (all of them when the video's height is unknown). */
        fun choicesFor(sourceHeight: Int?): List<Quality> =
            listOf(ORIGINAL) + entries.filter { it.height != null && (sourceHeight == null || it.height < sourceHeight) }

        /** What to fall back to when the phone can't decode the video itself: H.264 at up to 720p. */
        fun fallbackFor(sourceHeight: Int?): Quality =
            entries.firstOrNull { it.height != null && it.height <= 720 && (sourceHeight == null || it.height <= sourceHeight) } ?: P240
    }
}

/**
 * Where a video plays from.
 *
 * Direct: the file itself, with real seeking, every audio track and the embedded subtitles.
 * Converted: the server's ffmpeg stream (a smaller picture, or the same picture with AAC sound for
 * phones that can't play the original sound). It can't seek, so seeking starts a new stream at
 * that time and [startMs] is added to the player's position.
 */
data class VideoSource(val url: HttpUrl, val converted: Boolean, val startMs: Long)

object PlaybackPlan {
    fun source(
        media: MediaUrls,
        item: FileItem,
        quality: Quality,
        convert: Boolean,
        audioTrack: Int = 0,
        startMs: Long = 0,
    ): VideoSource =
        if (!convert && quality == Quality.ORIGINAL) {
            VideoSource(media.file(item), converted = false, startMs = 0)
        } else {
            val start = startMs.coerceAtLeast(0)
            VideoSource(
                media.converted(item, quality = quality.wire ?: "original", audioTrack = audioTrack, startSeconds = start / 1000.0),
                converted = true,
                startMs = start,
            )
        }

    /** The position to show: the converted stream starts at [VideoSource.startMs]. */
    fun shownPosition(source: VideoSource?, playerPositionMs: Long): Long =
        (source?.startMs ?: 0L) + playerPositionMs.coerceAtLeast(0)
}

/** The files to play one after another: the ones of the same kind, in the folder's order. */
object PlayQueue {
    fun around(items: List<FileItem>, start: FileItem): Pair<List<FileItem>, Int> {
        val kind = start.kind
        val same = items.filter { !it.isFolder && it.kind == kind }
        val index = same.indexOfFirst { it.id == start.id }
        return if (index >= 0) same to index else listOf(start) to 0
    }

    /** The name without its extension, for titles ("Softly.mp3" -> "Softly"). */
    fun title(item: FileItem): String {
        val dot = item.name.lastIndexOf('.')
        return if (dot > 0) item.name.substring(0, dot) else item.name
    }

    /** What the lock screen, notification and Bluetooth/car displays may show: a vault item's name stays private. */
    fun publicTitle(item: FileItem): String = if (!item.inVault) title(item) else if (item.kind == FileKind.AUDIO) "Private audio" else "Private video"

    /** The folder shown under the title outside the app; nothing for a vault item. */
    fun publicSubtitle(item: FileItem): String = if (item.inVault) "TeleStore" else item.path.trimEnd('/').substringAfterLast('/').ifEmpty { "TeleStore" }
}
