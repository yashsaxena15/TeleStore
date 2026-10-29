package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** Vault items stay private outside the vault; Transfers counts what's really running. */
class PrivacyAndCountsTest {
    @Test
    fun `vault items are recognised by flag or by path`() {
        assertTrue(FileItem(id = "a", name = "v.mp4", path = "/Vault").inVault)
        assertTrue(FileItem(id = "b", name = "v.mp4", path = "/Vault/Trips").inVault)
        assertTrue(FileItem(id = "c", name = "v.mp4", path = "/Home", isVault = true).inVault)
        assertFalse(FileItem(id = "d", name = "v.mp4", path = "/Home/Vaulted").inVault)
        assertFalse(FileItem(id = "e", name = "v.mp4", path = "/VaultX").inVault)
    }

    @Test
    fun `the lock screen never names a vault item`() {
        val video = FileItem(id = "a", name = "VID-1.mp4", type = "video", path = "/Vault/Trips")
        val song = FileItem(id = "b", name = "Softly.mp3", type = "audio", path = "/Vault")
        val public = FileItem(id = "c", name = "Softly.mp3", type = "audio", path = "/Home/Music")
        assertEquals("Private video" to "TeleStore", PlayQueue.publicTitle(video) to PlayQueue.publicSubtitle(video))
        assertEquals("Private audio" to "TeleStore", PlayQueue.publicTitle(song) to PlayQueue.publicSubtitle(song))
        assertEquals("Softly" to "Music", PlayQueue.publicTitle(public) to PlayQueue.publicSubtitle(public))
    }

    @Test
    fun `files paused by Google's limit aren't running`() {
        val summary = TeleStoreApi.json.decodeFromString(
            GroupSummary.serializer(),
            """{"total": 2970, "counts": {"completed": 326, "downloading": 1, "queued": 2, "paused_quota": 2641}, "resumes_at": "2026-10-30T10:38:00Z"}""",
        )
        assertEquals(1, summary.running)
        assertEquals(2, summary.waiting)
        assertEquals(2641, summary.pausedByGoogle)
        assertEquals(2644, summary.active)
        assertEquals("2026-10-30T10:38:00Z", summary.resumesAt)
    }

    @Test
    fun `the header says what's running, waiting and paused, like the website`() {
        assertEquals("2 running · 2 waiting · 2,641 paused by Google's limit", TransferActivity.summary(2, 2, 2641))
        assertEquals("5 paused by Google's limit", TransferActivity.summary(0, 0, 5))
        assertEquals("", TransferActivity.summary(0, 0, 0))
    }

    @Test
    fun `a paused folder says when it resumes, in local time`() {
        val india = ZoneId.of("Asia/Kolkata")
        val today = LocalDate.of(2026, 10, 29)
        assertEquals("resumes tomorrow at 4:08 PM", TransferActivity.resumes("2026-10-30T10:38:00Z", india, today, Locale.ENGLISH))
        assertEquals("resumes at 11:30 PM", TransferActivity.resumes("2026-10-29T18:00:00Z", india, today, Locale.ENGLISH))
        assertEquals("resumes 2 Nov at 5:30 AM", TransferActivity.resumes("2026-11-02T00:00:00Z", india, today, Locale.ENGLISH))
        assertNull(TransferActivity.resumes(null, india, today))
        assertNull(TransferActivity.resumes("soon", india, today))
    }
}
