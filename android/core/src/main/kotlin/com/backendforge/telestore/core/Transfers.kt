package com.backendforge.telestore.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.coroutineContext

// ── Server models ──────────────────────────────────────────────────────────────

@Serializable
data class UploadSession(
    @SerialName("upload_id") val uploadId: String,
    @SerialName("chunk_size") val chunkSize: Long = 20L * 1024 * 1024,
    @SerialName("total_chunks") val totalChunks: Int = 1,
    val received: List<Int> = emptyList(),
    val resumed: Boolean = false,
)

@Serializable
data class UploadStatus(
    val status: String = "uploading",
    val received: List<Int> = emptyList(),
    val file: FileItem? = null,
    val error: String? = null,
    val message: String? = null,
)

@Serializable
data class ZipPart(
    @SerialName("part_index") val index: Int = 1,
    val name: String,
    val size: Long = 0,
    @SerialName("files_count") val filesCount: Int = 0,
    @SerialName("download_url") val downloadUrl: String,
)

@Serializable
data class FolderDownloadInfo(
    @SerialName("folder_name") val folderName: String = "",
    @SerialName("total_files") val totalFiles: Int = 0,
    @SerialName("total_size") val totalSize: Long = 0,
    val parts: List<ZipPart> = emptyList(),
)

/** One server transfer (cloud leech, Google Drive file, video link…). */
@Serializable
data class RemoteTask(
    @SerialName("task_id") val id: String,
    val filename: String? = null,
    val status: String = "queued",
    val filesize: Long? = null,
    @SerialName("transferred_bytes") val transferred: Long? = null,
    val progress: Double? = null,
    @SerialName("speed_bps") val speed: Double? = null,
    @SerialName("source_type") val sourceType: String? = null,
    @SerialName("error_message") val error: String? = null,
    @SerialName("group_id") val groupId: String? = null,
    @SerialName("group_name") val groupName: String? = null,
) {
    val isActive: Boolean get() = status in ACTIVE
    val isFailed: Boolean get() = status == "failed"

    companion object {
        val ACTIVE = setOf("queued", "downloading", "uploading_tg", "discovering", "paused_quota")
    }
}

/** Totals for a big folder transfer: the server sends these instead of thousands of rows. */
@Serializable
data class GroupSummary(
    val total: Int = 0,
    val counts: Map<String, Int> = emptyMap(),
    val filesize: Long = 0,
    @SerialName("transferred_bytes") val transferred: Long = 0,
    @SerialName("speed_bps") val speed: Double = 0.0,
) {
    val done: Int get() = counts["completed"] ?: 0
    val failed: Int get() = counts["failed"] ?: 0
    val active: Int get() = RemoteTask.ACTIVE.sumOf { counts[it] ?: 0 }
}

@Serializable
data class RemoteTaskList(
    val tasks: List<RemoteTask> = emptyList(),
    val groups: Map<String, GroupSummary> = emptyMap(),
)

// ── Uploading ──────────────────────────────────────────────────────────────────

/** Reads a file's bytes for the uploader (on Android: a content:// document). */
interface ChunkSource {
    /** False when the file can only be read front to back (then chunks go one at a time, in order). */
    val seekable: Boolean

    /** Reads exactly [length] bytes at [offset] into [buffer]. */
    fun read(offset: Long, length: Int, buffer: ByteArray)
}

/**
 * Uploads a file of any size with the website's chunked protocol: 20 MB chunks, [parallel] at a
 * time, waiting when the server says it is busy (429), retrying lost connections, resending any
 * chunk the server didn't get, then waiting while the server saves the file to Telegram.
 *
 * [onSession] receives the upload id as soon as it exists, so a later run can continue it.
 */
