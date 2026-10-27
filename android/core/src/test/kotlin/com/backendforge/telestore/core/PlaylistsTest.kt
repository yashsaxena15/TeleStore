package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class PlaylistsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok" }, {})
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private fun body() = TeleStoreApi.json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject

    private val song = FileItem(id = "f1", name = "a.mp3")

    @Test
    fun `lists Liked music first and knows it`() = runTest {
        server.enqueue(json("""{"playlists":[{"id":"liked","name":"Liked music","kind":"liked","count":1,"file_ids":["f1"]},{"id":"p1","name":"Mix","kind":"user","count":0,"file_ids":[],"cover":null}]}"""))
        val lists = api.playlists()
        assertTrue(lists[0].isLiked)
        assertFalse(lists[1].isLiked)
        assertEquals(listOf("f1"), lists[0].fileIds)
        assertEquals("/files/playlists", server.takeRequest().path)
    }

    @Test
    fun `reads a playlist's items`() = runTest {
        server.enqueue(json("""{"id":"p1","name":"Mix","count":1,"file_ids":["f1"],"items":[{"id":"f1","file_name":"a.mp3","file_type":"audio"}]}"""))
        val playlist = api.playlist("p1")
        assertEquals("a.mp3", playlist.items.single().name)
        assertEquals("/files/playlists/p1", server.takeRequest().path)
    }

    @Test
    fun `create, rename, add, reorder, remove, delete`() = runTest {
        repeat(5) { server.enqueue(json("""{"id":"p1","name":"Mix","count":1}""")) }
        server.enqueue(json("""{"deleted":true}"""))
        api.createPlaylist(" Mix ", listOf(song))
        val created = body()
        assertEquals("Mix", created["name"]!!.jsonPrimitive.content)
        assertEquals("f1", created["file_ids"]!!.jsonArray.single().jsonPrimitive.content)

        api.renamePlaylist("p1", "Gym")
        server.takeRequest().let { assertEquals("PATCH", it.method); assertEquals("/files/playlists/p1", it.path) }

        api.addToPlaylist("p1", listOf(song))
        assertEquals("/files/playlists/p1/items", server.takeRequest().path)
        api.reorderPlaylist("p1", listOf(song))
        server.takeRequest().let { assertEquals("PUT", it.method); assertEquals("/files/playlists/p1/order", it.path) }
        api.removeFromPlaylist("p1", listOf(song))
        assertEquals("/files/playlists/p1/items/remove", server.takeRequest().path)
        api.deletePlaylist("p1")
        server.takeRequest().let { assertEquals("DELETE", it.method); assertEquals("/files/playlists/p1", it.path) }
    }

    @Test
    fun `the heart sends what it wants`() = runTest {
        server.enqueue(json("""{"liked":true}"""))
        assertTrue(api.setLiked(song, true))
        val sent = body()
        assertEquals("f1", sent["file_id"]!!.jsonPrimitive.content)
        assertEquals("true", sent["liked"]!!.jsonPrimitive.content)
    }

    @Test
    fun `Liked music can't be deleted, and the server says why`() = runTest {
        server.enqueue(json("""{"detail":"“Liked music” can't be deleted"}""", 400))
        val e = assertThrows<ApiException> { api.deletePlaylist(Playlist.LIKED) }
        assertEquals("“Liked music” can't be deleted", e.message)
    }
}
