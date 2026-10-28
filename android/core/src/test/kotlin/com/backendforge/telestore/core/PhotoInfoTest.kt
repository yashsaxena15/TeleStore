package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.ZoneId

class PhotoInfoTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok" }, {})
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    @Test
    fun `reads the server's photo info`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(
            """{"width":4032,"height":3024,"megapixels":12.2,"camera_make":"Apple","camera_model":"iPhone 13","lens":"iPhone 13 back camera 4.2mm f/1.8",
               "aperture":1.8,"exposure":0.008333,"iso":100,"focal_length":4.2,"flash":"No flash","taken_at":"2024-05-01T10:20:30",
               "latitude":15.5527,"longitude":73.7517,"altitude":12.5,"format":"JPEG","file_size":2400000,"file_name":"IMG_1.jpg","folder":"/Home/Photos","extra":1}"""
        ))
        val info = api.photoInfo(FileItem(id = "p 1", name = "IMG_1.jpg"))
        assertEquals("/files/p%201/photo-info", server.takeRequest().path)
        assertEquals(4032, info.width)
        assertEquals("Apple", info.cameraMake)
        assertEquals(100, info.iso)
        assertEquals(2400000L, info.fileSize)
        assertEquals("No flash", info.flash)
        assertTrue(info.hasLocation)
        assertEquals("12.2 MP · 4032 × 3024", PhotoDetails.resolution(info))
        assertEquals("f/1.8 · 1/120 s · ISO 100 · 4.2 mm", PhotoDetails.exposureLine(info))
    }

    @Test
    fun `tolerates nulls, text numbers and boolean flash`() {
        val o = Json.parseToJsonElement("""{"width":null,"aperture":"f/2.2","exposure":"1/60","focal_length":"26 mm","iso":"200","flash":true,"camera_make":"  ","latitude":null}""").jsonObject
        val info = PhotoInfo.fromJson(o)
        assertNull(info.width)
        assertEquals(2.2, info.aperture)
        assertEquals("1/60 s", PhotoDetails.exposure(info.exposure))
        assertEquals(26.0, info.focalLength)
        assertEquals(200, info.iso)
        assertEquals("Flash fired", info.flash)
        assertNull(info.cameraMake)
        assertFalse(info.hasLocation)
        assertNull(PhotoDetails.resolution(info))
        assertEquals("No flash", PhotoInfo.fromJson(Json.parseToJsonElement("""{"flash":false}""").jsonObject).flash)
        assertEquals("Flash fired", PhotoInfo.fromJson(Json.parseToJsonElement("""{"flash":25}""").jsonObject).flash)
    }

    @Test
    fun `resolution label`() {
        assertEquals("12.2 MP · 4032 × 3024", PhotoDetails.resolution(PhotoInfo(width = 4032, height = 3024)))
        assertEquals("12 MP · 4000 × 3000", PhotoDetails.resolution(PhotoInfo(width = 4000, height = 3000)))
        assertEquals("48 MP", PhotoDetails.resolution(PhotoInfo(megapixels = 48.0)))
        assertNull(PhotoDetails.resolution(PhotoInfo()))
    }

    @Test
    fun `exposure settings`() {
        assertEquals("f/1.8", PhotoDetails.aperture(1.8))
        assertEquals("f/2", PhotoDetails.aperture(2.0))
        assertEquals("1/120 s", PhotoDetails.exposure(1 / 120.0))
        assertEquals("1/4000 s", PhotoDetails.exposure(0.00025))
        assertEquals("2 s", PhotoDetails.exposure(2.0))
        assertEquals("1.5 s", PhotoDetails.exposure(1.5))
        assertNull(PhotoDetails.exposure(0.0))
        assertEquals("ISO 100", PhotoDetails.iso(100))
        assertEquals("4.2 mm", PhotoDetails.focalLength(4.2))
        assertEquals("f/1.8 · ISO 50", PhotoDetails.exposureLine(PhotoInfo(aperture = 1.8, iso = 50)))
        assertNull(PhotoDetails.exposureLine(PhotoInfo()))
    }

    @Test
    fun `camera name`() {
        assertEquals("Apple iPhone 13", PhotoDetails.camera("Apple", "iPhone 13"))
        assertEquals("Google Pixel 7", PhotoDetails.camera("Google", "Google Pixel 7"))
        assertEquals("Canon", PhotoDetails.camera("Canon", null))
        assertNull(PhotoDetails.camera(null, " "))
    }

    @Test
    fun `coordinates and maps link`() {
        assertEquals("15.5527° N, 73.7517° E", PhotoDetails.coordinates(15.5527, 73.7517))
        assertEquals("33.8688° S, 151.2093° E", PhotoDetails.coordinates(-33.8688, 151.2093))
        assertEquals("40.7128° N, 74.0060° W", PhotoDetails.coordinates(40.7128, -74.006))
        assertEquals("geo:15.552700,73.751700?q=15.552700,73.751700", PhotoDetails.mapsUri(15.5527, 73.7517))
        assertFalse(PhotoInfo(latitude = 0.0, longitude = 0.0).hasLocation)
    }

    @Test
    fun `dates and flash codes`() {
        assertEquals("2024-05-01T10:20:30", PhotoDetails.exifDate("2024:05:01 10:20:30"))
        assertNull(PhotoDetails.exifDate("0000:00:00 00:00:00"))
        assertNull(PhotoDetails.exifDate(null))
        assertEquals("Wed, May 1, 2024 · 10:20 AM", PhotoDetails.takenLabel("2024-05-01T10:20:30"))
        assertEquals("Wed, May 1, 2024 · 3:50 PM", PhotoDetails.takenLabel("2024-05-01T10:20:30Z", ZoneId.of("Asia/Kolkata")))
        assertNull(PhotoDetails.takenLabel(null))
        assertEquals("Flash fired", PhotoDetails.flashLabel(1))
        assertEquals("No flash", PhotoDetails.flashLabel(16))
    }

    @Test
    fun `parses text numbers`() {
        assertEquals(1 / 120.0, PhotoDetails.parseText("1/120")!!, 1e-9)
        assertEquals(1.8, PhotoDetails.parseText("f/1.8"))
        assertNull(PhotoDetails.parseText("abc"))
        assertNull(PhotoDetails.parseText("1/0"))
    }
}
