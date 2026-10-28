package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

class PhotoMergeTest {
    private fun ms(iso: String) = Instant.parse("${iso}Z").toEpochMilli()
    private fun server(id: String, taken: String?, name: String = "$id.jpg", size: Long = 100, uploaded: String = "2026-10-26T10:00:00") =
        FileItem(id = id, name = name, type = "photo", size = size, takenAt = taken, modified = uploaded)
    private fun phone(key: String, taken: String, name: String = "$key.jpg", size: Long = 100, video: Boolean = false) =
        LocalPhoto(key = key, name = name, size = size, takenAtMillis = ms(taken), video = video, uri = "content://media/$key")

    @Test
    fun `a phone photo and its backed-up copy are one entry, matched by name and size`() {
        val entries = PhotoMerge.merge(
            server = listOf(server("s1", "2026-10-26T08:00:00", name = "IMG_1.jpg", size = 500)),
            local = listOf(
                phone("k1", "2026-10-26T08:00:00", name = "IMG_1.jpg", size = 500),
                phone("k2", "2026-10-26T09:00:00", name = "IMG_1.jpg", size = 501), // same name, other size: another photo
            ),
            backedUpKeys = emptySet(), serverHasMore = false,
        )
        assertEquals(2, entries.size)
        val both = entries.single { it.server != null }
        assertEquals("s1", both.id)
        assertEquals("k1", both.local?.key)
        assertTrue(both.backedUp)
        val phoneOnly = entries.single { it.server == null }
        assertEquals("local:k2", phoneOnly.id)
        assertTrue(phoneOnly.phoneOnly)
        assertFalse(phoneOnly.backedUp)
    }

    @Test
    fun `a phone photo the backup remembers counts as backed up before its server copy loads`() {
        val entries = PhotoMerge.merge(emptyList(), listOf(phone("k1", "2026-10-20T08:00:00")), setOf("k1"), serverHasMore = false)
        assertTrue(entries.single().backedUp)
        assertTrue(entries.single().phoneOnly)
    }

    @Test
    fun `newest first across phone and server, undated last`() {
        val entries = PhotoMerge.merge(
            server = listOf(server("s1", "2026-10-25T10:00:00"), server("s2", null, uploaded = "bad date"), server("s3", "2026-10-20T10:00:00")),
            local = listOf(phone("p1", "2026-10-26T10:00:00"), phone("p2", "2026-10-22T10:00:00"), phone("p3", "2026-01-01T10:00:00")),
            backedUpKeys = emptySet(), serverHasMore = false,
        )
        assertEquals(listOf("local:p1", "s1", "local:p2", "s3", "local:p3", "s2"), entries.map { it.id })
        assertNull(entries.last().takenAtMillis)
    }

    @Test
    fun `while the server has more pages, older phone-only photos wait for them`() {
        val serverPage = listOf(server("s1", "2026-10-25T10:00:00"), server("s2", "2026-10-20T10:00:00"))
        val local = listOf(
            phone("new", "2026-10-26T10:00:00"),
            phone("edge", "2026-10-20T10:00:00"), // same time as the oldest loaded: shown
            phone("old", "2026-10-01T10:00:00"),
            phone("oldTwin", "2026-10-01T10:00:00", name = "s2.jpg"), // matches s2 by name and size: always with it
        )
        val more = PhotoMerge.merge(serverPage, local, emptySet(), serverHasMore = true)
        assertEquals(setOf("local:new", "s1", "s2", "local:edge"), more.map { it.id }.toSet())
        assertEquals("oldTwin", more.single { it.id == "s2" }.local?.key)

        val all = PhotoMerge.merge(serverPage, local, emptySet(), serverHasMore = false)
        assertEquals(listOf("local:new", "s1", "s2", "local:edge", "local:old"), all.map { it.id })
    }

    @Test
    fun `before the first server page nothing from the phone shows, unless the server has nothing`() {
        val local = listOf(phone("p1", "2026-10-26T10:00:00"))
        assertTrue(PhotoMerge.merge(emptyList(), local, emptySet(), serverHasMore = true).isEmpty())
        assertEquals(1, PhotoMerge.merge(emptyList(), local, emptySet(), serverHasMore = false).size)
    }

    @Test
    fun `a video on the phone stays a video, the server's kind otherwise`() {
        val entries = PhotoMerge.merge(
            listOf(FileItem(id = "v", name = "clip.mp4", type = "video", size = 9, takenAt = "2026-10-20T10:00:00")),
            listOf(phone("pv", "2026-10-21T10:00:00", video = true)),
            emptySet(), serverHasMore = false,
        )
        assertTrue(entries.all { it.video })
    }

