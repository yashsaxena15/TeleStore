package com.backendforge.telestore.core

import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.exp
import kotlin.math.roundToLong

// The Transfers screen's words and order, kept here so they can be tested without a phone.
// Phone uploads and downloads and the server's transfers all become a [TransferRow].

enum class TransferKind { UPLOAD, DOWNLOAD, SERVER_FILE, SERVER_FOLDER }

enum class TransferState {
    RUNNING, SCANNING, SAVING, WAITING, PAUSED, GOOGLE_LIMIT, DONE, FAILED, CANCELLED;

    /** Not finished yet (running, waiting or paused). */
    val active: Boolean get() = this != DONE && this != FAILED && this != CANCELLED

    /** Bytes are moving right now. */
    val moving: Boolean get() = this == RUNNING || this == SCANNING || this == SAVING
}

/** The colour family of a status label; the screen picks the actual colours. */
enum class TransferTone { MOVING, WAITING, AMBER, SUCCESS, ERROR, MUTED }

data class StatusLabel(val text: String, val tone: TransferTone)

data class TransferRow(
    /** Unique in the list: "p-…" phone, "t-…" server file, "g-…" folder. */
    val key: String,
    /** The phone transfer's id, the server task's id or the folder's group id. */
    val id: String,
    val kind: TransferKind,
    val name: String,
    val state: TransferState,
    val done: Long = 0,
    val total: Long = 0,
    /** 0..1 */
    val progress: Float = 0f,
    val downBps: Long = 0,
    val upBps: Long = 0,
    val etaSeconds: Long? = null,
    /** The machine working on it ("main", "vm2"); null on the phone. */
    val worker: String? = null,
    /** When it started (epoch ms), for the order of finished ones. */
    val startedAt: Long = 0,
    val error: String? = null,
    /** The server's own words about what it is doing. */
    val phase: String? = null,
    val sourceUrl: String? = null,
    val destination: String? = null,
    /** Folders: their files. */
    val filesDone: Int = 0,
    val filesTotal: Int = 0,
    val filesFailed: Int = 0,
    /** Folders and single files: how many wait for Google's download limit, and when the first tries again. */
    val filesWaitingForGoogle: Int = 0,
    val resumesAt: String? = null,
) {
    val isPhone: Boolean get() = kind == TransferKind.UPLOAD || kind == TransferKind.DOWNLOAD
    val isFolder: Boolean get() = kind == TransferKind.SERVER_FOLDER
}

/** The filter chips above the list. */
enum class TransferFilter(val label: String) {
    ALL("All"), ACTIVE("Active"), DONE("Done"), FAILED("Failed");

    fun matches(row: TransferRow): Boolean = when (this) {
        ALL -> true
        ACTIVE -> row.state.active
        DONE -> row.state == TransferState.DONE || row.state == TransferState.CANCELLED
        // A folder counts as failed when any of its files failed
        FAILED -> row.state == TransferState.FAILED || row.filesFailed > 0
    }
}

/** The filter inside a folder; [wire] is what the server's `filter` parameter expects. */
enum class FolderFilter(val wire: String, val label: String) {
    ALL("all", "All"), ACTIVE("active", "Active"), WAITING("waiting", "Waiting"), FAILED("failed", "Failed"), DONE("done", "Done"),
}

/** Which buttons a row or its details sheet offers. */
data class TransferActions(
    val open: Boolean = false,
    val showInFolder: Boolean = false,
    val pause: Boolean = false,
    val resume: Boolean = false,
    val retry: Boolean = false,
    val cancel: Boolean = false,
    val copyLink: Boolean = false,
    /** Try Google again right away (files paused by its download limit). */
    val resumeNow: Boolean = false,
    /** Folders: re-queue only the failed files. */
    val retryFailed: Boolean = false,
)

object TransferRows {
    /** Up to this many files load per page in a folder's screen. */
    const val PAGE_SIZE = 50

    fun serverState(status: String): TransferState = when (status) {
        "downloading" -> TransferState.RUNNING
        "uploading_tg" -> TransferState.SAVING
        "discovering" -> TransferState.SCANNING
        "queued" -> TransferState.WAITING
        "paused_quota" -> TransferState.GOOGLE_LIMIT
        "completed" -> TransferState.DONE
        "failed" -> TransferState.FAILED
        "cancelled" -> TransferState.CANCELLED
        else -> TransferState.WAITING
    }

