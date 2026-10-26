package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LinksTest {
    @Test
    fun `links are sorted to the right kind`() {
        assertEquals(LinkKind.MEDIA, LinkKind.detect("https://youtu.be/abc"))
        assertEquals(LinkKind.MEDIA, LinkKind.detect("https://m.youtube.com/watch?v=1"))
        assertEquals(LinkKind.MEDIA, LinkKind.detect("https://www.facebook.com/watch?v=1"))
        assertEquals(LinkKind.INSTAGRAM, LinkKind.detect("https://www.instagram.com/reel/xyz/"))
        assertEquals(LinkKind.LEECH, LinkKind.detect("https://drive.google.com/file/d/1/view"))
        assertEquals(LinkKind.LEECH, LinkKind.detect("magnet:?xt=urn:btih:abc"))
        assertEquals(LinkKind.LEECH, LinkKind.detect("https://example.com/file.zip"))
        assertNull(LinkKind.detect("not a link"))
        assertEquals("https://youtu.be/abc", LinkKind.firstLink("Watch this! https://youtu.be/abc."))
    }

    private val preview = MediaPreview(
        kind = "video", title = "T",
        options = MediaOptions(
            video = listOf(VideoOption("2160", 2160, 60, true, 3L * 1024 * 1024 * 1024), VideoOption("720", 720, 30, false, 0)),
            audio = listOf(AudioOption("251", "Opus", 160, 5_000_000)),
        ),
    )

    @Test
    fun `quality and audio lists match the website`() {
        assertEquals(
            listOf("Best available (2160p HDR 60fps)", "2160p HDR 60fps · ~3.0 GB", "720p", "Most compatible (H.264, up to 1080p)"),
            MediaChoices.video(preview).map { it.label },
        )
        assertEquals("Up to 4320p", MediaChoices.video(null)[1].label)
        val facebook = preview.copy(options = MediaOptions(video = listOf(VideoOption("fmt:hd", label = "HD"), VideoOption("fmt:sd", label = "SD"))))
        assertEquals(listOf("best", "fmt:hd", "fmt:sd"), MediaChoices.video(facebook).map { it.value })
        val audio = MediaChoices.audio(preview)
        assertEquals("Best original (Opus 160 kbps)", audio[0].choices[0].label)
        assertEquals("src:251", audio[0].choices[1].value)
    }

    @Test
    fun `choices are sent as the server expects`() {
        assertEquals("""{"mode":"video","quality":"720","subtitles":"en"}""", MediaChoices.choice(false, "720", "original", "en").toString())
        assertEquals("""{"mode":"audio","audio_format":"mp3","audio_bitrate":"320"}""", MediaChoices.choice(true, "best", "mp3:320", null).toString())
        assertEquals("""{"mode":"audio","audio_format":"original","audio_source":"251"}""", MediaChoices.choice(true, "best", "src:251", null).toString())
        assertEquals("""{"mode":"audio","audio_format":"flac"}""", MediaChoices.choice(true, "best", "flac", null).toString())
    }

    @Test
    fun `link calls send the right body`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().setBody("""{"success":true,"message":"Enqueued 1 item(s)","count":1}"""))
        assertEquals(1, api.addFromLink(" magnet:?xt=urn:btih:abc ", "/Home/Movies").count)
        val add = TeleStoreApi.json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("magnet:?xt=urn:btih:abc", add["url"]!!.jsonPrimitive.content)
        assertEquals("/Home/Movies", add["destination_path"]!!.jsonPrimitive.content)

        server.enqueue(MockResponse().setBody("""{"message":"Downloading 2 video files.","count":2}"""))
        api.downloadMedia("https://youtu.be/p", MediaChoices.choice(false, "best", "original", null), "/Home", items = listOf(1, 3), sync = true)
        val media = TeleStoreApi.json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("home", media["destination"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        assertEquals(listOf("1", "3"), media["items"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("true", media["sync"]!!.jsonPrimitive.content)

        server.enqueue(MockResponse().setBody("""{"message":"ok","count":1}"""))
        api.addTorrent("ubuntu.torrent", byteArrayOf(1, 2, 3), "/Home")
        val torrent = server.takeRequest()
        assertTrue(torrent.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        assertTrue("filename=\"ubuntu.torrent\"" in torrent.body.readUtf8())
        server.shutdown()
    }
}
