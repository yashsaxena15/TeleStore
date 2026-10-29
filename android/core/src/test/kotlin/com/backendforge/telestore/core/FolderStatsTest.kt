package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class FolderStatsTest {
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
    fun `reads a folder's size and counts`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody("""{"folder_name":"Movies","full_path":"/Home/Movies","total_files":1240,"total_subfolders":35,"total_size":13314398617}"""))
        val stats = api.folderStats(FileItem(id = "f9", name = "Movies", type = "folder"))
        assertEquals(13314398617, stats.size)
        assertEquals("1,240 files · 35 folders", stats.counts)
        assertEquals("/folders/stats?id=f9", server.takeRequest().path)
    }

    @Test
    fun `counts read naturally`() {
        assertEquals("1 file", FolderStats(files = 1).counts)
        assertEquals("0 files", FolderStats().counts)
        assertEquals("2 files · 1 folder", FolderStats(files = 2, folders = 1).counts)
    }
}
