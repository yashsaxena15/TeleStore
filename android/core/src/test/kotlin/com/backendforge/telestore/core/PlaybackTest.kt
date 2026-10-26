package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PlaybackTest {
    private val media = MediaUrls("https://ts.example/".toHttpUrl()) { "tok" }
    private val movie = FileItem(id = "m1", name = "Arrival (2016).mkv", type = "video")

    @Test
    fun `original plays the file itself`() {
        val s = PlaybackPlan.source(media, movie, Quality.ORIGINAL, convert = false, startMs = 5000)
        assertFalse(s.converted)
        assertEquals("/dl/Arrival%20(2016).mkv", s.url.encodedPath)
        assertEquals("m1", s.url.queryParameter("file_id"))
        assertEquals(0, s.startMs) // the file seeks itself
    }

    @Test
    fun `a smaller quality is converted from the current time`() {
        val s = PlaybackPlan.source(media, movie, Quality.P480, convert = false, audioTrack = 1, startMs = 61_500)
        assertTrue(s.converted)
        assertEquals("/media/stream/Arrival%20(2016).mkv", s.url.encodedPath)
        assertEquals("480p", s.url.queryParameter("quality"))
        assertEquals("1", s.url.queryParameter("audio_track"))
        assertEquals("61.5", s.url.queryParameter("start_time"))
        assertEquals("m1", s.url.queryParameter("file_id"))
        assertEquals("tok", s.url.queryParameter("token"))
        assertEquals(61_500 + 2_000, PlaybackPlan.shownPosition(s, 2_000))
    }

    @Test
    fun `sound the phone can't play keeps the original picture`() {
        val s = PlaybackPlan.source(media, movie, Quality.ORIGINAL, convert = true)
        assertTrue(s.converted)
        assertEquals("original", s.url.queryParameter("quality"))
        assertEquals("0.0", s.url.queryParameter("start_time"))
    }

    @Test
    fun `quality choices stop below the video's own height`() {
        assertEquals(listOf(Quality.ORIGINAL, Quality.P480, Quality.P360, Quality.P240), Quality.choicesFor(720))
        assertEquals(Quality.entries.toList(), Quality.choicesFor(null))
        assertEquals(Quality.P720, Quality.fallbackFor(2160))
        assertEquals(Quality.P480, Quality.fallbackFor(480))
        assertEquals(Quality.P240, Quality.fallbackFor(200))
    }

    @Test
    fun `queue keeps only the same kind, in folder order`() {
        val a = FileItem(id = "1", name = "a.mp3")
        val folder = FileItem(id = "2", name = "Covers", type = "folder")
        val pic = FileItem(id = "3", name = "cover.jpg")
        val b = FileItem(id = "4", name = "b.flac")
        val (queue, index) = PlayQueue.around(listOf(a, folder, pic, b), b)
        assertEquals(listOf(a, b), queue)
        assertEquals(1, index)
        assertEquals("Softly", PlayQueue.title(FileItem(id = "x", name = "Softly.mp3")))
        assertEquals(".bashrc", PlayQueue.title(FileItem(id = "y", name = ".bashrc")))
    }

    @Test
    fun `media info reads the server's reply`() = runTest {
        val server = MockWebServer().apply { start() }
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(
            """{"file_name":"x.mkv","width":1920,"height":1080,"video_codec":"hevc","duration":6970.5,
               "audio_tracks":[{"index":0,"codec":"eac3","language":"Hindi","title":"Hindi"},{"index":1,"codec":"aac","language":"English","title":null}],
               "subtitle_tracks":[{"index":0,"codec":"subrip","language":"English","title":"English"}]}"""))
        val api = TeleStoreApi(server.url("/"), { "tok" })
        val info = api.mediaInfo(movie)
        assertEquals(1080, info.height)
        assertEquals(6_970_500, info.durationMs)
        assertEquals(listOf("Hindi", "English"), info.audioTracks.map { it.label })
        assertEquals("m1", server.takeRequest().requestUrl!!.queryParameter("file_id"))
        server.shutdown()
    }
}
