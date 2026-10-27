package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class DevicesTest {
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

    @Test
    fun `lists devices with this one marked`() = runTest {
        server.enqueue(json("""{"devices":[{"id":"a1","name":"Android app","kind":"app","method":"password","signed_in_at":"2026-10-26T10:00:00","last_seen":"2026-10-27T10:00:00","current":true},{"id":"b2","name":"Chrome on Windows","kind":"browser","method":"google","current":false}]}"""))
        val devices = api.devices()
        assertTrue(devices[0].current)
        assertEquals("google", devices[1].method)
        val request = server.takeRequest()
        assertEquals("/auth/devices", request.path)
        assertEquals("tok", request.getHeader("X-Auth-Token"))
    }

    @Test
    fun `signs out one device or all the others`() = runTest {
        server.enqueue(json("""{"message":"Signed out."}"""))
        server.enqueue(json("""{"signed_out":2}"""))
        api.signOutDevice("b2")
        assertEquals(2, api.signOutOtherDevices())
        server.takeRequest().let { assertEquals("DELETE", it.method); assertEquals("/auth/devices/b2", it.path) }
        server.takeRequest().let { assertEquals("POST", it.method); assertEquals("/auth/devices/sign-out-others", it.path) }
    }

    @Test
    fun `refuses this device with the server's words`() = runTest {
        server.enqueue(json("""{"detail":"This is the device you're using. Use Sign out instead."}""", 400))
        val e = assertThrows<ApiException> { api.signOutDevice("a1") }
        assertEquals("This is the device you're using. Use Sign out instead.", e.message)
    }
}