class ChunkedUploader(
    private val api: TeleStoreApi,
    private val source: ChunkSource,
    private val name: String,
    private val size: Long,
    private val folder: String,
    private val parallel: Int = 2,
    private val onSession: (String) -> Unit = {},
    private val onProgress: (sentBytes: Long) -> Unit = {},
    private val onSaving: () -> Unit = {},
    private val retryDelayMs: (attempt: Int) -> Long = { attempt -> 2_000L * attempt },
    private val pollMs: Long = 2_000,
) {
    suspend fun upload(resumeId: String? = null): FileItem? {
        require(size > 0) { "Empty files can't be uploaded." }
        // Stopped while the server was already saving it: just wait (sending it again would duplicate it)
        if (resumeId != null) {
            val earlier = runCatching { api.uploadStatus(resumeId) }.getOrNull()
            when (earlier?.status) {
                "completed" -> return earlier.file
                "processing" -> return waitUntilSaved(resumeId)
            }
        }
        val session = api.uploadInit(name, size, folder, resumeId)
        onSession(session.uploadId)
        val chunk = session.chunkSize
        val sent = AtomicLong(session.received.sumOf { lengthOf(it, chunk) })
        onProgress(sent.get())

        var missing = (0 until session.totalChunks).filterNot { it in session.received.toSet() }
        repeat(3) {
            if (missing.isNotEmpty()) send(session.uploadId, missing, chunk, sent)
            // The server double-checks: anything it doesn't have is sent again
            val check = runCatching { api.uploadComplete(session.uploadId) }
            val failure = check.exceptionOrNull()
            if (failure == null) return waitUntilSaved(session.uploadId)
            if (failure is ApiException && failure.status == 409) {
                val status = api.uploadStatus(session.uploadId)
                missing = (0 until session.totalChunks).filterNot { it in status.received.toSet() }
            } else {
                throw failure
            }
        }
        throw ApiException(409, "The server kept missing parts of this file. Try again.")
    }

    private fun lengthOf(index: Int, chunk: Long): Long = minOf(chunk, size - index * chunk)

    private suspend fun send(uploadId: String, chunks: List<Int>, chunk: Long, sent: AtomicLong) = coroutineScope {
        val queue = ArrayDeque(chunks)
        val lock = Mutex()
        val workers = if (source.seekable) parallel.coerceAtLeast(1) else 1
        repeat(workers) {
            launch(Dispatchers.IO) {
                val buffer = ByteArray(chunk.toInt())
                while (true) {
                    val index = lock.withLock { queue.removeFirstOrNull() } ?: break
                    val length = lengthOf(index, chunk).toInt()
                    source.read(index * chunk, length, buffer)
                    sendWithRetry(uploadId, index, buffer, length)
                    onProgress(sent.addAndGet(length.toLong()))
                }
            }
        }
    }

    private suspend fun sendWithRetry(uploadId: String, index: Int, buffer: ByteArray, length: Int) {
        var failures = 0
        while (true) {
            coroutineContext.ensureActive()
            try {
                api.uploadChunk(uploadId, index, buffer, length)
                return
            } catch (e: CancellationException) {
                throw e
            } catch (e: RetryLaterException) {
                delay(e.seconds * 1000) // busy, not broken: doesn't count as a failure
            } catch (e: NetworkException) {
                if (++failures > MAX_FAILURES) throw e
                delay(retryDelayMs(failures))
            } catch (e: ApiException) {
                if (e.status in 500..599 && ++failures <= MAX_FAILURES && "Upload failed" !in (e.message ?: "")) {
                    delay(retryDelayMs(failures))
                } else {
                    throw e
                }
            }
        }
    }

    private suspend fun waitUntilSaved(uploadId: String): FileItem? {
        onSaving()
        var failures = 0
        while (true) {
            delay(pollMs)
            val status = try {
                api.uploadStatus(uploadId).also { failures = 0 }
            } catch (e: NetworkException) {
                if (++failures > MAX_FAILURES * 3) throw e
                continue
            }
            when (status.status) {
                "completed" -> return status.file
                "error" -> throw ApiException(500, status.error ?: "The server couldn't save this file.")
            }
        }
    }

    private companion object {
        const val MAX_FAILURES = 5
    }
}

// ── Downloading ────────────────────────────────────────────────────────────────

/** Where a download is written (on Android: a file in Downloads/TeleStore). */
interface DownloadTarget {
    /** Bytes already saved from an earlier attempt. */
    fun length(): Long

    /** Appends after [length], or starts over (empties it) when [append] is false. */
    fun open(append: Boolean): OutputStream
}

/**
 * Downloads with resume: asks for the rest of the file (Range) only when the server confirms
 * it is still the same file (If-Range with its ETag); otherwise starts over.
 */
class ResumableDownloader(private val http: OkHttpClient) {
    data class Result(val totalBytes: Long, val etag: String?)

    suspend fun download(
        url: HttpUrl,
        target: DownloadTarget,
        etag: String?,
        onProgress: (done: Long, total: Long) -> Unit = { _, _ -> },
    ): Result = withContext(Dispatchers.IO) {
        val have = target.length()
        val resume = have > 0 && etag != null
        val request = Request.Builder().url(url).apply {
            if (resume) {
                header("Range", "bytes=$have-")
                header("If-Range", etag!!)
            }
        }.build()
        val response = try {
            http.newCall(request).execute()
        } catch (e: IOException) {
            throw NetworkException("Couldn't reach ${url.host}. Check your connection.", e)
        }
        response.use { res ->
            if (res.code == 416 && resume) {
                // Nothing left to fetch: the earlier attempt already got all of it
                val total = res.header("Content-Range")?.substringAfter('/')?.toLongOrNull()
                if (total == have) return@withContext Result(have, etag)
            }
            if (res.code == 401) throw UnauthorizedException()
            if (!res.isSuccessful) throw ApiException(res.code, "The server answered with an error (${res.code}).")
            val partial = res.code == 206
            val start = if (partial) have else 0L
            val body = res.body ?: throw ApiException(res.code, "The server sent no data.")
            val total = if (partial) {
                res.header("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: (start + body.contentLength())
            } else {
                body.contentLength()
            }
            var done = start
            try {
                target.open(append = partial).use { out ->
                    val input = body.byteStream()
                    val buffer = ByteArray(256 * 1024)
                    var lastReport = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        done += n
                        val now = System.currentTimeMillis()
                        if (now - lastReport > 500) {
                            onProgress(done, total)
                            lastReport = now
                        }
                    }
                }
            } catch (e: IOException) {
                throw NetworkException("The download was interrupted. It will continue from ${done / (1024 * 1024)} MB.", e)
            }
            if (total > 0 && done < total) throw NetworkException("The download stopped early. It will continue where it stopped.")
            onProgress(done, if (total > 0) total else done)
            Result(done, res.header("ETag") ?: etag)
        }
    }
}
