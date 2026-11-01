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
