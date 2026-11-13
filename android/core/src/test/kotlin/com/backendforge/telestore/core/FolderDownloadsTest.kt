package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class FolderDownloadsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok" })
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun `names are made safe for the phone`() {
        assertEquals("a_b_c", FolderDownloads.safeName("a/b:c"))
        assertEquals("file", FolderDownloads.safeName(" .. "))
        assertEquals("Trip/Day 1/Raw", FolderDownloads.join("Trip", "Day 1/Raw"))
        assertEquals("Trip", FolderDownloads.join("Trip", ""))
        assertEquals("Q_A/x", FolderDownloads.join("Q?A", "x"))
    }

    @Test
    fun `a file's folder inside the downloaded one`() {
        fun f(path: String) = FileItem(id = "1", name = "a.jpg", path = path)
        assertEquals("", FolderDownloads.relative("/Home/Trip", f("/Home/Trip")))
        assertEquals("Day 1/Raw", FolderDownloads.relative("/Home/Trip/", f("/Home/Trip/Day 1/Raw")))
        assertEquals("", FolderDownloads.relative("/Home/Trip", f("/Home/Trips")))  // a different folder
    }

    @Test
    fun `your own folder lists every file below it, page by page`() = runTest {
        server.enqueue(json("""{"files":[
            {"id":"1","file_name":"a.jpg","file_type":"photo","file_size":3,"file_path":"/Home/Trip"},
            {"id":"d","file_name":"Day 1","file_type":"folder","file_path":"/Home/Trip"}],
            "pagination":{"page":1,"total_pages":2}}"""))
        server.enqueue(json("""{"files":[{"id":"2","file_name":"b.mp4","file_type":"video","file_size":4,"file_path":"/Home/Trip/Day 1"}],
            "pagination":{"page":2,"total_pages":2}}"""))
        val files = FolderDownloads.ownFolder(api, "/Home/Trip", "Trip")
        assertEquals(listOf("a.jpg" to "Trip", "b.mp4" to "Trip/Day 1"), files.map { it.item.name to it.subPath })
        val first = server.takeRequest().requestUrl!!
        assertEquals("all", first.queryParameter("path"))
        assertEquals("/Home/Trip", first.queryParameter("under"))
        assertEquals("2", server.takeRequest().requestUrl!!.queryParameter("page"))
    }

    @Test
    fun `a shared folder is walked through the share`() = runTest {
        val root = """{"id":"r","name":"Holiday","type":"folder"}"""
        server.enqueue(json("""{"share_id":"s","root":$root,"items":[
            {"id":"1","name":"x.jpg","type":"photo","size":1},{"id":"f","name":"Sub","type":"folder"}]}"""))
        server.enqueue(json("""{"share_id":"s","root":$root,"items":[{"id":"2","name":"y.jpg","type":"photo","size":1}]}"""))
        val files = FolderDownloads.shareFolder(api, "s", "", "Holiday")
        assertEquals(listOf("x.jpg" to "Holiday", "y.jpg" to "Holiday/Sub"), files.map { it.item.name to it.subPath })
        assertTrue(files.all { it.item.shareId == "s" })
        server.takeRequest()
        assertEquals("Sub", server.takeRequest().requestUrl!!.queryParameter("path"))
    }
}
