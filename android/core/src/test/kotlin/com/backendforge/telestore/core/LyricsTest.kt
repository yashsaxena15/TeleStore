package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream

class LyricsTest {
    @Test
    fun `lrc lines are timed, sorted and offset`() {
        val lyrics = Lrc.parse(
            """
            [ar:Someone]
            [offset:+500]
            [00:12.50]Second line
            [00:05.00][00:30.00]Chorus <00:05.20>with <00:05.80>words
            [01:02.3]Last
            """.trimIndent(), "test",
        )!!
        assertTrue(lyrics.synced)
        assertEquals(listOf(4_500L, 12_000L, 29_500L, 61_800L), lyrics.lines.map { it.timeMs })
        assertEquals("Chorus with words", lyrics.lines[0].text)
        assertEquals(-1, lyrics.currentIndex(1_000))
        assertEquals(1, lyrics.currentIndex(15_000))
        assertEquals(3, lyrics.currentIndex(999_000))
    }

    @Test
    fun `plain text is unsynced`() {
        val lyrics = Lrc.parse("First\nSecond", "x")!!
        assertFalse(lyrics.synced)
        assertEquals(-1, lyrics.currentIndex(5_000))
        assertNull(Lrc.parse("[ar:only tags]", "x"))
    }

    private fun frame(id: String, body: ByteArray, v4: Boolean): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(id.toByteArray())
        val n = body.size
        if (v4) out.write(byteArrayOf((n shr 21 and 0x7f).toByte(), (n shr 14 and 0x7f).toByte(), (n shr 7 and 0x7f).toByte(), (n and 0x7f).toByte()))
        else out.write(byteArrayOf((n shr 24).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte()))
        out.write(byteArrayOf(0, 0))
        out.write(body)
        return out.toByteArray()
    }

    private fun tag(v4: Boolean, vararg frames: ByteArray): ByteArray {
        val body = frames.fold(ByteArray(0)) { a, b -> a + b } + ByteArray(64) // padding
        val n = body.size
        val header = byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), if (v4) 4 else 3, 0, 0,
            (n shr 21 and 0x7f).toByte(), (n shr 14 and 0x7f).toByte(), (n shr 7 and 0x7f).toByte(), (n and 0x7f).toByte())
        return header + body
    }

    private fun text(s: String) = byteArrayOf(3) + s.toByteArray(Charsets.UTF_8)
    private fun uslt(s: String) = byteArrayOf(3) + "eng".toByteArray() + byteArrayOf(0) + s.toByteArray(Charsets.UTF_8)

    @Test
    fun `id3 tags are read in both versions`() {
        for (v4 in listOf(false, true)) {
            val bytes = tag(v4, frame("TIT2", text("Softly"), v4), frame("TPE1", text("Karan Aujla"), v4), frame("USLT", uslt("[00:01.00]Hello"), v4))
            val tags = Id3.parse(bytes)!!
            assertEquals("Softly", tags.title)
            assertEquals("Karan Aujla", tags.artist)
            assertEquals("[00:01.00]Hello", tags.lyrics)
        }
        assertNull(Id3.parse("not a tag at all".toByteArray()))
    }

    @Test
    fun `finder tries the file, then a sidecar, then lrclib`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val mp3Tag = tag(false, frame("TIT2", text("Yellow"), false), frame("TPE1", text("Coldplay"), false))
        var lrclibQuery: String? = null
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path!!
                return when {
                    path.startsWith("/dl/") -> MockResponse().setResponseCode(206).setBody(Buffer().write(mp3Tag))
                    path.startsWith("/files") -> MockResponse().setHeader("Content-Type", "application/json").setBody("""{"files":[]}""")
                    path.startsWith("/api/get") -> {
                        lrclibQuery = request.requestUrl!!.query
                        MockResponse().setBody("""{"syncedLyrics":"[00:35.66] Look at the stars","plainLyrics":"Look at the stars","instrumental":false}""")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        val api = TeleStoreApi(server.url("/"), { "tok" })
        val finder = LyricsFinder(api, OkHttpClient(), server.url("/"))
        val song = FileItem(id = "s1", name = "track01.mp3", path = "/Home/Music")
        val lyrics = finder.find(song, durationMs = 267_000, online = true)!!
        assertEquals("LRCLIB", lyrics.source)
        assertEquals(35_660L, lyrics.lines.single().timeMs)
        assertTrue("track_name=Yellow" in lrclibQuery!! && "artist_name=Coldplay" in lrclibQuery!! && "duration=267" in lrclibQuery!!)
        assertNull(finder.find(song, 267_000, online = false))
        server.shutdown()
    }

    @Test
    fun `names like artist - title are split`() {
        val finder = LyricsFinder(TeleStoreApi("https://x.example/".toHttpUrl(), { null }), OkHttpClient())
        val info = finder.songInfo(FileItem(id = "1", name = "Karan Aujla - Softly.mp3"), null)
        assertEquals("Softly", info.title)
        assertEquals("Karan Aujla", info.artist)
    }
}