    fun phone(
        id: String, upload: Boolean, name: String, state: TransferState, done: Long, size: Long,
        speedBps: Long, createdAt: Long, error: String?, destination: String? = null,
    ): TransferRow {
        val moving = state == TransferState.RUNNING
        return TransferRow(
            key = "p-$id", id = id, kind = if (upload) TransferKind.UPLOAD else TransferKind.DOWNLOAD, name = name, state = state,
            done = done, total = size, progress = fraction(done, size),
            downBps = if (!upload && moving) speedBps else 0, upBps = if (upload && moving) speedBps else 0,
            etaSeconds = if (moving) eta(size - done, speedBps) else null,
            startedAt = createdAt, error = error, destination = destination,
        )
    }

    fun fromTask(t: RemoteTask): TransferRow {
        val state = serverState(t.status)
        val total = t.filesize ?: 0
        val done = if (state == TransferState.DONE) maxOf(total, t.transferred ?: 0) else t.transferred ?: 0
        // Older servers send one speed: count it as the download
        val down = (t.downloadBps ?: t.speed ?: 0.0).toLong().coerceAtLeast(0)
        val up = (t.uploadBps ?: 0.0).toLong().coerceAtLeast(0)
        val progress = when {
            state == TransferState.DONE -> 1f
            t.progress != null -> (t.progress / 100).toFloat().coerceIn(0f, 1f)
            else -> fraction(done, total)
        }
        val moving = state.moving
        return TransferRow(
            key = "t-${t.id}", id = t.id, kind = TransferKind.SERVER_FILE, name = t.filename ?: "Transfer", state = state,
            done = done, total = total, progress = progress,
            downBps = if (moving) down else 0, upBps = if (moving) up else 0,
            etaSeconds = if (moving) t.etaSeconds?.toLong()?.takeIf { it > 0 } ?: eta(total - done, down + up) else null,
            worker = t.worker?.takeIf { it.isNotBlank() }, startedAt = isoMillis(t.createdAt),
            error = t.error?.takeIf { state == TransferState.FAILED }, phase = t.phase,
            sourceUrl = t.sourceUrl, destination = t.destinationPath,
            filesWaitingForGoogle = if (state == TransferState.GOOGLE_LIMIT) 1 else 0,
            resumesAt = t.cooldownUntil.takeIf { state == TransferState.GOOGLE_LIMIT },
        )
    }

    /**
     * A folder is running while any of its files runs, even when others wait for Google's limit
     * (the server pauses only the file that hit it). It shows Google's limit as its status only
     * when every file left is paused by it.
     */
    fun folderState(s: GroupSummary): TransferState {
        val c = s.counts
        fun n(status: String) = c[status] ?: 0
        return when {
            n("downloading") > 0 -> TransferState.RUNNING
            n("uploading_tg") > 0 -> TransferState.SAVING
            n("discovering") > 0 -> TransferState.SCANNING
            n("queued") > 0 -> TransferState.WAITING
            n("paused_quota") > 0 -> TransferState.GOOGLE_LIMIT
            n("failed") > 0 -> TransferState.FAILED
            s.total == 0 -> TransferState.WAITING
            n("completed") >= s.total -> TransferState.DONE
            n("cancelled") > 0 -> TransferState.CANCELLED
            else -> TransferState.DONE
        }
    }

    fun fromGroup(groupId: String, s: GroupSummary, fallbackName: String? = null, worker: String? = null): TransferRow {
        val state = folderState(s)
        val down = (s.downloadBps ?: s.speed).toLong().coerceAtLeast(0)
        val up = (s.uploadBps ?: 0.0).toLong().coerceAtLeast(0)
        val moving = state.moving
        return TransferRow(
            key = "g-$groupId", id = groupId, kind = TransferKind.SERVER_FOLDER,
            name = s.name?.takeIf { it.isNotBlank() } ?: fallbackName ?: "Folder transfer", state = state,
            done = s.transferred, total = s.filesize,
            // Waiting files have no size yet, so a folder's progress counts files
            progress = if (s.total > 0) (s.done.toFloat() / s.total).coerceIn(0f, 1f) else 0f,
            downBps = if (moving) down else 0, upBps = if (moving) up else 0,
            worker = worker, startedAt = isoMillis(s.createdAt),
            error = s.error?.takeIf { s.failed > 0 }, sourceUrl = s.sourceUrl, destination = s.destinationPath,
            filesDone = s.done, filesTotal = s.total, filesFailed = s.failed,
            filesWaitingForGoogle = s.pausedByGoogle, resumesAt = s.resumesAt,
        )
    }

    /** Every server transfer as rows: one per folder, plus the files that aren't in a folder. */
    fun fromServer(list: RemoteTaskList): List<TransferRow> {
        val groups = list.groups
        val members = list.tasks.filter { it.groupId != null && it.groupId in groups }.groupBy { it.groupId!! }
        val folders = groups.map { (id, summary) ->
            val files = members[id].orEmpty()
            // The machine of a running file stands for the folder
            val worker = files.firstOrNull { serverState(it.status).moving && !it.worker.isNullOrBlank() }?.worker
            fromGroup(id, summary, files.firstOrNull()?.groupName, worker)
        }
        val loose = list.tasks.filter { it.groupId == null || it.groupId !in groups }.map(::fromTask)
        return folders + loose
    }

