package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.Locale

/** What a pasted link is, which decides how the server fetches it. */
enum class LinkKind {
    /** Instagram post, reel or carousel. */
    INSTAGRAM,
    /** A video or audio site (YouTube, Facebook, X…): pick quality, video or audio. */
    MEDIA,
    /** Google Drive file or folder, a magnet, or a direct file link: the cloud leech. */
    LEECH;

    companion object {
        private val MEDIA_HOSTS = listOf(
            "youtube.com", "youtu.be", "music.youtube.com", "facebook.com", "fb.watch", "twitter.com", "x.com",
            "vimeo.com", "dailymotion.com", "dai.ly", "tiktok.com", "reddit.com", "v.redd.it", "soundcloud.com",
            "twitch.tv", "bilibili.com", "streamable.com", "jiosaavn.com", "linkedin.com", "pinterest.com", "threads.net",
        )

        fun detect(text: String): LinkKind? {
            val link = text.trim()
            if (link.startsWith("magnet:?", ignoreCase = true)) return LEECH
            val host = link.toHttpUrlOrNull()?.host?.lowercase(Locale.ROOT)?.removePrefix("www.")?.removePrefix("m.") ?: return null
            return when {
                host == "instagram.com" || host.endsWith(".instagram.com") -> INSTAGRAM
                MEDIA_HOSTS.any { host == it || host.endsWith(".$it") } -> MEDIA
                else -> LEECH
            }
        }

        /** The first link inside shared text ("Watch this! https://youtu.be/…"). */
        fun firstLink(text: String): String? =
            Regex("""(magnet:\?\S+|https?://\S+)""", RegexOption.IGNORE_CASE).find(text)?.value?.trimEnd('.', ',', ')', ']', '"', '\'')
    }
}

@Serializable
data class AddReply(val message: String? = null, val count: Int = 0)

@Serializable
data class VideoOption(
    val value: String,
    val height: Int? = null,
    val fps: Int = 0,
    val hdr: Boolean = false,
    val size: Long = 0,
    val label: String? = null,
)

@Serializable
data class AudioOption(val id: String? = null, val codec: String = "", val abr: Int = 0, val size: Long = 0)

@Serializable
data class MediaOptions(val video: List<VideoOption> = emptyList(), val audio: List<AudioOption> = emptyList())

@Serializable
data class MediaEntry(val index: Int, val title: String = "", val duration: Double? = null)

/** POST /transfers/remote/media/preview: one video, or a playlist and its videos. */
@Serializable
data class MediaPreview(
    val kind: String = "video",
    @SerialName("is_channel") val isChannel: Boolean = false,
    val title: String = "",
    val uploader: String? = null,
    val site: String? = null,
    val duration: Double? = null,
    val options: MediaOptions? = null,
    val count: Int = 1,
    /** A data: URL (the server fetched it, so the app never contacts the video site). */
    val thumbnail: String? = null,
    val entries: List<MediaEntry> = emptyList(),
) {
    val isPlaylist: Boolean get() = kind == "playlist"
}

@Serializable
data class InstagramItem(val index: Int, @SerialName("is_video") val isVideo: Boolean = false)

@Serializable
data class InstagramPreview(
    val shortcode: String = "",
    val owner: String = "",
    val caption: String? = null,
    val date: String? = null,
    val thumbnail: String? = null,
    val items: List<InstagramItem> = emptyList(),
)

/** One line of a quality or audio list: what to show, and what to send. */
data class Choice(val value: String, val label: String)

data class ChoiceGroup(val title: String, val choices: List<Choice>)

/** The website's quality and audio lists (frontend/src/features/cloud/mediaChoices.js), kept the same. */
object MediaChoices {
    private val LADDER = listOf(4320, 2160, 1440, 1080, 720, 480, 360, 240, 144)
    private val COMPAT = Choice("compat", "Most compatible (H.264, up to 1080p)")

    private fun size(bytes: Long) = if (bytes > 0) " · ~${Bytes.short(bytes)}" else ""
    private fun height(v: VideoOption) = "${v.height}p${if (v.hdr) " HDR" else ""}${if (v.fps > 30) " ${v.fps}fps" else ""}"

    fun video(preview: MediaPreview?): List<Choice> {
        val video = if (preview?.kind == "video") preview.options?.video.orEmpty() else emptyList()
        if (video.isEmpty()) return listOf(Choice("best", "Best available")) + LADDER.map { Choice(it.toString(), "Up to ${it}p") } + COMPAT
        if (video.first().height == null) {
            // Sites that only name their versions (Facebook: HD, SD)
            return listOf(Choice("best", "Best available")) + video.map { Choice(it.value, "${it.label ?: it.value}${size(it.size)}") }
        }
        return listOf(Choice("best", "Best available (${height(video.first())})")) + video.map { Choice(it.value, "${height(it)}${size(it.size)}") } + COMPAT
    }

    fun audio(preview: MediaPreview?): List<ChoiceGroup> {
        val sources = if (preview?.kind == "video") preview.options?.audio.orEmpty() else emptyList()
        val best = sources.firstOrNull()
        val original = listOf(Choice("original", if (best != null) "Best original (${best.codec} ${best.abr} kbps)" else "Best original quality")) +
            sources.map { Choice("src:${it.id}", "${it.codec} ${it.abr} kbps${size(it.size)}") }
        val convert = listOf("320", "256", "192", "128").map { Choice("mp3:$it", "MP3 $it kbps") } +
            listOf("256", "192", "128").map { Choice("m4a:$it", "M4A (AAC) $it kbps") } +
            Choice("flac", "FLAC (lossless file)") + Choice("wav", "WAV (uncompressed)")
        return listOf(ChoiceGroup("Original, no conversion (recommended)", original), ChoiceGroup("Convert", convert))
    }

    /** The "choice" object the server expects. [subtitles]: null, "en", "hi" or "all". */
    fun choice(audioMode: Boolean, quality: String, audio: String, subtitles: String?): JsonObject = buildJsonObject {
        if (!audioMode) {
            put("mode", "video")
            put("quality", quality)
            subtitles?.let { put("subtitles", it) }
            return@buildJsonObject
        }
        put("mode", "audio")
        when {
            audio.startsWith("src:") -> {
                put("audio_format", "original")
                put("audio_source", audio.removePrefix("src:"))
            }
            ":" in audio -> {
                put("audio_format", audio.substringBefore(':'))
                put("audio_bitrate", audio.substringAfter(':'))
            }
            else -> put("audio_format", audio)
        }
    }
}

/** 1.2 GB, 340 MB (1024-based like the website's link dialog). */
object Bytes {
    fun short(bytes: Long): String {
        val units = listOf("B", "KB", "MB", "GB", "TB")
        var value = bytes.toDouble()
        var i = 0
        while (value >= 1024 && i < units.lastIndex) {
            value /= 1024
            i++
        }
        return if (value >= 10 || i == 0) "${value.toLong()} ${units[i]}" else String.format(Locale.US, "%.1f %s", value, units[i])
    }
}
