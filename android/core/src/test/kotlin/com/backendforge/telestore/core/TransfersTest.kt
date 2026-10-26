package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.Collections

class TransfersTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok" })
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private class Bytes(val data: ByteArray) : ChunkSource {
        override val seekable = true
        override fun read(offset: Long, length: Int, buffer: ByteArray) = System.arraycopy(data, offset.toInt(), buffer, 0, length)
    }

    /** A pretend upload server: 10-byte chunks, keeps what it receives. */
    private inner class FakeUploadServer(val total: Int, val alreadyHave: Set<Int> = emptySet()) : Dispatcher() {
        val chunks = Collections.synchronizedMap(mutableMapOf<Int, ByteArray>())
        var busyOnce = true
        var dropOnce: Int? = null
        var completed = false
        var initBody = ""

        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.path!!
            return when {
                path.endsWith("/files/upload/init") -> {
                    initBody = request.body.readUtf8()
                    json("""{"upload_id":"u1","chunk_size":10,"total_chunks":$total,"received":${alreadyHave.toList()}}""")
                }
                path.startsWith("/files/upload/chunk/u1/") -> {
                    val index = path.substringAfterLast('/').toInt()
                    if (index == 1 && busyOnce) {
                        busyOnce = false
                        MockResponse().setResponseCode(429).setHeader("Retry-After", "1").setBody("""{"detail":"Waiting"}""")
                    } else {
                        val bytes = request.body.readByteArray()
                        if (index != dropOnce) chunks[index] = bytes else dropOnce = null
                        json("""{"status":"ok"}""")
                    }
                }
                path.endsWith("/files/upload/complete") -> {
                    val have = chunks.keys + alreadyHave
                    if (have.size < total) json("""{"detail":{"message":"missing","next_chunk":0}}""", 409)
                    else { completed = true; json("""{"status":"processing","upload_id":"u1"}""") }
                }
                path.endsWith("/files/upload/status/u1") ->
                    if (!completed) json("""{"status":"uploading","received":${(chunks.keys + alreadyHave).sorted()}}""")
                    else json("""{"status":"completed","file":{"id":"f9","file_name":"movie.mkv","file_path":"/Home/Movies"}}""")
                else -> MockResponse().setResponseCode(404)
            }
        }
    }

    private fun uploader(data: ByteArray, progress: MutableList<Long> = mutableListOf(), sessions: MutableList<String> = mutableListOf()) =
        ChunkedUploader(api, Bytes(data), "movie.mkv", data.size.toLong(), "/Home/Movies", parallel = 2,
            onSession = { sessions += it }, onProgress = { synchronized(progress) { progress += it } },
            retryDelayMs = { 10 }, pollMs = 10)

    @Test
    fun `uploads every chunk once, waits when busy, and returns the saved file`() = runBlocking {
        val data = ByteArray(35) { it.toByte() }
        val fake = FakeUploadServer(total = 4).also { server.dispatcher = it }
        val progress = mutableListOf<Long>()
        val sessions = mutableListOf<String>()
        val file = uploader(data, progress, sessions).upload()
        assertEquals("f9", file!!.id)
        assertEquals(listOf("u1"), sessions)
        assertEquals(setOf(0, 1, 2, 3), fake.chunks.keys)
        assertArrayEquals(data, (0..3).flatMap { fake.chunks[it]!!.toList() }.toByteArray())
        assertEquals(5, fake.chunks[3]!!.size) // the last chunk is shorter
        assertEquals(35L, progress.max())
        assertTrue("\"filesize\":35" in fake.initBody && "\"path\":\"/Home/Movies\"" in fake.initBody)
    }

    @Test
    fun `a resumed upload only sends what the server lacks`() = runBlocking {
        val data = ByteArray(40) { 7 }
        val fake = FakeUploadServer(total = 4, alreadyHave = setOf(0, 2)).also { server.dispatcher = it }
        val progress = mutableListOf<Long>()
        uploader(data, progress).upload(resumeId = "u1")
        assertEquals(setOf(1, 3), fake.chunks.keys)
        assertEquals(20L, progress.first()) // starts at what was already there
        assertTrue("\"resume_upload_id\":\"u1\"" in fake.initBody)
    }

    @Test
    fun `an upload the server is already saving isn't sent again`() = runBlocking {
        server.enqueue(json("""{"status":"processing"}"""))
        server.enqueue(json("""{"status":"completed","file":{"id":"f1","file_name":"movie.mkv"}}"""))
        val file = uploader(ByteArray(30)).upload(resumeId = "u7")
        assertEquals("f1", file!!.id)
        assertEquals(2, server.requestCount) // two status checks, no init and no chunks
    }

    @Test
    fun `a chunk the server lost is sent again`() = runBlocking {
        val data = ByteArray(30) { 1 }
        val fake = FakeUploadServer(total = 3).also { it.dropOnce = 2; server.dispatcher = it }
        uploader(data).upload()
        assertEquals(setOf(0, 1, 2), fake.chunks.keys)
    }

    @Test
    fun `a failed save is reported`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path!!.endsWith("/init") -> json("""{"upload_id":"u2","chunk_size":10,"total_chunks":1,"received":[]}""")
                request.path!!.contains("/chunk/") -> json("{}")
                request.path!!.endsWith("/complete") -> json("""{"status":"processing"}""")
                else -> json("""{"status":"error","error":"Part 1 couldn't be saved to Telegram"}""")
            }
        }
        val e = assertThrows<ApiException> { runBlocking { uploader(ByteArray(10)).upload() } }
        assertEquals("Part 1 couldn't be saved to Telegram", e.message)
    }

    // ── Downloads ─────────────────────────────────────────────────────────────
    private class Memory(initial: ByteArray = ByteArray(0)) : DownloadTarget {
        val out = ByteArrayOutputStream().apply { write(initial) }
        override fun length() = out.size().toLong()
        override fun open(append: Boolean): OutputStream {
            if (!append) out.reset()
            return object : OutputStream() {
                override fun write(b: Int) = out.write(b)
                override fun write(b: ByteArray, off: Int, len: Int) = out.write(b, off, len)
            }
        }
    }

    @Test
    fun `download resumes with Range and If-Range`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 4-9/10").setHeader("ETag", "\"e1\"").setBody("456789"))
        val target = Memory("0123".toByteArray())
        val result = ResumableDownloader(api.http).download(server.url("/dl/a.bin"), target, etag = "\"e1\"")
        val req = server.takeRequest()
        assertEquals("bytes=4-", req.getHeader("Range"))
        assertEquals("\"e1\"", req.getHeader("If-Range"))
        assertEquals("tok", req.getHeader("X-Auth-Token"))
        assertEquals("0123456789", target.out.toString())
        assertEquals(10, result.totalBytes)
    }

    @Test
    fun `a changed file starts over`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"e2\"").setBody("NEWFILE"))
        val target = Memory("old".toByteArray())
        val result = ResumableDownloader(api.http).download(server.url("/dl/a.bin"), target, etag = "\"e1\"")
        assertEquals("NEWFILE", target.out.toString())
        assertEquals("\"e2\"", result.etag)
    }

    @Test
    fun `without an etag nothing is resumed`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("whole"))
        val target = Memory("par".toByteArray())
        ResumableDownloader(api.http).download(server.url("/z.zip"), target, etag = null)
        assertEquals(null, server.takeRequest().getHeader("Range"))
        assertEquals("whole", target.out.toString())
    }

    @Test
    fun `server transfers and folder zips are read`() = runBlocking {
        server.enqueue(json("""{"tasks":[{"task_id":"t1","filename":"a.apk","status":"failed","error_message":"HTTP 404","group_id":"g1","group_name":"Drive"},
            {"task_id":"t2","status":"downloading","progress":40.5,"speed_bps":1000000}],
            "groups":{"g1":{"total":10,"counts":{"completed":6,"failed":1,"queued":3},"filesize":100,"transferred_bytes":60,"speed_bps":5}}}"""))
        val list = api.remoteTasks()
        assertTrue(list.tasks[0].isFailed && list.tasks[1].isActive)
        assertEquals(6, list.groups["g1"]!!.done)
        assertEquals(3, list.groups["g1"]!!.active)
        server.takeRequest()
        server.enqueue(json("""{"folder_name":"Movies","total_files":3,"total_size":5000,"parts":[{"part_index":1,"name":"Movies.zip","size":5000,"files_count":3,"download_url":"/folders/download-zip?path=%2FHome%2FMovies&part=1"}]}"""))
        val info = api.folderDownloadInfo("/Home/Movies")
        assertEquals("/Home/Movies", server.takeRequest().requestUrl!!.queryParameter("path"))
        assertEquals("Movies.zip", info.parts.single().name)
    }
}
