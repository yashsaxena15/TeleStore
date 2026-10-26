package com.backendforge.telestore.core

import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/** One day of the Photos timeline: its heading and the photos and videos from it. */
data class TimelineDay(val date: LocalDate?, val label: String, val items: List<FileItem>)

/** A "memory" card above the timeline. */
data class Memory(val title: String, val items: List<FileItem>)

/** Groups photos into days and finds memories, like Google Photos (pure, so it is tested here). */
object Timeline {
    private val SAME_YEAR = DateTimeFormatter.ofPattern("EEE, d MMM", Locale.US)
    private val OTHER_YEAR = DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.US)
    private val MONTH = DateTimeFormatter.ofPattern("MMM yyyy", Locale.US)

    fun dateOf(item: FileItem, zone: ZoneId = ZoneId.systemDefault()): LocalDate? =
        DateFormatter.parseIso(item.timelineDate)?.withZoneSameInstant(zone)?.toLocalDate()

    /** Newest day first; items keep the server's order inside a day. */
    fun days(items: List<FileItem>, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): List<TimelineDay> {
        val groups = LinkedHashMap<LocalDate?, MutableList<FileItem>>()
        items.forEach { groups.getOrPut(dateOf(it, zone)) { mutableListOf() } += it }
        return groups.map { (date, list) -> TimelineDay(date, label(date, today), list) }
    }

    fun label(date: LocalDate?, today: LocalDate = LocalDate.now()): String = when {
        date == null -> "Undated"
        date == today -> "Today"
        date == today.minusDays(1) -> "Yesterday"
        date.year == today.year -> SAME_YEAR.format(date)
        else -> OTHER_YEAR.format(date)
    }

    /** "Oct 2026" for the date scrubber. */
    fun month(date: LocalDate?): String = date?.let { MONTH.format(it) } ?: ""

    /** "On this day" (earlier years, same day) and "Recent highlights" (the last 7 days). */
    fun memories(items: List<FileItem>, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): List<Memory> {
        val dated = items.mapNotNull { item -> dateOf(item, zone)?.let { it to item } }
        val result = mutableListOf<Memory>()
        dated.filter { (d, _) -> d.year < today.year && d.monthValue == today.monthValue && d.dayOfMonth == today.dayOfMonth }
            .groupBy { it.first.year }.toSortedMap(compareByDescending { it })
            .forEach { (year, list) ->
                val years = today.year - year
                result += Memory(if (years == 1) "1 year ago" else "$years years ago", list.map { it.second })
            }
        val recent = dated.filter { (d, _) -> ChronoUnit.DAYS.between(d, today) in 0..6 }.map { it.second }
        if (recent.size >= 4) result += Memory("Recent highlights", recent.take(30))
        return result
    }
}
