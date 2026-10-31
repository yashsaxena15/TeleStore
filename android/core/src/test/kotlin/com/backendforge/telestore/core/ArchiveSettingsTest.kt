package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** Compress & extract: what the app may show, the owner's server switch, and each user's choice. */
class ArchiveSettingsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "t" })
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    @Test
    fun `the app learns whether it may show compress and extract`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"archives": false, "is_owner": true}"""))
        val features = api.features()
        assertFalse(features.archives)
        assertTrue(features.isOwner)
        assertEquals("/user/features", server.takeRequest().path)
        // An older server without the reply's fields: everything stays available
        server.enqueue(MockResponse().setBody("{}"))
        assertTrue(api.features().archives)
    }

    @Test
    fun `the owner turns them off for everyone`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"archives_enabled": false}"""))
        assertFalse(api.setArchivesEnabled(false).archivesEnabled)
        val request = server.takeRequest()
        assertEquals("PUT" to "/system/settings", request.method to request.path)
        assertEquals("""{"archives_enabled":false}""", request.body.readUtf8())
    }

    @Test
    fun `and decides for one user`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"id":"u2","username":"family","archives":"allow","archives_allowed":true,"created_at":"2026-10-01"}"""))
        val user = api.updateUser("u2", archives = ArchiveChoice.ALLOW)
        assertEquals("allow" to true, user.archives to user.archivesAllowed)
        assertEquals("""{"archives":"allow"}""", server.takeRequest().body.readUtf8())
    }

    @Test
    fun `unknown choices read as following the server`() {
        assertEquals(ArchiveChoice.DEFAULT, ArchiveChoice.of(null))
        assertEquals(ArchiveChoice.DEFAULT, ArchiveChoice.of("maybe"))
        assertEquals(ArchiveChoice.BLOCK, ArchiveChoice.of("block"))
    }
}
