package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.time.LocalDate
import java.time.ZoneOffset

class TimelineTest {
    private val today = LocalDate.of(2026, 10, 26)
    private fun photo(id: String, taken: String?, uploaded: String = "2026-10-26T10:00:00") =
        FileItem(id = id, name = "$id.jpg", type = "photo", takenAt = taken, modified = uploaded)

    @Test
    fun `days use the taken date, else the upload date`() {
        val days = Timeline.days(
            listOf(photo("a", "2026-10-26T08:00:00"), photo("b", "2026-10-25T23:00:00"), photo("c", null, "2026-10-24T09:00:00"), photo("d", "2025-01-02T09:00:00")),
            today, ZoneOffset.UTC,
        )
        assertEquals(listOf("Today", "Yesterday", "Sat, 24 Oct", "Thu, 2 Jan 2025"), days.map { it.label })
        assertEquals(listOf("a"), days[0].items.map { it.id })
        assertEquals("Oct 2026", Timeline.month(days[0].date))
    }

    @Test
    fun `memories find this day in earlier years and the last week`() {
        val items = listOf(
            photo("old1", "2024-10-26T10:00:00"), photo("old2", "2024-10-26T11:00:00"), photo("older", "2021-10-26T10:00:00"),
            photo("r1", "2026-10-25T10:00:00"), photo("r2", "2026-10-23T10:00:00"), photo("r3", "2026-10-21T10:00:00"), photo("r4", "2026-10-20T10:00:00"),
            photo("tooOld", "2026-10-10T10:00:00"),
        )
        val memories = Timeline.memories(items, today, ZoneOffset.UTC)
        assertEquals(listOf("2 years ago", "5 years ago", "Recent highlights"), memories.map { it.title })
        assertEquals(listOf("old1", "old2"), memories[0].items.map { it.id })
        assertEquals(4, memories[2].items.size)
    }
}
