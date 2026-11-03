package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class SharesTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok-123" })
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private fun RecordedRequest.json(): JsonObject = TeleStoreApi.json.parseToJsonElement(body.readUtf8()).jsonObject

    private val item = """{"id":"f1","name":"Trip","type":"folder","size":0,"modified_date":"2026-11-01T10:00:00","taken_at":null,"duration":null,"has_thumb":false,"path":""}"""
    private val view = """{"share_id":"sh_1","item":$item,
        "link":{"enabled":true,"token":"abc","allow_download":false,"expires_at":"2026-12-01T00:00:00+00:00","max_downloads":5,"downloads":2,"state":"active","extra":1},
        "members":[{"user_id":"222","username":"alice","name":"Alice","email":null,"role":"editor"}],"new_key":true}"""

    @Test
    fun `share dialog reads the link and people`() = runTest {
        server.enqueue(json(view))
        val v = api.shareView("f1")
        assertEquals("/shares/item/f1", server.takeRequest().path)
        assertEquals("sh_1", v.shareId)
        assertTrue(v.item.isFolder)
        val link = v.link!!
        assertEquals("abc", link.token)
        assertFalse(link.allowDownload)
        assertEquals(5, link.maxDownloads)
        assertEquals(2, link.downloads)
        assertEquals(ShareRole.EDITOR, v.members.single().shareRole)
        assertNull(v.members.single().email)
    }

    @Test
    fun `not shared yet has no link or people`() = runTest {
        server.enqueue(json("""{"share_id":null,"item":$item,"link":null,"members":[]}"""))
        val v = api.shareView("f1")
        assertNull(v.shareId)
        assertNull(v.link)
        assertTrue(v.members.isEmpty())
    }

    @Test
    fun `link settings send only what changes`() = runTest {
        server.enqueue(json(view))
        api.setShareLink("f1", LinkSettings(enabled = true, allowDownload = false, maxDownloads = 5))
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/shares/item/f1/link", req.path)
        val body = req.json()
        assertTrue(body["enabled"]!!.jsonPrimitive.boolean)
        assertFalse(body["allow_download"]!!.jsonPrimitive.boolean)
        assertEquals(5, body["max_downloads"]!!.jsonPrimitive.int)
        assertFalse("expires_at" in body)
        assertFalse("clear_expiry" in body)
        assertFalse("clear_limit" in body)
    }

    @Test
    fun `clearing the expiry and limit`() = runTest {
        server.enqueue(json(view))
        api.setShareLink("f1", LinkSettings(enabled = true, clearExpiry = true, clearLimit = true))
        val body = server.takeRequest().json()
        assertTrue(body["clear_expiry"]!!.jsonPrimitive.boolean)
        assertTrue(body["clear_limit"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `turning the link off`() = runTest {
        server.enqueue(json(view))
        api.setShareLink("f1", LinkSettings(enabled = false))
        assertFalse(server.takeRequest().json()["enabled"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `reset link posts`() = runTest {
        server.enqueue(json(view))
        api.resetShareLink("f1")
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/shares/item/f1/link/reset", req.path)
    }

    @Test
    fun `adding someone sends who and role`() = runTest {
        server.enqueue(json(view))
        api.addShareMember("f1", " alice@example.com ", ShareRole.EDITOR)
        val req = server.takeRequest()
        assertEquals("/shares/item/f1/members", req.path)
        val body = req.json()
        assertEquals("alice@example.com", body["who"]!!.jsonPrimitive.content)
        assertEquals("editor", body["role"]!!.jsonPrimitive.content)
    }

    @Test
    fun `an unknown person shows the server's message`() = runTest {
        server.enqueue(json("""{"detail":"No TeleStore account with that username or email."}""", 404))
        val e = assertThrows<ApiException> { api.addShareMember("f1", "nobody", ShareRole.VIEWER) }
        assertEquals(404, e.status)
        assertEquals("No TeleStore account with that username or email.", e.message)
    }

    @Test
    fun `changing a role patches the member`() = runTest {
        server.enqueue(json(view))
        api.setShareMemberRole("f1", "222", ShareRole.VIEWER)
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("/shares/item/f1/members/222", req.path)
        assertEquals("viewer", req.json()["role"]!!.jsonPrimitive.content)
    }

    @Test
    fun `removing someone and stopping sharing return the view`() = runTest {
        server.enqueue(json(view))
        server.enqueue(json("""{"share_id":null,"item":$item,"link":null,"members":[]}"""))
        api.removeShareMember("f1", "222")
        val removed = server.takeRequest()
        assertEquals("DELETE", removed.method)
        assertEquals("/shares/item/f1/members/222", removed.path)
        val stopped = api.stopSharing("f1")
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals("/shares/item/f1", req.path)
        assertNull(stopped.shareId)
    }

    @Test
    fun `vault items are refused`() = runTest {
        server.enqueue(json("""{"detail":"Vault items can't be shared."}""", 400))
        val e = assertThrows<ApiException> { api.shareView("v1") }
        assertEquals(400, e.status)
    }

    @Test
    fun `shared by me lists counts and link state`() = runTest {
        server.enqueue(json("""{"shares":[{"share_id":"sh_1","item":$item,"trashed":false,
            "link":{"enabled":false,"token":"abc","allow_download":true,"expires_at":null,"max_downloads":null,"downloads":0,"state":"off"},
            "members":3,"created_at":"2026-11-01T10:00:00+00:00"}]}"""))
        val mine = api.sharedByMe()
        assertEquals("/shares/mine", server.takeRequest().path)
        assertEquals(3, mine.single().members)
        assertEquals("off", mine.single().link!!.state)
    }

    @Test
    fun `shared with me has the owner and role`() = runTest {
        server.enqueue(json("""{"shares":[{"share_id":"sh_1","role":"editor","owner":{"username":"bob","name":"Bob"},"item":$item,"shared_at":"2026-11-02T10:00:00+00:00"}]}"""))
        val withMe = api.sharedWithMe().single()
        assertEquals("/shares/with-me", server.takeRequest().path)
        assertEquals(ShareRole.EDITOR, withMe.shareRole)
        assertEquals("Bob", withMe.owner.name)
    }

    @Test
    fun `browsing a folder inside a share`() = runTest {
        server.enqueue(json("""{"share_id":"sh_1","role":"viewer","owner":{"name":"Bob"},"root":$item,"path":"/Day 1",
            "items":[{"id":"p1","name":"beach.jpg","type":"photo","size":1234,"has_thumb":true,"path":"/Day 1"}]}"""))
        val page = api.browseShare("sh_1", "/Day 1")
        val req = server.takeRequest()
        assertEquals("/shares/sh_1/browse", req.requestUrl!!.encodedPath)
        assertEquals("/Day 1", req.requestUrl!!.queryParameter("path"))
        assertEquals(ShareRole.VIEWER, page.shareRole)
        assertEquals("beach.jpg", page.items.single().name)
        assertTrue(page.items.single().hasThumb)
    }

    @Test
    fun `zip info for a shared folder`() = runTest {
        server.enqueue(json("""{"folder_name":"Trip","total_files":2,"total_size":10,"total_parts":1,
            "parts":[{"part_index":1,"name":"Trip.zip","size":10,"files_count":2,"download_url":"/shares/sh_1/zip?path=&part=1"}]}"""))
        val info = api.shareZipInfo("sh_1", "")
        assertEquals("/shares/sh_1/zip-info", server.takeRequest().requestUrl!!.encodedPath)
        assertEquals("/shares/sh_1/zip?path=&part=1", info.parts.single().downloadUrl)
    }

    @Test
    fun `editor changes go to the share`() = runTest {
        repeat(4) { server.enqueue(json("""{"message":"ok"}""")) }
        api.shareNewFolder("sh_1", "/Day 1", " New ")
        server.takeRequest().let {
            assertEquals("/shares/sh_1/folders", it.path)
            val b = it.json()
            assertEquals("/Day 1", b["path"]!!.jsonPrimitive.content)
            assertEquals("New", b["name"]!!.jsonPrimitive.content)
        }
        api.shareRename("sh_1", "p1", "sea.jpg")
        server.takeRequest().let {
            assertEquals("/shares/sh_1/rename", it.path)
            assertEquals("sea.jpg", it.json()["new_name"]!!.jsonPrimitive.content)
        }
        api.shareMove("sh_1", "p1", "")
        server.takeRequest().let {
            assertEquals("/shares/sh_1/move", it.path)
            assertEquals("", it.json()["target_path"]!!.jsonPrimitive.content)
        }
        api.shareTrash("sh_1", "p1")
        server.takeRequest().let {
            assertEquals("/shares/sh_1/trash", it.path)
            assertEquals("p1", it.json()["file_id"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun `a viewer's change is refused with the server's message`() = runTest {
        server.enqueue(json("""{"detail":"You can only view this folder."}""", 403))
        val e = assertThrows<ApiException> { api.shareTrash("sh_1", "p1") }
        assertEquals(403, e.status)
        assertEquals("You can only view this folder.", e.message)
    }

    @Test
    fun `upload init carries the share`() = runTest {
        server.enqueue(json("""{"upload_id":"u1","chunk_size":1024,"total_chunks":1}"""))
        api.uploadInit("a.jpg", 10, "/Day 1", shareId = "sh_1")
        val body = server.takeRequest().json()
        assertEquals("sh_1", body["share_id"]!!.jsonPrimitive.content)
        assertEquals("/Day 1", body["path"]!!.jsonPrimitive.content)
    }

    @Test
    fun `normal upload init has no share`() = runTest {
        server.enqueue(json("""{"upload_id":"u1","chunk_size":1024,"total_chunks":1}"""))
        api.uploadInit("a.jpg", 10, "/Home")
        assertFalse("share_id" in server.takeRequest().json())
    }

    @Test
    fun `files carry the shared marker`() = runTest {
        server.enqueue(json("""{"files":[{"id":"1","file_name":"a.jpg","shared":true},{"id":"2","file_name":"b.jpg"}]}"""))
        val files = api.listFiles().files
        assertTrue(files[0].shared)
        assertFalse(files[1].shared)
        assertNull(files[0].shareId)
    }

    @Test
    fun `shared files stream and show thumbnails through the share`() {
        val file = ShareItem(id = "p1", name = "beach.jpg", type = "photo", hasThumb = true).toFileItem("sh_1")
        val stream = api.media.file(file)
        assertEquals("/shares/sh_1/dl/p1", stream.encodedPath)
        assertEquals("1", stream.queryParameter("inline"))
        assertEquals("tok-123", stream.queryParameter("token"))
        assertNull(api.media.file(file, inline = false).queryParameter("inline"))
        assertEquals("/shares/sh_1/thumb/p1", api.media.picture(file)!!.encodedPath)
        assertNull(api.media.preview(file))
        assertEquals("/shares/sh_1/dl/p1", api.media.converted(file, quality = "720p").encodedPath)
        val noThumb = ShareItem(id = "d1", name = "a.pdf", type = "document").toFileItem("sh_1")
        assertNull(api.media.picture(noThumb))
    }

    @Test
    fun `share zip address`() {
        val zip = api.media.shareZip("sh_1", "/Day 1", 2)
        assertEquals("/shares/sh_1/zip", zip.encodedPath)
        assertEquals("/Day 1", zip.queryParameter("path"))
        assertEquals("2", zip.queryParameter("part"))
        assertEquals("tok-123", zip.queryParameter("token"))
    }

    @Test
    fun `own files keep their usual addresses`() {
        val own = FileItem(id = "1", name = "a.mp4", type = "video")
        assertEquals("/dl/a.mp4", api.media.file(own).encodedPath)
    }

    @Test
    fun `shared videos skip the owner's media info`() = runTest {
        val file = ShareItem(id = "v1", name = "clip.mp4", type = "video").toFileItem("sh_1")
        assertThrows<ApiException> { api.mediaInfo(file) }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `share notifications point at the share`() {
        val note = TeleStoreApi.json.decodeFromString<ServerNotification>(
            """{"id":"n1","kind":"share","title":"Bob shared a folder with you","target":{"type":"shared","share_id":"sh_1"}}""",
        )
        assertEquals("shared", note.target!!.type)
        assertEquals("sh_1", note.target!!.shareId)
        assertEquals(NotificationKind.SHARE, NotificationKind.of(note.kind))
    }
}
