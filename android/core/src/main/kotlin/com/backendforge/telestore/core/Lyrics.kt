package com.backendforge.telestore.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.nio.charset.Charset

/** One line of lyrics; [timeMs] is null when the lyrics aren't synced. */
data class LyricLine(val timeMs: Long?, val text: String)

data class Lyrics(val lines: List<LyricLine>, val source: String) {
    val synced: Boolean get() = lines.any { it.timeMs != null }

    /** The line being sung at [positionMs] (-1 before the first one). */
    fun currentIndex(positionMs: Long): Int {
        if (!synced) return -1
        var found = -1
        lines.forEachIndexed { i, l -> if (l.timeMs != null && l.timeMs <= positionMs) found = i }
        return found
    }
}

/** The LRC format: "[mm:ss.xx] text", several stamps per line allowed, "[offset:+/-ms]". */
object Lrc {
    private val STAMP = Regex("""\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]""")
    private val WORD_STAMP = Regex("""<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>""")
    private val OFFSET = Regex("""\[offset:\s*([+-]?\d+)]""", RegexOption.IGNORE_CASE)

    fun parse(text: String, source: String): Lyrics? {
        val offset = OFFSET.find(text)?.groupValues?.get(1)?.toLongOrNull() ?: 0
        val timed = mutableListOf<LyricLine>()
        val plain = mutableListOf<LyricLine>()
        for (raw in text.lines()) {
            val stamps = STAMP.findAll(raw).toList()
            val words = raw.replace(STAMP, "").replace(WORD_STAMP, "").trim()
            if (stamps.isEmpty()) {
                // Header tags like [ar:…] aren't lyrics
                if (words.isNotEmpty() && !raw.trimStart().startsWith("[")) plain += LyricLine(null, words)
                continue
            }
            for (m in stamps) {
                val (min, sec, frac) = m.destructured
                val fracMs = when (frac.length) {
                    0 -> 0L
                    1 -> frac.toLong() * 100
                    2 -> frac.toLong() * 10
                    else -> frac.take(3).toLong()
                }
                // A positive offset shows the lyrics earlier
                val ms = (min.toLong() * 60_000 + sec.toLong() * 1000 + fracMs - offset).coerceAtLeast(0)
                timed += LyricLine(ms, words)
            }
        }
        val lines = if (timed.isNotEmpty()) timed.sortedBy { it.timeMs } else plain
        return if (lines.any { it.text.isNotBlank() }) Lyrics(lines, source) else null
    }

    /** Plain lyrics (no times), one line each. */
    fun plain(text: String, source: String): Lyrics? {
        val lines = text.lines().map { LyricLine(null, it.trim()) }.dropWhile { it.text.isEmpty() }.dropLastWhile { it.text.isEmpty() }
        return if (lines.isNotEmpty()) Lyrics(lines, source) else null
    }
}

/** What an MP3's ID3v2 tag says about the song. */
data class Id3Tags(val title: String? = null, val artist: String? = null, val album: String? = null, val lyrics: String? = null)

/** Reads the ID3v2.3/2.4 tag at the start of an MP3 (TIT2, TPE1, TALB, USLT). */
object Id3 {
    /** The whole tag's length in bytes from its 10-byte header, or null when there is no tag. */
    fun tagLength(header: ByteArray): Int? {
        if (header.size < 10 || header[0] != 'I'.code.toByte() || header[1] != 'D'.code.toByte() || header[2] != '3'.code.toByte()) return null
        return 10 + syncsafe(header, 6)
    }

    fun parse(bytes: ByteArray): Id3Tags? {
        val total = tagLength(bytes) ?: return null
        val version = bytes[3].toInt()
        if (version != 3 && version != 4) return null
        var pos = 10
        if (bytes[5].toInt() and 0x40 != 0) {
            // An extended header: skip it
            pos += if (version == 4) syncsafe(bytes, pos) else 4 + int32(bytes, pos)
        }
        val end = minOf(total, bytes.size)
        var tags = Id3Tags()
        while (pos + 10 <= end) {
            val id = String(bytes, pos, 4, Charsets.ISO_8859_1)
            if (id[0] == '\u0000') break
            val size = if (version == 4) syncsafe(bytes, pos + 4) else int32(bytes, pos + 4)
            val start = pos + 10
            if (size <= 0 || start + size > end) break
            val body = bytes.copyOfRange(start, start + size)
            tags = when (id) {
                "TIT2" -> tags.copy(title = text(body))
                "TPE1" -> tags.copy(artist = text(body))
                "TALB" -> tags.copy(album = text(body))
                "USLT" -> tags.copy(lyrics = tags.lyrics ?: lyricsText(body))
                else -> tags
            }
            pos = start + size
        }
        return tags
    }

    private fun syncsafe(b: ByteArray, at: Int): Int =
        ((b[at].toInt() and 0x7f) shl 21) or ((b[at + 1].toInt() and 0x7f) shl 14) or ((b[at + 2].toInt() and 0x7f) shl 7) or (b[at + 3].toInt() and 0x7f)

    private fun int32(b: ByteArray, at: Int): Int =
        ((b[at].toInt() and 0xff) shl 24) or ((b[at + 1].toInt() and 0xff) shl 16) or ((b[at + 2].toInt() and 0xff) shl 8) or (b[at + 3].toInt() and 0xff)