    @Test
    fun `days group phone and server entries by the taken day`() {
        val entries = PhotoMerge.merge(
            listOf(server("s1", "2026-10-26T08:00:00"), server("s2", "2026-10-24T09:00:00")),
            listOf(phone("p1", "2026-10-26T09:00:00"), phone("p2", "2026-10-25T23:00:00"), phone("p3", "2025-01-02T09:00:00")),
            emptySet(), serverHasMore = false,
        )
        val days = PhotoMerge.days(entries, LocalDate.of(2026, 10, 26), ZoneOffset.UTC)
        assertEquals(listOf("Today", "Yesterday", "Sat, 24 Oct", "Thu, 2 Jan 2025"), days.map { it.label })
        assertEquals(listOf("local:p1", "s1"), days[0].entries.map { it.id })
        assertEquals(LocalDate.of(2026, 10, 24), days[2].date)
    }

    @Test
    fun `the backup ring and line`() {
        val now = 1_000_000_000L
        assertEquals(BackupRing.OFF, BackupSummary.ring(enabled = false, running = true, message = null))
        assertEquals(BackupRing.RUNNING, BackupSummary.ring(true, true, null))
        assertEquals(BackupRing.OK, BackupSummary.ring(true, false, null))
        assertEquals(BackupRing.WAITING, BackupSummary.ring(true, false, "Paused · 3 left"))
        assertEquals(BackupRing.WAITING, BackupSummary.ring(true, false, "Waiting for the connection · 3 left"))
        assertEquals(BackupRing.PROBLEM, BackupSummary.ring(true, false, "Signed out. Sign in to continue the backup."))

        assertEquals("Backup is off", BackupSummary.line(false, false, 0, 0, 0, null, now))
        assertEquals("Backing up 3 of 40", BackupSummary.line(true, true, 2, 38, 0, null, now))
        assertEquals("Backing up 40 of 40", BackupSummary.line(true, true, 40, 0, 0, null, now))
        assertEquals("Backed up · 5 min ago", BackupSummary.line(true, false, 0, 0, now - 5 * 60_000, null, now))
        assertEquals("Paused · 3 left", BackupSummary.line(true, false, 0, 3, now - 5 * 60_000, "Paused · 3 left", now))
        assertEquals("Waiting to start…", BackupSummary.line(true, false, 0, 0, 0, null, now))

        assertEquals("just now", BackupSummary.ago(now - 10_000, now))
        assertEquals("3 h ago", BackupSummary.ago(now - 3 * 3_600_000, now))
        assertEquals("yesterday", BackupSummary.ago(now - 30 * 3_600_000, now))
        assertEquals("4 days ago", BackupSummary.ago(now - 4 * 86_400_000L, now))
    }

    private fun inAlbum(key: String, bucketId: String, bucket: String, video: Boolean = false) =
        LocalPhoto(key = key, name = "$key.jpg", size = 1, takenAtMillis = 0, video = video, uri = "content://media/$key", bucketId = bucketId, bucket = bucket)

    private val phone = listOf(
        inAlbum("c1", "cam", "Camera"), inAlbum("c2", "cam", "Camera", video = true),
        inAlbum("w1", "wa", "WhatsApp Images"), inAlbum("w2", "wa", "WhatsApp Images"), inAlbum("w3", "wa", "WhatsApp Images"),
        inAlbum("s1", "shots", "Screenshots"),
    )

    @Test
    fun `only the albums chosen for backup show`() {
        assertEquals(listOf("w1", "w2", "w3", "s1"), PhotoMerge.inBackupAlbums(phone, setOf("wa", "shots")).map { it.key })
    }

    @Test
    fun `with none chosen it is Camera, like the backup`() {
        assertEquals(listOf("c1", "c2"), PhotoMerge.inBackupAlbums(phone, emptySet()).map { it.key })
        // No Camera album: the biggest one
        assertEquals("wa", PhotoMerge.defaultAlbum(phone.filter { it.bucketId != "cam" }))
        assertTrue(PhotoMerge.inBackupAlbums(emptyList(), emptySet()).isEmpty())
    }

    @Test
    fun `videos stay out when the backup leaves them out`() {
        assertEquals(listOf("c1"), PhotoMerge.inBackupAlbums(phone, setOf("cam"), includeVideos = false).map { it.key })
    }
}
