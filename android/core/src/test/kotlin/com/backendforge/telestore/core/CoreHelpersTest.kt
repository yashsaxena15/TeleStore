package com.backendforge.telestore.core

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.ZoneId
import java.time.ZoneOffset

class CoreHelpersTest {
    @Test
    fun `server addresses are cleaned up`() {
        assertEquals("https://telegram.backendforge.qd.je/", ServerAddress.normalize("telegram.backendforge.qd.je")!!.toString())
        assertEquals("https://example.com/", ServerAddress.normalize(" https://example.com/some/page?x=1 ")!!.toString())
        assertEquals("http://192.168.1.5:9000/", ServerAddress.normalize("http://192.168.1.5:9000")!!.toString())
        assertNull(ServerAddress.normalize(""))
        assertNull(ServerAddress.normalize("ftp://example.com"))
        assertNull(ServerAddress.normalize("not a url"))
    }

    @Test
    fun `file kinds follow the website`() {
        assertEquals(FileKind.VIDEO, FileKinds.of("Dune.Part.Two.MKV"))
        assertEquals(FileKind.AUDIO, FileKinds.of("Strangers.mp3"))
        assertEquals(FileKind.AUDIO, FileKinds.of("Voice_1", "voice"))
        assertEquals(FileKind.PHOTO, FileKinds.of("team.jpeg"))
        assertEquals(FileKind.ARCHIVE, FileKinds.of("src.zip"))
        assertEquals(FileKind.DOCUMENT, FileKinds.of("Q3.pdf"))
        assertEquals(FileKind.OTHER, FileKinds.of("README"))
        assertEquals("", FileKinds.extension("README"))
    }

    @Test
    fun `media links carry the file id and token, and encode names`() {
        val urls = MediaUrls("https://ts.example/".toHttpUrl()) { "tok" }
        val item = FileItem(id = "abc", name = "My Movie #1 (2024).mkv", thumbnail = "AAMC")
        val file = urls.file(item)
        assertEquals("/dl/My%20Movie%20%231%20(2024).mkv", file.encodedPath)
        assertEquals("abc", file.queryParameter("file_id"))
        assertEquals("tok", file.queryParameter("token"))
        assertEquals("1", file.queryParameter("inline"))
        assertNull(urls.file(item, inline = false).queryParameter("inline"))
        assertEquals("tok", urls.thumbnail(item)!!.queryParameter("auth_token"))
        assertNull(urls.thumbnail(item.copy(thumbnail = null)))
        val converted = urls.converted(item, quality = "480p", audioTrack = 1)
        assertEquals("480p", converted.queryParameter("quality"))
        assertEquals("1", converted.queryParameter("audio_track"))
        assertEquals("abc", urls.info(item).queryParameter("file_id"))
    }

    @Test
    fun `folder paths calculates childPath parent crumbs and isInside`() {
        // childPath with spaces and brackets
        val folder = FileItem(id = "1", name = "Sci-Fi & Action [2024]", path = "/Home/Movies", type = "folder")
        assertEquals("/Home/Movies/Sci-Fi & Action [2024]", FolderPaths.childPath(folder))
        assertEquals("/Home/Movies/Sci-Fi & Action [2024]", FolderPaths.childPath("/Home/Movies", "Sci-Fi & Action [2024]"))

        // parent
        assertEquals("/Home/Movies", FolderPaths.parent("/Home/Movies/2024"))
        assertEquals("/Home", FolderPaths.parent("/Home/Movies"))
        assertNull(FolderPaths.parent("/Home"))
        assertNull(FolderPaths.parent("starred"))
        assertNull(FolderPaths.parent(""))

        // crumbs
        val crumbs = FolderPaths.crumbs("/Home/Movies/Sci-Fi [2024]")
        assertEquals(
            listOf(
                "Home" to "/Home",
                "Movies" to "/Home/Movies",
                "Sci-Fi [2024]" to "/Home/Movies/Sci-Fi [2024]"
            ),
            crumbs
        )
        assertEquals(listOf("Home" to "/Home"), FolderPaths.crumbs("/Home"))
        assertEquals(listOf("Starred" to "starred"), FolderPaths.crumbs("starred"))
        assertEquals(listOf("Recent" to "all"), FolderPaths.crumbs("all"))

        // isInside prevents moving into self or subfolder, but allows sibling prefixes
        assertTrue(FolderPaths.isInside("/Home/Movies", "/Home/Movies"))
        assertTrue(FolderPaths.isInside("/Home/Movies/Action", "/Home/Movies"))
        assertTrue(FolderPaths.isInside("/Home/Movies/Action/2024", "/Home/Movies"))
        assertFalse(FolderPaths.isInside("/Home/Movies 2", "/Home/Movies"))
        assertFalse(FolderPaths.isInside("/Home/Other", "/Home/Movies"))
        assertFalse(FolderPaths.isInside("/Home", "/Home/Movies"))
    }

    @Test
    fun `places map path and sort rules`() {
        assertEquals(Place.HOME, Places.fromPath("/Home"))
        assertEquals(Place.STARRED, Places.fromPath("starred"))
        assertEquals(Place.RECENT, Places.fromPath("all"))
        assertEquals(Place.TRASH, Places.fromPath("trash"))
        assertEquals(Place.INBOX, Places.fromPath("inbox"))
        assertNull(Places.fromPath("/Home/Sub"))

        assertTrue(Places.isSpecial("starred"))
        assertTrue(Places.isSpecial("all"))
        assertTrue(Places.isSpecial("trash"))
        assertTrue(Places.isSpecial("inbox"))
        assertFalse(Places.isSpecial("/Home"))
        assertFalse(Places.isSpecial("/Home/Movies"))
    }

    @Test
    fun `date formatter handles standard and legacy formats`() {
        val utc = ZoneOffset.UTC
        // Short format
        assertEquals("Oct 22", DateFormatter.formatShort("2026-10-22T14:30:00Z", zoneId = utc, currentYear = 2026))
        assertEquals("Oct 22, 2025", DateFormatter.formatShort("2025-10-22T14:30:00Z", zoneId = utc, currentYear = 2026))
        // Legacy without timezone assumed UTC
        assertEquals("May 15", DateFormatter.formatShort("2026-05-15 10:00:00", zoneId = utc, currentYear = 2026))

        // Full format
        assertEquals("Oct 22, 2026, 2:30 PM", DateFormatter.formatFull("2026-10-22T14:30:00Z", zoneId = utc))
    }
}