    private fun charset(encoding: Int): Charset = when (encoding) {
        1 -> Charsets.UTF_16
        2 -> Charsets.UTF_16BE
        3 -> Charsets.UTF_8
        else -> Charsets.ISO_8859_1
    }

    private fun text(body: ByteArray): String? {
        if (body.isEmpty()) return null
        return String(body, 1, body.size - 1, charset(body[0].toInt())).trim('\u0000', ' ', '﻿').ifEmpty { null }
    }

    /** USLT: encoding, 3-letter language, a description ended by a null, then the lyrics. */
    private fun lyricsText(body: ByteArray): String? {
        if (body.size < 5) return null
        val enc = body[0].toInt()
        val wide = enc == 1 || enc == 2
        var i = 4
        if (wide) {
            while (i + 1 < body.size && !(body[i].toInt() == 0 && body[i + 1].toInt() == 0)) i += 2
            i += 2
        } else {
            while (i < body.size && body[i].toInt() != 0) i++
            i += 1
        }
        if (i >= body.size) return null
        return String(body, i, body.size - i, charset(enc)).trim('\u0000', '﻿').trim().ifEmpty { null }
    }
}

@Serializable
private data class LrclibTrack(
    @SerialName("syncedLyrics") val synced: String? = null,
    @SerialName("plainLyrics") val plain: String? = null,
    val instrumental: Boolean = false,
)

/**
 * Finds a song's lyrics: inside the file (ID3), then a .lrc file with the same name in its
 * folder, then LRCLIB (a free online lyrics service; only title, artist and length are sent).
 */
class LyricsFinder(
    private val api: TeleStoreApi,
    private val web: OkHttpClient,
    private val lrclib: HttpUrl = "https://lrclib.net/".toHttpUrl(),
) {
    /** Title and artist from the file's tag, else from "Artist - Title" in the name. */
    data class SongInfo(val title: String, val artist: String?, val tags: Id3Tags?)

    suspend fun find(item: FileItem, durationMs: Long, online: Boolean): Lyrics? {
        val tags = runCatching { readTags(item) }.getOrNull()
        tags?.lyrics?.let { text -> (Lrc.parse(text, "song file") ?: Lrc.plain(text, "song file"))?.let { return it } }
        runCatching { sidecar(item) }.getOrNull()?.let { return it }
        if (!online) return null
        val info = songInfo(item, tags)
        return runCatching { fromLrclib(info, durationMs) }.getOrNull()
    }

    fun songInfo(item: FileItem, tags: Id3Tags?): SongInfo {
        val name = PlayQueue.title(item)
        val split = name.split(" - ", limit = 2).map { it.trim() }
        val title = tags?.title ?: if (split.size == 2) split[1] else name
        val artist = tags?.artist ?: if (split.size == 2) split[0] else null
        return SongInfo(title, artist, tags)
    }

    /** The first bytes of the file (an ID3 tag sits at the very start), fetched with Range. */
    suspend fun readTags(item: FileItem): Id3Tags? {
        if (FileKinds.extension(item.name) != "mp3") return null
        val head = range(item, 0, 9) ?: return null
        val length = Id3.tagLength(head) ?: return null
        val tag = range(item, 0, minOf(length, MAX_TAG) - 1L) ?: return null
        return Id3.parse(tag)
    }

    private suspend fun range(item: FileItem, from: Long, to: Long): ByteArray? = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(api.media.file(item, inline = true)).header("Range", "bytes=$from-$to").build()
        api.http.newCall(request).execute().use { if (it.isSuccessful) it.body?.bytes() else null }
    }

    private suspend fun sidecar(item: FileItem): Lyrics? {
        val base = item.name.substringBeforeLast('.')
        val folder = api.listFiles(path = item.path, pageSize = 500)
        val lrc = folder.files.firstOrNull { !it.isFolder && it.name.equals("$base.lrc", ignoreCase = true) } ?: return null
        val text = withContext(Dispatchers.IO) {
            api.http.newCall(Request.Builder().url(api.media.file(lrc)).build()).execute().use { it.body?.string() }
        } ?: return null
        return Lrc.parse(text, ".lrc file")
    }

    private suspend fun fromLrclib(info: SongInfo, durationMs: Long): Lyrics? = withContext(Dispatchers.IO) {
        val url = lrclib.newBuilder().addPathSegments("api/get")
            .addQueryParameter("track_name", info.title)
            .apply { info.artist?.let { addQueryParameter("artist_name", it) } }
            .apply { if (durationMs > 0) addQueryParameter("duration", (durationMs / 1000).toString()) }
            .build()
        val request = Request.Builder().url(url).header("User-Agent", "TeleStore Android (https://github.com/yashsaxena15/TeleStore)").build()
        val text = web.newCall(request).execute().use { if (it.isSuccessful) it.body?.string() else null } ?: return@withContext null
        val track = TeleStoreApi.json.decodeFromString<LrclibTrack>(text)
        if (track.instrumental) return@withContext Lyrics(listOf(LyricLine(null, "Instrumental")), "LRCLIB")
        track.synced?.let { Lrc.parse(it, "LRCLIB") } ?: track.plain?.let { Lrc.plain(it, "LRCLIB") }
    }

    private companion object {
        const val MAX_TAG = 2 * 1024 * 1024
    }
}
