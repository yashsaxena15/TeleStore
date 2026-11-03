package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale

class TransferRowsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
    private val MB = 1024L * 1024
    private val GB = 1024L * MB

    private fun task(status: String, vararg extra: Pair<String, String>) = RemoteTask(id = "t", filename = "a.bin", status = status).let { t ->
        extra.fold(t) { acc, (k, v) ->
            when (k) {
                "worker" -> acc.copy(worker = v)
                "cooldown" -> acc.copy(cooldownUntil = v)
                else -> acc
            }
        }
    }

    @Test
    fun `an older server's task still decodes, its one speed counting as the download`() {
        val list = json.decodeFromString<RemoteTaskList>(
            """{"tasks":[{"task_id":"t1","filename":"x.iso","status":"downloading","filesize":100,"transferred_bytes":40,"progress":40,"speed_bps":10}],"groups":{}}""",
        )
        val row = TransferRows.fromServer(list).single()
        assertEquals(10, row.downBps)
        assertEquals(0, row.upBps)
        assertNull(row.worker)
        assertEquals(TransferState.RUNNING, row.state)
        assertEquals(0.4f, row.progress)
    }

    @Test
    fun `a newer server's fields decode`() {
        val list = json.decodeFromString<RemoteTaskList>(
            """{"tasks":[{"task_id":"t1","filename":"x.iso","status":"downloading","filesize":4831838208,"transferred_bytes":2254857830,
               "download_bps":5976883,"upload_bps":0,"speed_bps":5976883,"worker":"vm2","eta_seconds":431,"source_url":"https://x/y",
               "destination_path":"/Home/ISO","created_at":"2026-11-02T10:00:00"}],
               "groups":{"g":{"total":2967,"counts":{"completed":326,"downloading":2,"paused_quota":3},"filesize":26628797235,
               "name":"Other Tools","source_url":"https://drive.google.com/x","download_bps":100,"upload_bps":50,"resumes_at":"2026-11-02T10:38:00Z"}}}""",
        )
        val rows = TransferRows.fromServer(list)
        val folder = rows.first { it.isFolder }
        assertEquals("Other Tools", folder.name)
        assertEquals(TransferState.RUNNING, folder.state)
        assertEquals("326 of 2,967 files · 24.8 GB · ↓ 100 B/s ↑ 50 B/s", TransferRows.detail(folder))
        val file = rows.first { !it.isFolder }
        assertEquals("vm2", file.worker)
        assertEquals("2.1 GB of 4.5 GB · ↓ 5.7 MB/s · 7 min", TransferRows.detail(file))
        assertEquals("https://x/y", file.sourceUrl)
        assertTrue(file.startedAt > 0)
    }

    @Test
    fun `a folder keeps running while some files wait for Google, and says so in amber`() {
        val running = GroupSummary(total = 10, counts = mapOf("downloading" to 1, "paused_quota" to 3, "completed" to 6), resumesAt = "2026-11-02T16:08:00Z")
        val row = TransferRows.fromGroup("g", running)
        assertEquals(TransferState.RUNNING, row.state)
        assertEquals("RUNNING", TransferRows.label(row).text)
        assertEquals(
            "3 files wait for Google's limit · next resumes at 4:08 PM",
            TransferRows.googleNote(row, ZoneOffset.UTC, LocalDate.of(2026, 11, 2), Locale.ENGLISH),
        )
        assertTrue(TransferRows.actions(row).resumeNow)

        // Every file left waits: then the folder itself shows Google's limit
        val paused = running.copy(counts = mapOf("paused_quota" to 4, "completed" to 6))
        val pausedRow = TransferRows.fromGroup("g", paused)
        assertEquals(TransferState.GOOGLE_LIMIT, pausedRow.state)
        assertEquals(StatusLabel("GOOGLE LIMIT", TransferTone.AMBER), TransferRows.label(pausedRow))
    }

    @Test
    fun `a single file paused by Google says when it tries again`() {
        val row = TransferRows.fromTask(task("paused_quota", "cooldown" to "2026-11-03T09:00:00Z"))
        assertEquals(
            "Waits for Google's download limit · resumes tomorrow at 9:00 AM",
            TransferRows.googleNote(row, ZoneOffset.UTC, LocalDate.of(2026, 11, 2), Locale.ENGLISH),
        )
        assertNull(TransferRows.googleNote(TransferRows.fromTask(task("downloading"))))
    }

    @Test
    fun `folder states`() {
        fun state(vararg c: Pair<String, Int>, total: Int = c.sumOf { it.second }) = TransferRows.folderState(GroupSummary(total = total, counts = mapOf(*c)))
        assertEquals(TransferState.WAITING, state("queued" to 3, "paused_quota" to 1))
        assertEquals(TransferState.SCANNING, state("discovering" to 1))
        assertEquals(TransferState.FAILED, state("completed" to 2, "failed" to 1))
        assertEquals(TransferState.DONE, state("completed" to 3))
        assertEquals(TransferState.CANCELLED, state("completed" to 1, "cancelled" to 2))
        assertEquals(TransferState.SAVING, state("uploading_tg" to 1, "queued" to 4))
    }

    @Test
    fun `phone rows go one way and work out the time left`() {
        val up = TransferRows.phone("u", upload = true, name = "IMG.mp4", state = TransferState.RUNNING, done = 40 * MB, size = 210 * MB, speedBps = 3_355_443, createdAt = 1, error = null)
        assertEquals("UPLOADING", TransferRows.label(up).text)
        assertEquals("40.0 MB of 210 MB · 3.2 MB/s · 53 s", TransferRows.detail(up))
        assertEquals(3_355_443, up.upBps)
        assertEquals(0, up.downBps)
        val a = TransferRows.actions(up)
        assertTrue(a.pause && a.cancel)
        assertFalse(a.resume || a.open || a.copyLink)

        val done = TransferRows.phone("d", upload = false, name = "x", state = TransferState.DONE, done = 2 * GB, size = 2 * GB, speedBps = 0, createdAt = 1, error = null)
        assertEquals("2.0 GB", TransferRows.detail(done))
        assertTrue(TransferRows.actions(done).open && TransferRows.actions(done).showInFolder)
        assertFalse(TransferRows.actions(done).cancel)
    }

    @Test
    fun `filters count rows and running come before finished`() {
        val rows = listOf(
            TransferRows.phone("1", true, "done", TransferState.DONE, 1, 1, 0, createdAt = 50, error = null),
            TransferRows.phone("2", true, "failed", TransferState.FAILED, 0, 1, 0, createdAt = 40, error = "x"),
            TransferRows.phone("3", false, "waiting", TransferState.WAITING, 0, 1, 0, createdAt = 30, error = null),
            TransferRows.phone("4", false, "running", TransferState.RUNNING, 0, 1, 0, createdAt = 10, error = null),
            TransferRows.fromGroup("g", GroupSummary(total = 3, counts = mapOf("completed" to 2, "failed" to 1))),
        )
        assertEquals(mapOf(TransferFilter.ALL to 5, TransferFilter.ACTIVE to 2, TransferFilter.DONE to 1, TransferFilter.FAILED to 2), TransferRows.counts(rows))
        assertEquals(listOf("running", "waiting", "done", "failed", "Folder transfer"), TransferRows.sorted(rows).map { it.name })
        val folder = rows.last()
        assertTrue(TransferRows.actions(folder).retryFailed)
        assertFalse(TransferRows.actions(folder).retry)
    }

    @Test
    fun `header line with live totals`() {
        assertEquals("3 running · ↓ 11.2 MB/s  ↑ 6.1 MB/s", TransferRows.headline(3, 0, 0, 11_744_051, 6_396_313))
        assertEquals("1 waiting", TransferRows.headline(0, 1, 0, 0, 0))
        assertEquals("Nothing running", TransferRows.headline(0, 0, 0, 0, 0))
        val rows = listOf(
            TransferRows.phone("1", true, "a", TransferState.RUNNING, 0, 10, 5, 0, null),
            TransferRows.phone("2", false, "b", TransferState.RUNNING, 0, 10, 7, 0, null),
            TransferRows.phone("3", false, "c", TransferState.PAUSED, 0, 10, 99, 0, null),
        )
        assertEquals(7L to 5L, TransferRows.totalSpeeds(rows))
    }

    @Test
    fun `words for time, machines and sizes`() {
        assertEquals("40 s", TransferRows.duration(40))
        assertEquals("7 min", TransferRows.duration(431))
        assertEquals("1 h 5 min", TransferRows.duration(3900))
        assertNull(TransferRows.duration(0))
        assertEquals("Main server", TransferRows.workerLabel("main"))
        assertEquals("vm2", TransferRows.workerLabel("vm2"))
        assertNull(TransferRows.workerLabel(""))
        assertEquals("512 B", TransferRows.bytes(512))
        assertEquals("1.9 GB", TransferRows.bytes(2_040_109_465))
        assertEquals(0, TransferRows.isoMillis("not a date"))
        assertEquals(TransferRows.isoMillis("2026-11-02T10:00:00Z"), TransferRows.isoMillis("2026-11-02T10:00:00"))
        assertEquals(TransferRows.isoMillis("2026-11-02T10:00:00Z"), TransferRows.isoMillis("2026-11-02T15:30:00+05:30"))
    }

    @Test
    fun `speed is smoothed over about five seconds`() {
        val s = SpeedSmoother()
        assertEquals(0, s.next(0, 0))
        assertEquals(1000, s.next(1000, 1000)) // the first reading is taken as it is
        // A one-second burst moves it only part of the way
        val burst = s.next(11_000, 2000)
        assertTrue(burst in 2000..3500, "got $burst")
        // A stall lowers it slowly, not straight to zero
        val stall = s.next(11_000, 3000)
        assertTrue(stall in 1000 until burst, "got $stall")
        // Starting over (fewer bytes) resets it
        assertEquals(0, s.next(0, 4000))
    }

    @Test
    fun `a folder's files load page by page with search and filter`() = runBlocking {
        val server = MockWebServer().apply { start() }
        try {
            server.enqueue(
                MockResponse().setHeader("Content-Type", "application/json").setBody(
                    """{"tasks":[{"task_id":"a","filename":"IMG 1.jpg","status":"failed","error_message":"403"}],"total":51,"offset":50,"limit":50,"summary":{"total":51,"counts":{"failed":1,"completed":50}}}""",
                ),
            )
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"success":true,"retried_count":1,"message":"Retrying 1 file."}"""))
            val api = TeleStoreApi(server.url("/"), { "tok" })
            val page = api.remoteGroupTasks("g 1", filter = FolderFilter.FAILED.wire, query = " IMG ", offset = 50)
            assertEquals(51, page.total)
            assertEquals("403", page.tasks.single().error)
            assertEquals(1, page.summary?.failed)
            val req = server.takeRequest()
            assertEquals("/transfers/remote/groups/g%201/tasks?filter=failed&q=IMG&offset=50&limit=50", req.path)
            assertEquals(1, api.retryFailedRemote("g 1").retried)
            val retry = server.takeRequest()
            assertEquals("/transfers/remote/retry-failed", retry.path)
            assertEquals("""{"group_id":"g 1"}""", retry.body.readUtf8())
        } finally {
            server.shutdown()
        }
    }
}
