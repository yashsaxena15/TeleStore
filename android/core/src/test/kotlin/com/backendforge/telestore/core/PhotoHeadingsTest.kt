package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.LocalDate

class PhotoHeadingsTest {
    private val today = LocalDate.of(2026, 11, 1)

    @Test
    fun `places are listed once each in the order seen`() {
        assertEquals(
            "Gandhinagar, Indroda Nature Park, Ahmedabad",
            PhotoHeadings.places(listOf("Gandhinagar", null, "Indroda Nature Park", " ", "gandhinagar", "Ahmedabad")),
        )
        assertEquals("", PhotoHeadings.places(listOf(null, "")))
    }

    @Test
    fun `a month title goes above the first day of each earlier month`() {
        assertNull(PhotoHeadings.monthTitle(null, today, today))
        assertNull(PhotoHeadings.monthTitle(today, LocalDate.of(2026, 11, 1), today))
        assertEquals("October", PhotoHeadings.monthTitle(today, LocalDate.of(2026, 10, 31), today))
        assertNull(PhotoHeadings.monthTitle(LocalDate.of(2026, 10, 31), LocalDate.of(2026, 10, 29), today))
        assertEquals("December 2025", PhotoHeadings.monthTitle(LocalDate.of(2026, 1, 3), LocalDate.of(2025, 12, 30), today))
        assertNull(PhotoHeadings.monthTitle(today, null, today))
    }

    @Test
    fun `month view names every month`() {
        assertEquals("November", PhotoHeadings.monthLabel(today, today))
        assertEquals("March 2025", PhotoHeadings.monthLabel(LocalDate.of(2025, 3, 9), today))
        assertEquals("Undated", PhotoHeadings.monthLabel(null, today))
    }

    @Test
    fun `backup title counts the photos left`() {
        assertEquals("Backing up 11 photos", PhotoHeadings.backupTitle(11))
        assertEquals("Backing up 1 photo", PhotoHeadings.backupTitle(1))
        assertEquals("Getting ready to back up", PhotoHeadings.backupTitle(0))
    }

    @Test
    fun `time remaining follows the pace so far`() {
        val start = 1_000_000L
        assertNull(PhotoHeadings.remaining(0, 10, start, start + 60_000))
        assertNull(PhotoHeadings.remaining(1, 10, start, start + 2_000))
        assertNull(PhotoHeadings.remaining(1, 10, 0, start))
        // 2 photos in 4 min: 11 more take 22 min
        assertEquals("22 min remaining", PhotoHeadings.remaining(2, 11, start, start + 240_000))
        assertEquals("Less than a minute remaining", PhotoHeadings.remaining(10, 1, start, start + 50_000))
        assertEquals("2 h remaining", PhotoHeadings.remaining(1, 12, start, start + 600_000))
        assertEquals("1 h 5 min remaining", PhotoHeadings.remaining(1, 13, start, start + 300_000))
    }
}