    /** Running first (moving, then paused, then waiting), newest first within each; finished below, newest first. */
    fun sorted(rows: List<TransferRow>): List<TransferRow> = rows.sortedWith(
        compareBy<TransferRow>({ rank(it.state) }, { -it.startedAt }),
    )

    private fun rank(state: TransferState): Int = when {
        state.moving -> 0
        state == TransferState.GOOGLE_LIMIT || state == TransferState.PAUSED -> 1
        state == TransferState.WAITING -> 2
        else -> 3
    }

    fun counts(rows: List<TransferRow>): Map<TransferFilter, Int> = TransferFilter.entries.associateWith { f -> rows.count(f::matches) }

    /** The coloured word on a row. */
    fun label(row: TransferRow): StatusLabel = when (row.state) {
        TransferState.RUNNING -> StatusLabel(
            when (row.kind) {
                TransferKind.UPLOAD -> "UPLOADING"
                TransferKind.DOWNLOAD -> "DOWNLOADING"
                else -> "RUNNING"
            },
            TransferTone.MOVING,
        )
        TransferState.SAVING -> StatusLabel(if (row.isPhone) "SAVING" else "TO TELEGRAM", TransferTone.MOVING)
        TransferState.SCANNING -> StatusLabel("SCANNING", TransferTone.MOVING)
        TransferState.WAITING -> StatusLabel("WAITING", TransferTone.WAITING)
        TransferState.PAUSED -> StatusLabel("PAUSED", TransferTone.AMBER)
        TransferState.GOOGLE_LIMIT -> StatusLabel("GOOGLE LIMIT", TransferTone.AMBER)
        TransferState.DONE -> StatusLabel("DONE", TransferTone.SUCCESS)
        TransferState.FAILED -> StatusLabel("FAILED", TransferTone.ERROR)
        TransferState.CANCELLED -> StatusLabel("CANCELLED", TransferTone.MUTED)
    }

    /**
     * The line under the name: "2.1 GB of 4.5 GB · ↓ 5.7 MB/s · 7 min" for a file,
     * "326 of 2,967 files · 24.8 GB" for a folder.
     */
    fun detail(row: TransferRow): String {
        val parts = mutableListOf<String>()
        if (row.isFolder) {
            parts += "${number(row.filesDone)} of ${number(row.filesTotal)} files"
            if (row.total > 0) parts += bytes(row.total)
            if (row.filesFailed > 0) parts += "${number(row.filesFailed)} failed"
        } else {
            parts += when {
                row.state == TransferState.DONE -> bytes(maxOf(row.total, row.done))
                row.total > 0 -> "${bytes(row.done)} of ${bytes(row.total)}"
                row.done > 0 -> bytes(row.done)
                else -> ""
            }
        }
        if (row.state.moving) {
            speeds(row)?.let { parts += it }
            row.etaSeconds?.let { duration(it) }?.let { parts += it }
        }
        return parts.filter { it.isNotEmpty() }.joinToString(" · ")
    }

    /** "↓ 5.7 MB/s ↑ 1.2 MB/s" on the server; a phone transfer goes one way, so just "3.2 MB/s". */
    fun speeds(row: TransferRow): String? {
        if (row.isPhone) return (row.downBps + row.upBps).takeIf { it > 0 }?.let { "${bytes(it)}/s" }
        return listOfNotNull(
            row.downBps.takeIf { it > 0 }?.let { "↓ ${bytes(it)}/s" },
            row.upBps.takeIf { it > 0 }?.let { "↑ ${bytes(it)}/s" },
        ).joinToString(" ").ifEmpty { null }
    }

    /** "3 files wait for Google's limit · next resumes at 4:08 PM"; null when none wait. */
    fun googleNote(
        row: TransferRow, zone: ZoneId = ZoneId.systemDefault(), today: LocalDate = LocalDate.now(zone), locale: Locale = Locale.getDefault(),
    ): String? {
        val n = row.filesWaitingForGoogle
        if (n <= 0) return null
        val resumes = TransferActivity.resumes(row.resumesAt, zone, today, locale)
        val who = when {
            !row.isFolder -> "Waits for Google's download limit"
            n == 1 -> "1 file waits for Google's limit"
            else -> "${number(n)} files wait for Google's limit"
        }
        val next = if (row.isFolder && n > 1) "next " else ""
        return "$who · ${resumes?.let { "$next$it" } ?: "resumes by itself"}"
    }

