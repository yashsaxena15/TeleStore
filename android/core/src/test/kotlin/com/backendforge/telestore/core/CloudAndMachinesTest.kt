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

/** Cloud features the owner allows per user, and pausing / resuming the machines in Transfers › Workers. */
class CloudAndMachinesTest {
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
    fun `the app learns whether it may show the cloud features`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"archives": true, "cloud": true, "is_owner": false}"""))
        assertTrue(api.features().cloud)
        server.enqueue(MockResponse().setBody("{}"))
        assertFalse(api.features().cloud) // not said: off
    }

    @Test
    fun `the owner sets them for everyone and for one user`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"archives_enabled": true, "cloud_enabled": true}"""))
        assertTrue(api.setCloudEnabled(true).cloudEnabled)
        assertEquals("""{"cloud_enabled":true}""", server.takeRequest().body.readUtf8())

        server.enqueue(MockResponse().setBody("""{"id":"u2","username":"family","cloud":"allow","cloud_allowed":true,"created_at":"2026-10-01"}"""))
        val user = api.updateUser("u2", cloud = ArchiveChoice.ALLOW)
        assertEquals("allow" to true, user.cloud to user.cloudAllowed)
        assertEquals("""{"cloud":"allow"}""", server.takeRequest().body.readUtf8())
    }

    @Test
    fun `machines are listed, paused and resumed`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"machines":[
            {"worker_id":"master-vm1","name":"Main server","is_main":true,"online":true,"paused":false,"running":1},
            {"worker_id":"phone-redmi","online":true,"paused":true,"running":0},
            {"worker_id":"vm2-mumbai","online":false,"paused":false,"running":0}]}"""))
        val list = api.machines().machines
        assertEquals("/worker/machines", server.takeRequest().path)
        assertEquals(listOf("Main server", "phone-redmi", "vm2-mumbai"), list.map { it.name })
        assertEquals(listOf("Online", "Paused", "Offline"), list.map { it.state })
        assertEquals("1 transfer running", list[0].detail)
        assertEquals("Takes no new transfers until resumed", list[1].detail)

        server.enqueue(MockResponse().setBody("""{"paused":true,"handed_back":2}"""))
        assertEquals(2, api.pauseMachine("phone-redmi", stopNow = true).handedBack)
        val pause = server.takeRequest()
        assertEquals("POST" to "/worker/machines/phone-redmi/pause", pause.method to pause.path)
        assertEquals("""{"stop_now":true}""", pause.body.readUtf8())

        server.enqueue(MockResponse().setBody("""{"paused":false}"""))
        assertFalse(api.resumeMachine("phone-redmi").paused)
        assertEquals("/worker/machines/phone-redmi/resume", server.takeRequest().path)
    }
}
