package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.boolean
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

class NotificationsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok" }, {})
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)

    private fun note(id: String, kind: String = "inbox", read: Boolean = false) = ServerNotification(id = id, kind = kind, title = id, read = read)

    @Test
    fun `reads newer notifications`() = runTest {
        server.enqueue(json("""{"items":[{"id":"b","kind":"transfer","title":"Transfer finished","body":"a.mkv saved.","target":{"type":"folder","path":"/Home/Movies"},"created_at":"2026-10-27T10:00:00Z","read":false}],"unread":1,"latest":"b"}"""))
        val list = api.notifications(after = "a")
        assertEquals("/Home/Movies", list.items.single().target?.path)
        assertEquals(1, list.unread)
        assertEquals("/user/notifications?after=a&limit=30", server.takeRequest().path)
    }

    @Test
    fun `marks read`() = runTest {
        server.enqueue(json("""{"unread":0}"""))
        assertEquals(0, api.markNotificationsRead(listOf("b")))
        val body = TeleStoreApi.json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("b", body["ids"]!!.jsonArray.single().jsonPrimitive.content)
        assertFalse(body["all"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `lists a folder and its subfolders across pages`() = runTest {
        server.enqueue(json("""{"files":[{"id":"d","file_name":"Sub","file_type":"folder","file_path":"/Home/Trip"},{"id":"1","file_name":"a.jpg","file_path":"/Home/Trip"}],"pagination":{"has_next":true}}"""))
        server.enqueue(json("""{"files":[{"id":"2","file_name":"b.jpg","file_path":"/Home/Trip"}],"pagination":{"has_next":false}}"""))
        server.enqueue(json("""{"files":[{"id":"3","file_name":"c.jpg","file_path":"/Home/Trip/Sub"}]}"""))
        assertEquals(listOf("1", "2", "3"), api.filesUnder("/Home/Trip").map { it.id })
        assertTrue(server.takeRequest().path!!.contains("page=1"))
        assertTrue(server.takeRequest().path!!.contains("page=2"))
        assertTrue(server.takeRequest().path!!.contains("path=%2FHome%2FTrip%2FSub"))
    }

    @Test
    fun `shows unread ones oldest first, minus switched-off kinds`() {
        val items = listOf(note("c", "sign_in"), note("b", "inbox", read = true), note("a", "transfer"), note("z", "something_new"))
        assertEquals(listOf("z", "a", "c"), NotificationRules.toShow(items, off = emptySet()).map { it.id })
        assertEquals(listOf("z", "a"), NotificationRules.toShow(items, off = setOf("sign_in")).map { it.id })
    }

    @Test
    fun `remembers the newest id`() {
        assertEquals("c", NotificationRules.nextSeen("a", NotificationList(listOf(note("c"), note("b")))))
        assertEquals("x", NotificationRules.nextSeen("a", NotificationList(emptyList(), latest = "x")))
        assertEquals("a", NotificationRules.nextSeen("a", NotificationList()))
    }

    @Test
    fun `every kind has a switch and the server's kinds are known`() {
        listOf("transfer", "media", "instagram", "playlist_sync", "inbox", "storage", "sign_in").forEach {
            assertTrue(NotificationKind.of(it) != null, it)
        }
    }

    @Test
    fun `offline folder sync adds new files and drops removed ones`() {
        val server = listOf(
            FileItem(id = "1", name = "a"), FileItem(id = "2", name = "b"),
            FileItem(id = "f", name = "Sub", type = "folder"), FileItem(id = "t", name = "old", trashed = true),
        )
        val diff = OfflineSync.diff(server, saved = setOf("1", "gone"))
        assertEquals(listOf("2"), diff.add.map { it.id })
        assertEquals(setOf("gone"), diff.remove)
    }

    @Test
    fun `offline saves keep space free for the phone`() {
        val gb = 1024L * 1024 * 1024
        assertTrue(OfflineSync.fits(gb, free = 2 * gb))
        assertFalse(OfflineSync.fits(gb, free = gb + 100))
    }
}
