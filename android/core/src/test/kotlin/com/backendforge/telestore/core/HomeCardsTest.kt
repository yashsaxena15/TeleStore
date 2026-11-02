package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

class HomeCardsTest {
    private val now = ZonedDateTime.of(2026, 10, 29, 18, 0, 0, 0, ZoneOffset.UTC)

    @Test
    fun `camera made names are spotted`() {
        assertTrue(HomeCards.isCameraName("IMG_20261029_174512.jpg"))
        assertTrue(HomeCards.isCameraName("PXL_20261029_174512345.mp4"))
        assertTrue(HomeCards.isCameraName("VID_20261029_174512.mp4"))
        assertTrue(HomeCards.isCameraName("Screenshot_20261029-174512.png"))
        assertTrue(HomeCards.isCameraName("IMG-20261029-WA0001.jpg"))
        assertFalse(HomeCards.isCameraName("Dune Part Two.mkv"))
        assertFalse(HomeCards.isCameraName("Imagine.mp3"))
        assertFalse(HomeCards.isCameraName("IMG.jpg"))
    }

    @Test
    fun `photos show when they were taken`() {
        val photo = FileItem(id = "1", name = "IMG_20261029_171200.jpg", takenAt = "2026-10-29T17:12:00Z", modified = "2026-10-30T09:00:00Z")
        assertEquals("Today, 5:12 PM", HomeCards.recentLabel(photo, now))
        assertEquals("Yesterday, 9:03 AM", HomeCards.recentLabel(photo.copy(takenAt = "2026-10-28T09:03:00Z"), now))
        assertEquals("Oct 2", HomeCards.recentLabel(photo.copy(takenAt = "2026-10-02T09:03:00Z"), now))
        assertEquals("Oct 2, 2025", HomeCards.recentLabel(photo.copy(takenAt = "2025-10-02T09:03:00Z"), now))
    }

    @Test
    fun `without a taken date the upload date is used, and nothing when neither is known`() {
        val photo = FileItem(id = "1", name = "beach.jpg", modified = "2026-10-29T08:00:00Z")
        assertEquals("Today, 8:00 AM", HomeCards.recentLabel(photo, now))
        assertEquals("", HomeCards.recentLabel(photo.copy(modified = null), now))
    }

    @Test
    fun `days follow the phone's time zone`() {
        // 23:30 UTC on the 28th is already 5 AM on the 29th in India
        val photo = FileItem(id = "1", name = "IMG_1.jpg", takenAt = "2026-10-28T23:30:00Z")
        assertEquals("Today, 5:00 AM", HomeCards.recentLabel(photo, now, ZoneId.of("Asia/Kolkata")))
    }

    @Test
    fun `other files keep their name, camera named videos show the date`() {
        assertEquals("Q3 report.pdf", HomeCards.recentLabel(FileItem(id = "1", name = "Q3 report.pdf", modified = "2026-10-29T08:00:00Z"), now))
        assertEquals("Today, 8:00 AM", HomeCards.recentLabel(FileItem(id = "2", name = "VID_20261029_080000.mp4", modified = "2026-10-29T08:00:00Z"), now))
    }
}