    /** "machine: main" reads as the main server; a worker keeps its own name. */
    fun workerLabel(worker: String?): String? = when {
        worker.isNullOrBlank() -> null
        worker == "main" -> "Main server"
        else -> worker
    }

    fun actions(row: TransferRow): TransferActions {
        val s = row.state
        return TransferActions(
            open = row.kind == TransferKind.DOWNLOAD && s == TransferState.DONE,
            // Downloads: the phone's Downloads; uploads and server transfers: their TeleStore folder
            showInFolder = s == TransferState.DONE && (row.kind == TransferKind.DOWNLOAD || !row.destination.isNullOrBlank()),
            pause = row.isPhone && (s == TransferState.RUNNING || s == TransferState.WAITING),
            resume = row.isPhone && s == TransferState.PAUSED,
            retry = s == TransferState.FAILED && !row.isFolder,
            cancel = s.active,
            copyLink = !row.sourceUrl.isNullOrBlank(),
            resumeNow = !row.isPhone && row.filesWaitingForGoogle > 0,
            retryFailed = row.isFolder && row.filesFailed > 0,
        )
    }

    /** The header's second line: "3 running · ↓ 11.2 MB/s ↑ 6.1 MB/s", or "Nothing running". */
    fun headline(running: Int, waiting: Int, paused: Int, downBps: Long, upBps: Long): String {
        val activity = TransferActivity.summary(running, waiting, paused)
        val speed = listOfNotNull(
            downBps.takeIf { it > 0 }?.let { "↓ ${bytes(it)}/s" },
            upBps.takeIf { it > 0 }?.let { "↑ ${bytes(it)}/s" },
        ).joinToString("  ")
        return listOf(activity, speed).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Nothing running" }
    }

    /** Down and up speed of everything moving. */
    fun totalSpeeds(rows: List<TransferRow>): Pair<Long, Long> =
        rows.filter { it.state.moving }.let { moving -> moving.sumOf { it.downBps } to moving.sumOf { it.upBps } }

    /** "40 s", "7 min", "1 h 5 min". */
    fun duration(seconds: Long): String? = when {
        seconds <= 0 -> null
        seconds < 60 -> "$seconds s"
        seconds < 3600 -> "${(seconds + 30) / 60} min"
        else -> "${seconds / 3600} h ${(seconds % 3600) / 60} min"
    }

    private fun eta(left: Long, bps: Long): Long? = if (bps > 0 && left > 0) left / bps else null

    private fun fraction(done: Long, total: Long): Float = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else 0f

    private fun number(n: Int): String = NumberFormat.getIntegerInstance(Locale.ENGLISH).format(n)

    /** 62.4 GB, 8.1 MB, 512 B: the same as the rest of the app (1 GB is 1024 MB). */
    fun bytes(bytes: Long): String {
        if (bytes < 1024) return "${bytes.coerceAtLeast(0)} B"
        val units = listOf("KB", "MB", "GB", "TB")
        var value = bytes / 1024.0
        var unit = 0
        while (value >= 1024 && unit < units.lastIndex) {
            value /= 1024
            unit++
        }
        return String.format(Locale.US, if (value >= 100) "%.0f %s" else "%.1f %s", value, units[unit])
    }

    /** The server's times, with or without a zone (a missing one is UTC); 0 when unreadable. */
    fun isoMillis(iso: String?): Long {
        if (iso.isNullOrBlank()) return 0
        return runCatching { Instant.parse(iso).toEpochMilli() }
            .recoverCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
            .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli() }
            .getOrDefault(0)
    }
}

/**
 * A calm speed: an exponential moving average over about [windowSeconds] seconds, instead of each
 * one-second reading on its own (which jumps around). Feed it the bytes done so far.
 */
class SpeedSmoother(private val windowSeconds: Double = 5.0) {
    private var lastBytes = -1L
    private var lastAt = 0L
    private var speed = 0.0
    private var started = false

    /** The smoothed bytes per second after [bytesDone] at [nowMs]. */
    fun next(bytesDone: Long, nowMs: Long): Long {
        if (lastBytes < 0 || bytesDone < lastBytes) {
            // First reading, or the transfer started over: nothing to compare with yet
            lastBytes = bytesDone
            lastAt = nowMs
            speed = 0.0
            started = false
            return 0
        }
        val seconds = (nowMs - lastAt) / 1000.0
        if (seconds <= 0) return speed.roundToLong()
        val instant = (bytesDone - lastBytes) / seconds
        speed = if (!started) instant else speed + (1 - exp(-seconds / windowSeconds)) * (instant - speed)
        started = true
        lastBytes = bytesDone
        lastAt = nowMs
        return speed.roundToLong()
    }
}
