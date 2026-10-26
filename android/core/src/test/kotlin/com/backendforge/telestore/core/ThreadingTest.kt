package com.backendforge.telestore.core

import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.ResponseBody.Companion.asResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import okio.ForwardingSource
import okio.buffer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.Collections
import java.util.concurrent.Executors

/**
 * Android kills an app that touches the network on its main thread. Reading a reply's body is
 * network work, so every read must happen on the API's own dispatcher, never the caller's thread
 * (Phase 1's first APK read replies on the main thread and crashed after signing in).
 */
class ThreadingTest {
    private lateinit var server: MockWebServer
    private val ioPool = Executors.newSingleThreadExecutor { Thread(it, "api-io") }
    private val readThreads = Collections.synchronizedList(mutableListOf<String>())
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        // Records the thread that reads each reply body
        val spying = OkHttpClient.Builder().addNetworkInterceptor { chain ->
            val response = chain.proceed(chain.request())
            val body = response.body ?: return@addNetworkInterceptor response
            val source = object : ForwardingSource(body.source()) {
                override fun read(sink: Buffer, byteCount: Long): Long {
                    readThreads += Thread.currentThread().name
                    return super.read(sink, byteCount)
                }
            }.buffer()
            response.newBuilder().body(source.asResponseBody(body.contentType(), body.contentLength())).build()
        }.build()
        api = TeleStoreApi(server.url("/"), { "tok" }, client = spying, io = ioPool.asCoroutineDispatcher())
    }

    @AfterEach
    fun tearDown() {
        server.shutdown()
        ioPool.shutdownNow()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun `replies are read on the api thread, not the caller's`() = runBlocking {
        val caller = Thread.currentThread().name
        server.enqueue(json("""{"message":"Login successful","username":"bob","auth_token":"t"}"""))
        server.enqueue(json("""{"files":[{"id":"1","file_name":"Movies","file_type":"folder"}]}"""))
        server.enqueue(json("""{"client_id":"abc"}"""))
        api.login("bob", "pw")
        api.listFiles()
        api.googleConfig()
        assertTrue(readThreads.isNotEmpty())
        assertFalse(readThreads.contains(caller), "a reply was read on the caller's thread: $readThreads")
        assertTrue(readThreads.all { it.startsWith("api-io") }, "reads happened on $readThreads")
    }

    @Test
    fun `error replies are read on the api thread too`() = runBlocking {
        val caller = Thread.currentThread().name
        server.enqueue(json("""{"detail":"Incorrect username or password"}""", 401))
        assertThrows<UnauthorizedException> { runBlocking { api.login("bob", "nope") } }
        assertFalse(readThreads.contains(caller))
    }

    @Test
    fun `an unreadable reply is a message, not a crash`() = runBlocking {
        server.enqueue(json("""<html>Bad gateway</html>"""))
        val e = assertThrows<ApiException> { runBlocking { api.login("bob", "pw") } }
        assertEquals("The server sent a reply the app couldn't read. Update the app or the server.", e.message)
    }
}
