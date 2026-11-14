package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class DirectTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok-123" })
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)
    private fun RecordedRequest.json(): JsonObject = TeleStoreApi.json.parseToJsonElement(body.readUtf8()).jsonObject

    @Test
    fun `config gives the Telegram app id`() = runTest {
        server.enqueue(json("""{"api_id":12345,"api_hash":"abc","part_size":2044723200}"""))
        val c = api.directConfig()
        assertEquals(12345, c.apiId)
        assertEquals("abc", c.apiHash)
        assertEquals("/direct/config", server.takeRequest().path)
    }

    @Test
    fun `prepare asks where a file goes`() = runTest {
        server.enqueue(json("""{"chat_id":-1001,"path":"/Home/Movies","file_name":"f.mkv","file_size":5,"part_size":2044723200,"total_parts":1,
            "parts":[{"part_index":1,"start":0,"length":5,"file_name":"f.mkv","caption":"Uploaded file: f.mkv"}]}"""))
        val plan = api.directPrepare("/Home/Movies", "f.mkv", 5)
        assertEquals(-1001L, plan.chatId)
        assertEquals("Uploaded file: f.mkv", plan.parts.single().caption)
        val body = server.takeRequest().json()
        assertEquals("/Home/Movies", body["path"]!!.jsonPrimitive.content)
        assertEquals(5L, body["filesize"]!!.jsonPrimitive.long)
    }

    @Test
    fun `complete sends each part's message in order`() = runTest {
        server.enqueue(json("""{"message":"File saved"}"""))
        api.directComplete("/Home", "big.mkv", 30, mapOf(2 to 12L, 1 to 11L), takenAt = "2026-11-01T10:00:00Z")
        val body = server.takeRequest().json()
        val parts = body["parts"]!!.jsonArray.map { it.jsonObject["part_index"]!!.jsonPrimitive.int to it.jsonObject["message_id"]!!.jsonPrimitive.long }
        assertEquals(listOf(1 to 11L, 2 to 12L), parts)
        assertEquals("2026-11-01T10:00:00Z", body["taken_at"]!!.jsonPrimitive.content)
    }

    @Test
    fun `locate reads the parts`() = runTest {
        server.enqueue(json("""{"id":"f1","name":"big.mkv","size":15,"parts":[{"chat_id":-1,"message_id":101,"size":10,"start":0},{"chat_id":-1,"message_id":102,"size":5,"start":10}]}"""))
        val loc = api.directLocate("f1")
        assertEquals(listOf(101L, 102L), loc.parts.map { it.messageId })
        assertEquals("/direct/locate/f1", server.takeRequest().path)
    }

    private val twoParts = DirectLocation("f", "big.mkv", 15, listOf(DirectPlace(-1, 101, 10, 0), DirectPlace(-1, 102, 5, 10)))

    @Test
    fun `a range inside one part`() {
        val spans = twoParts.spans(2, 5)
        assertEquals(listOf(DirectLocation.Span(twoParts.parts[0], 2, 5)), spans)
    }

    @Test
    fun `a range across both parts`() {
        val spans = twoParts.spans(8, 4)
        assertEquals(listOf(DirectLocation.Span(twoParts.parts[0], 8, 2), DirectLocation.Span(twoParts.parts[1], 0, 2)), spans)
    }

    @Test
    fun `to the end and past it`() {
        assertEquals(listOf(DirectLocation.Span(twoParts.parts[1], 2, 3)), twoParts.spans(12, -1))
        assertEquals(listOf(DirectLocation.Span(twoParts.parts[1], 3, 2)), twoParts.spans(13, 100))
        assertTrue(twoParts.spans(15, 10).isEmpty())
    }

    private fun item(path: String = "/Home", type: String = "video", vault: Boolean = false) =
        TeleStoreApi.json.decodeFromString(FileItem.serializer(), """{"id":"1","file_name":"a.mkv","file_type":"$type","file_path":"$path","is_vault":$vault}""")

    @Test
    fun `own files open straight from Telegram, others through TeleStore`() {
        assertTrue(DirectRules.canOpenDirect(item(), signedIn = true, enabled = true))
        assertFalse(DirectRules.canOpenDirect(item(), signedIn = false, enabled = true))
        assertFalse(DirectRules.canOpenDirect(item(), signedIn = true, enabled = false))
        assertFalse(DirectRules.canOpenDirect(item(vault = true), signedIn = true, enabled = true))
        assertFalse(DirectRules.canOpenDirect(item(path = "/Vault/Docs"), signedIn = true, enabled = true))
        assertFalse(DirectRules.canOpenDirect(item(type = "folder"), signedIn = true, enabled = true))
        assertFalse(DirectRules.canOpenDirect(item().copy(shareId = "s1"), signedIn = true, enabled = true))
    }

    @Test
    fun `uploads go straight to Telegram except into the vault`() {
        assertTrue(DirectRules.canUploadDirect("/Home/Movies", true, true, 10))
        assertFalse(DirectRules.canUploadDirect("/Vault", true, true, 10))
        assertFalse(DirectRules.canUploadDirect("/Vault/x", true, true, 10))
        assertFalse(DirectRules.canUploadDirect("/Home", true, true, 0))
        assertFalse(DirectRules.canUploadDirect("/Home", false, true, 10))
    }

    private class FakeSender(val fail: Set<String> = emptySet()) : TelegramSender {
        val sent = mutableListOf<Triple<String, Long, Long>>()
        var next = 100L
        override suspend fun send(chatId: Long, source: ChunkSource, start: Long, length: Long, fileName: String, caption: String,
                                  onProgress: (Long) -> Unit): Long {
            if (fileName in fail) throw IllegalStateException("network")
            onProgress(length / 2)
            sent += Triple(fileName, start, length)
            return ++next
        }
    }

    private object NoBytes : ChunkSource {
        override val seekable = true
        override fun read(offset: Long, length: Int, buffer: ByteArray) {}
    }

    private val bigPlan = """{"chat_id":-1,"path":"/Home","file_name":"big.mkv","file_size":30,"total_parts":3,"parts":[
        {"part_index":1,"start":0,"length":10,"file_name":"big.mkv.part1","caption":"big.mkv (Part 1)"},
        {"part_index":2,"start":10,"length":10,"file_name":"big.mkv.part2","caption":"big.mkv (Part 2)"},
        {"part_index":3,"start":20,"length":10,"file_name":"big.mkv.part3","caption":"big.mkv (Part 3)"}]}"""

    @Test
    fun `direct upload sends every part then saves the file`() = runTest {
        server.enqueue(json(bigPlan))
        server.enqueue(json("""{"message":"File saved","file":{"id":"new1","file_name":"big.mkv"}}"""))
        val sender = FakeSender()
        val progress = mutableListOf<Long>()
        val saved = mutableListOf<Pair<Int, Long>>()
        val id = DirectUploader(api, sender, NoBytes, "big.mkv", 30, "/Home", onPartSent = { i, m -> saved += i to m },
            onProgress = { progress += it }).upload()
        assertEquals("new1", id)
        assertEquals(listOf(Triple("big.mkv.part1", 0L, 10L), Triple("big.mkv.part2", 10L, 10L), Triple("big.mkv.part3", 20L, 10L)), sender.sent)
        assertEquals(listOf(1 to 101L, 2 to 102L, 3 to 103L), saved)
        assertEquals(30L, progress.last())
        server.takeRequest()
        val parts = server.takeRequest().json()["parts"]!!.jsonArray.map { it.jsonObject["message_id"]!!.jsonPrimitive.long }
        assertEquals(listOf(101L, 102L, 103L), parts)
    }

    @Test
    fun `a resumed upload sends only the missing parts`() = runTest {
        server.enqueue(json(bigPlan))
        server.enqueue(json("""{"message":"File saved"}"""))
        val sender = FakeSender()
        DirectUploader(api, sender, NoBytes, "big.mkv", 30, "/Home", sentBefore = mapOf(1 to 7L, 2 to 8L)).upload()
        assertEquals(listOf("big.mkv.part3"), sender.sent.map { it.first })
        server.takeRequest()
        val parts = server.takeRequest().json()["parts"]!!.jsonArray.map { it.jsonObject["message_id"]!!.jsonPrimitive.long }
        assertEquals(listOf(7L, 8L, 101L), parts)
    }

    @Test
    fun `a failed part keeps the ones already sent`() = runTest {
        server.enqueue(json(bigPlan))
        val saved = mutableListOf<Int>()
        runCatching { DirectUploader(api, FakeSender(fail = setOf("big.mkv.part2")), NoBytes, "big.mkv", 30, "/Home",
            onPartSent = { i, _ -> saved += i }).upload() }
        assertEquals(listOf(1), saved)
    }

    /** Takes a while per part and remembers how many were being sent at the same time. */
    private class SlowSender : TelegramSender {
        var now = 0
        var most = 0
        override suspend fun send(chatId: Long, source: ChunkSource, start: Long, length: Long, fileName: String, caption: String,
                                  onProgress: (Long) -> Unit): Long {
            synchronized(this) { now++; most = maxOf(most, now) }
            kotlinx.coroutines.delay(50)
            onProgress(length)
            synchronized(this) { now-- }
            return 200 + start / 10
        }
    }

    @Test
    fun `parts go several at once when the file can be read anywhere`() = runTest {
        server.enqueue(json(bigPlan))
        server.enqueue(json("""{"message":"File saved","file":{"id":"new2"}}"""))
        val sender = SlowSender()
        val saved = java.util.Collections.synchronizedList(mutableListOf<Int>())
        val progress = java.util.Collections.synchronizedList(mutableListOf<Long>())
        assertEquals("new2", DirectUploader(api, sender, NoBytes, "big.mkv", 30, "/Home", parallel = 3,
            onPartSent = { i, _ -> saved += i }, onProgress = { progress += it }).upload())
        assertEquals(3, sender.most)
        assertEquals(setOf(1, 2, 3), saved.toSet())
        assertEquals(30L, progress.last())
        server.takeRequest()
        val parts = server.takeRequest().json()["parts"]!!.jsonArray.map { it.jsonObject["message_id"]!!.jsonPrimitive.long }
        assertEquals(listOf(200L, 201L, 202L), parts) // in part order, whatever order they finished in
    }

    @Test
    fun `a stream that can only be read in order goes one part at a time`() = runTest {
        server.enqueue(json(bigPlan))
        server.enqueue(json("""{"message":"File saved"}"""))
        val sender = SlowSender()
        val stream = object : ChunkSource {
            override val seekable = false
            override fun read(offset: Long, length: Int, buffer: ByteArray) {}
        }
        DirectUploader(api, sender, stream, "big.mkv", 30, "/Home", parallel = 3).upload()
        assertEquals(1, sender.most)
    }

    @Test
    fun `already saved counts as done`() = runTest {
        server.enqueue(json(bigPlan))
        server.enqueue(MockResponse().setResponseCode(409).setHeader("Content-Type", "application/json").setBody("""{"detail":"That upload is already saved as a file."}"""))
        assertEquals(null, DirectUploader(api, FakeSender(), NoBytes, "big.mkv", 30, "/Home", sentBefore = mapOf(1 to 1L, 2 to 2L, 3 to 3L)).upload())
    }
}
