package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneOffset

class ShareRulesTest {
    @Test
    fun `viewers only open and download`() {
        assertEquals(setOf(ShareAction.OPEN, ShareAction.DOWNLOAD), ShareRules.actions(ShareRole.VIEWER))
        ShareAction.entries.filter { it != ShareAction.OPEN && it != ShareAction.DOWNLOAD }.forEach {
            assertFalse(ShareRules.can(ShareRole.VIEWER, it), it.name)
        }
    }

    @Test
    fun `editors change things in a shared folder`() {
        assertEquals(ShareAction.entries.toSet(), ShareRules.actions(ShareRole.EDITOR))
    }

    @Test
    fun `the shared item itself can be renamed but not moved or trashed`() {
        val root = ShareRules.actions(ShareRole.EDITOR, isFolderShare = false, isRoot = true)
        assertTrue(ShareAction.RENAME in root)
        assertFalse(ShareAction.MOVE in root)
        assertFalse(ShareAction.TRASH in root)
        assertFalse(ShareAction.UPLOAD in root, "a shared file has no folder to upload into")
    }

    @Test
    fun `roles read from the server`() {
        assertEquals(ShareRole.EDITOR, ShareRole.of("editor"))
        assertEquals(ShareRole.VIEWER, ShareRole.of("viewer"))
        assertEquals(ShareRole.VIEWER, ShareRole.of(null))
        assertEquals(ShareRole.VIEWER, ShareRole.of("owner"))
    }

    @Test
    fun `link address`() {
        assertEquals("https://t.example.com/s/abc", ShareRules.linkUrl("https://t.example.com/", "abc"))
        assertEquals("https://t.example.com/s/abc", ShareRules.linkUrl("https://t.example.com", "abc"))
    }

    @Test
    fun `expiry presets`() {
        val now = Instant.parse("2026-11-04T10:15:30.123Z")
        assertNull(ShareRules.expiresAt(ExpiryPreset.NEVER, now))
        assertEquals("2026-11-05T10:15:30Z", ShareRules.expiresAt(ExpiryPreset.DAY, now))
        assertEquals("2026-11-11T10:15:30Z", ShareRules.expiresAt(ExpiryPreset.WEEK, now))
        assertEquals("2026-12-04T10:15:30Z", ShareRules.expiresAt(ExpiryPreset.MONTH, now))
    }

    @Test
    fun `expiry and limit as link settings`() {
        val now = Instant.parse("2026-11-04T10:00:00Z")
        assertEquals(LinkSettings(enabled = true, clearExpiry = true), ShareRules.expirySettings(ExpiryPreset.NEVER, now))
        assertEquals("2026-11-11T10:00:00Z", ShareRules.expirySettings(ExpiryPreset.WEEK, now).expiresAt)
        assertEquals(LinkSettings(enabled = true, clearLimit = true), ShareRules.limitSettings(null))
        assertEquals(LinkSettings(enabled = true, clearLimit = true), ShareRules.limitSettings(0))
        assertEquals(5, ShareRules.limitSettings(5).maxDownloads)
    }

    @Test
    fun `link state text`() {
        val on = ShareLink(enabled = true, token = "t", state = "active")
        assertEquals("Anyone with the link can view", ShareRules.linkStateText(on))
        assertEquals("Only people added can open", ShareRules.linkStateText(null))
        assertEquals("Only people added can open", ShareRules.linkStateText(on.copy(enabled = false, state = "off")))
        assertEquals("Link expired", ShareRules.linkStateText(on.copy(state = "expired")))
        assertEquals("Link download limit reached", ShareRules.linkStateText(on.copy(state = "used_up")))
        assertEquals("Link on", ShareRules.linkShortText(on))
        assertEquals("Link off", ShareRules.linkShortText(null))
        assertTrue(ShareRules.linkOn(on))
        assertFalse(ShareRules.linkOn(on.copy(enabled = false)))
    }

    @Test
    fun `access summary`() {
        val on = ShareLink(enabled = true, token = "t")
        assertEquals("1 person · Link on", ShareRules.accessSummary(1, on))
        assertEquals("3 people · Link off", ShareRules.accessSummary(3, null))
        assertEquals("No people · Link on", ShareRules.accessSummary(0, on))
    }

    @Test
    fun `downloads and expiry text`() {
        assertEquals("2 of 5 downloads used", ShareRules.downloadsText(ShareLink(maxDownloads = 5, downloads = 2)))
        assertEquals("No downloads yet", ShareRules.downloadsText(ShareLink()))
        assertEquals("1 download", ShareRules.downloadsText(ShareLink(downloads = 1)))
        assertEquals("4 downloads", ShareRules.downloadsText(ShareLink(downloads = 4)))
        assertEquals("Never expires", ShareRules.expiryText(null))
        assertTrue(ShareRules.expiryText("2026-12-01T00:00:00+00:00", ZoneOffset.UTC).startsWith("Expires Dec"))
    }

    @Test
    fun `vault and trashed items can't be shared`() {
        assertTrue(ShareRules.canShare(FileItem(id = "1", name = "a", path = "/Home")))
        assertFalse(ShareRules.canShare(FileItem(id = "1", name = "a", path = "/Home", isVault = true)))
        assertFalse(ShareRules.canShare(FileItem(id = "1", name = "a", path = "/Vault")))
        assertFalse(ShareRules.canShare(FileItem(id = "1", name = "a", path = "/Vault/Docs")))
        assertTrue(ShareRules.canShare(FileItem(id = "1", name = "a", path = "/Home/Vaults")))
        assertFalse(ShareRules.canShare(FileItem(id = "1", name = "a", trashed = true)))
        assertFalse(ShareRules.canShare(FileItem(id = "1", name = "a", shareId = "sh_1")), "someone else's item")
    }

    @Test
    fun `paths inside a share`() {
        assertEquals("/Day 1", ShareRules.childPath("", "Day 1"))
        assertEquals("/Day 1/Beach", ShareRules.childPath("/Day 1", "Beach"))
        assertEquals("", ShareRules.parentPath("/Day 1"))
        assertEquals("/Day 1", ShareRules.parentPath("/Day 1/Beach"))
        assertEquals(listOf("Trip" to "", "Day 1" to "/Day 1", "Beach" to "/Day 1/Beach"), ShareRules.crumbs("Trip", "/Day 1/Beach"))
        assertEquals(listOf("Trip" to ""), ShareRules.crumbs("Trip", ""))
    }

    @Test
    fun `a folder can't move into itself`() {
        val folder = ShareItem(id = "f", name = "Day 1", type = "folder", path = "")
        assertFalse(ShareRules.canMoveTo(folder, "/Day 1"))
        assertFalse(ShareRules.canMoveTo(folder, "/Day 1/Beach"))
        assertFalse(ShareRules.canMoveTo(folder, ""), "already there")
        assertTrue(ShareRules.canMoveTo(folder, "/Day 2"))
        assertTrue(ShareRules.canMoveTo(ShareItem(id = "p", name = "a.jpg", type = "photo", path = "/Day 1"), ""))
    }

    @Test
    fun `share items become file items for the viewers`() {
        val f = ShareItem(id = "p1", name = "beach.jpg", type = "photo", size = 12, hasThumb = true, path = "/Day 1").toFileItem("sh_1")
        assertEquals("sh_1", f.shareId)
        assertTrue(f.fromShare)
        assertEquals(FileKind.PHOTO, f.kind)
        assertEquals(12L, f.size)
        assertTrue(!f.thumbnail.isNullOrBlank())
        assertNull(ShareItem(id = "d", name = "Docs", type = "folder", hasThumb = true).toFileItem().thumbnail)
    }
}
