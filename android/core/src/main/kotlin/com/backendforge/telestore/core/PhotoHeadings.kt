package com.backendforge.telestore.core

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The words around the Photos timeline, like Google Photos (pure, so it is tested here). */
object PhotoHeadings {
    private val MONTH = DateTimeFormatter.ofPattern("MMMM", Locale.US)
    private val MONTH_YEAR = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.US)

    /** "Gandhinagar, Indroda Nature Park, Ahmedabad": each place once, in the order seen. */
    fun places(names: List<String?>): String =
        names.mapNotNull { it?.trim()?.ifBlank { null } }.distinctBy { it.lowercase() }.joinToString(", ")

    /**
     * The big month title ("October", "March 2025") goes above the first day of every month but
     * the current one, as Google Photos does. Null when [date] needs none.
     */
    fun monthTitle(previous: LocalDate?, date: LocalDate?, today: LocalDate = LocalDate.now()): String? {
        if (date == null) return null
        if (date.year == today.year && date.month == today.month) return null
        if (previous != null && previous.year == date.year && previous.month == date.month) return null
        return if (date.year == today.year) MONTH.format(date) else MONTH_YEAR.format(date)
    }

    private val VIEWER_DAY = DateTimeFormatter.ofPattern("MMM d", Locale.US)
    private val VIEWER_DAY_YEAR = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
    private val VIEWER_TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    /** The viewer's title: "Nov 1" this year, "Nov 1, 2025" before; null when undated. */
    fun viewerDay(millis: Long?, today: LocalDate = LocalDate.now(), zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String? {
        val at = millis?.takeIf { it > 0 }?.let { java.time.Instant.ofEpochMilli(it).atZone(zone) } ?: return null
        return if (at.year == today.year) VIEWER_DAY.format(at) else VIEWER_DAY_YEAR.format(at)
    }

    /** The viewer's second line: "6:35 PM • Gandhinagar, Gujarat" (either part alone). */
    fun viewerLine(millis: Long?, place: String?, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String {
        val time = millis?.takeIf { it > 0 }?.let { VIEWER_TIME.format(java.time.Instant.ofEpochMilli(it).atZone(zone)) }
        return listOfNotNull(time, place?.trim()?.ifBlank { null }).joinToString(" • ")
    }

    /** A video tile's length, as Google Photos writes it: "0:07", "02:47", "1:02:03". */
    fun videoLength(ms: Long?): String? {
        val s = ms?.takeIf { it > 0 }?.let { (it + 500) / 1000 } ?: return null
        return when {
            s >= 3600 -> String.format(Locale.US, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
            s >= 60 -> String.format(Locale.US, "%02d:%02d", s / 60, s % 60)
            else -> String.format(Locale.US, "0:%02d", s)
        }
    }

    /** Month view's titles: "November" this year, "March 2025" before, "Undated". */
    fun monthLabel(date: LocalDate?, today: LocalDate = LocalDate.now()): String = when {
        date == null -> "Undated"
        date.year == today.year -> MONTH.format(date)
        else -> MONTH_YEAR.format(date)
    }

    /** "Backing up 11 photos", "Backing up 1 photo", "Getting ready to back up". */
    fun backupTitle(pending: Int): String = when {
        pending <= 0 -> "Getting ready to back up"
        pending == 1 -> "Backing up 1 photo"
        else -> "Backing up $pending photos"
    }

    /**
     * "21 min remaining" from how long the photos done so far took. Null until there is enough
     * to go on (one photo done and a few seconds passed).
     */
    fun remaining(done: Int, pending: Int, startedAt: Long, now: Long): String? {
        if (pending <= 0) return null
        val elapsed = now - startedAt
        if (startedAt <= 0 || done <= 0 || elapsed < 5_000) return null
        val minutes = Math.ceil(elapsed.toDouble() / done * pending / 60_000).toLong()
        return when {
            minutes <= 1 -> "Less than a minute remaining"
            minutes < 60 -> "$minutes min remaining"
            minutes % 60 == 0L -> "${minutes / 60} h remaining"
            else -> "${minutes / 60} h ${minutes % 60} min remaining"
        }
    }
}
