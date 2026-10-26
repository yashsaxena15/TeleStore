package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class TeleStoreApiTest {
    private lateinit var server: MockWebServer
    private var token: String? = "tok-123"
    private var signedOut = 0
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { token }, { signedOut++ })
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun `login sends the device and returns the token`() = runTest {
        token = null
        server.enqueue(json("""{"message":"Login successful","username":"bob","auth_token":"new-token"}"""))
        val res = api.login(" bob ", "secret")
        assertEquals("new-token", res.authToken)
        assertEquals("bob", res.account)
        val req = server.takeRequest()
        assertEquals("/auth/login", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("bob", body["username"]!!.jsonPrimitive.content)
        assertEquals("android", body["device"]!!.jsonPrimitive.content)
        assertNull(req.getHeader("X-Auth-Token"))
    }

    @Test
    fun `google sign-in returns the account name`() = runTest {
        server.enqueue(json("""{"message":"Login successful","user":{"email":"a@b.c","username":"google_a@b.c"},"auth_token":"g-token"}"""))
        val res = api.googleLogin("id-token")
        assertEquals("google_a@b.c", res.account)
        val body = TeleStoreApi.json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("id-token", body["token"]!!.jsonPrimitive.content)
        assertEquals("android", body["device"]!!.jsonPrimitive.content)
    }

    @Test
    fun `wrong password shows the server's message`() = runTest {
        server.enqueue(json("""{"detail":"Incorrect username or password"}""", 401))
        val e = assertThrows<UnauthorizedException> { api.login("bob", "nope") }
        assertEquals("Incorrect username or password", e.message)
    }

    @Test
    fun `every request carries the token`() = runTest {
        server.enqueue(json("""{"authenticated":true,"username":"bob"}"""))
        assertTrue(api.check().authenticated)
        assertEquals("tok-123", server.takeRequest().getHeader("X-Auth-Token"))
    }

    @Test
    fun `a 401 signs the app out`() = runTest {
        server.enqueue(json("""{"detail":"Authentication required"}""", 401))
        assertThrows<UnauthorizedException> { api.listFiles() }
        assertEquals(1, signedOut)
    }

    @Test
    fun `other errors keep their status and message`() = runTest {
        server.enqueue(json("""{"detail":[{"msg":"page must be at least 1"},{"msg":"bad sort"}]}""", 422))
        val e = assertThrows<ApiException> { api.listFiles() }
        assertEquals(422, e.status)
        assertEquals("page must be at least 1; bad sort", e.message)
        assertEquals(0, signedOut)
    }

    @Test
    fun `list files sends paging, sort and search`() = runTest {
        server.enqueue(json("""{"files":[{"id":"1","file_name":"Movies","file_type":"folder","file_path":"/Home"},
            {"id":"2","file_name":"Dune.mkv","file_type":"video","file_size":62400000000,"file_path":"/Home","thumbnail":"AAA","unknown_field":1}],
            "pagination":{"page":2,"page_size":20,"total_items":42,"total_pages":3,"has_next":true,"has_prev":true}}"""))
        val page = api.listFiles(path = "/Home", page = 2, pageSize = 20, sortBy = SortBy.DATE, ascending = false, query = " dune ")
        assertEquals(2, page.files.size)
        assertTrue(page.files[0].isFolder)
        assertEquals(FileKind.VIDEO, page.files[1].kind)
        assertEquals(62_400_000_000L, page.files[1].size)
        assertTrue(page.pagination!!.hasNext)
        val url = server.takeRequest().requestUrl!!
        assertEquals("/Home", url.queryParameter("path"))
        assertEquals("2", url.queryParameter("page"))
        assertEquals("20", url.queryParameter("page_size"))
        assertEquals("date", url.queryParameter("sort_by"))
        assertEquals("desc", url.queryParameter("sort_order"))
        assertEquals("dune", url.queryParameter("q"))
    }

    @Test
    fun `no search text means no q`() = runTest {
        server.enqueue(json("""{"files":[]}"""))
        api.listFiles(query = "   ")
        assertNull(server.takeRequest().requestUrl!!.queryParameter("q"))
    }

    @Test
    fun `google config may be missing`() = runTest {
        server.enqueue(json("""{"client_id":null}"""))
        assertNull(api.googleConfig().clientId)
    }

    @Test
    fun `sign out never throws`() = runTest {
        server.enqueue(json("""{"detail":"boom"}""", 500))
        api.logout()
        assertEquals("/auth/logout", server.takeRequest().path)
    }

    @Test
    fun `an unreachable server is a network error`() = runTest {
        val dead = TeleStoreApi(server.url("/"), { null })
        server.shutdown()
        assertThrows<NetworkException> { dead.check() }
    }

    @Test
    fun `create folder sends parentPath and trimmed name`() = runTest {
        server.enqueue(json("""{"message":"Folder 'Action' created successfully"}"""))
        val reply = api.createFolder(" Action ", "/Home/Movies")
        assertEquals("Folder 'Action' created successfully", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/folders/create", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("Action", body["folderName"]!!.jsonPrimitive.content)
        assertEquals("/Home/Movies", body["currentPath"]!!.jsonPrimitive.content)
    }

    @Test
    fun `rename sends file id and new name`() = runTest {
        server.enqueue(json("""{"message":"Renamed successfully"}"""))
        val item = FileItem(id = "f-123", name = "Old.mkv")
        val reply = api.rename(item, "New.mkv")
        assertEquals("Renamed successfully", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/rename", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("f-123", body["file_id"]!!.jsonPrimitive.content)
        assertEquals("New.mkv", body["new_name"]!!.jsonPrimitive.content)
    }

    @Test
    fun `move sends file id and target path`() = runTest {
        server.enqueue(json("""{"message":"Moved successfully"}"""))
        val item = FileItem(id = "f-123", name = "Movie.mkv")
        val reply = api.move(item, "/Home/Archive")
        assertEquals("Moved successfully", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/move", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("f-123", body["file_id"]!!.jsonPrimitive.content)
        assertEquals("/Home/Archive", body["target_path"]!!.jsonPrimitive.content)
    }

    @Test
    fun `copy sends file id and target path`() = runTest {
        server.enqueue(json("""{"message":"Copied successfully"}"""))
        val item = FileItem(id = "f-123", name = "Movie.mkv")
        val reply = api.copy(item, "/Home/Archive")
        assertEquals("Copied successfully", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/copy", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("f-123", body["file_id"]!!.jsonPrimitive.content)
        assertEquals("/Home/Archive", body["target_path"]!!.jsonPrimitive.content)
    }

    @Test
    fun `setStarred sends file id and returns boolean`() = runTest {
        server.enqueue(json("""{"starred":true}"""))
        val item = FileItem(id = "f-123", name = "Movie.mkv")
        val result = api.setStarred(item, true)
        assertTrue(result)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/star", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("f-123", body["file_id"]!!.jsonPrimitive.content)
        assertEquals("true", body["starred"]!!.jsonPrimitive.content)
    }

    @Test
    fun `trash sends file id`() = runTest {
        server.enqueue(json("""{"message":"Moved to trash"}"""))
        val item = FileItem(id = "f-123", name = "Movie.mkv")
        val reply = api.trash(item)
        assertEquals("Moved to trash", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/trash", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("f-123", body["file_id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `restore sends file id`() = runTest {
        server.enqueue(json("""{"message":"Restored from trash"}"""))
        val item = FileItem(id = "f-123", name = "Movie.mkv", trashed = true)
        val reply = api.restore(item)
        assertEquals("Restored from trash", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/restore", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("f-123", body["file_id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `deleteForever sends file id`() = runTest {
        server.enqueue(json("""{"message":"Permanently deleted"}"""))
        val item = FileItem(id = "f-123", name = "Movie.mkv", trashed = true)
        val reply = api.deleteForever(item)
        assertEquals("Permanently deleted", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/delete", req.path)
        val body = TeleStoreApi.json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("f-123", body["file_id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `emptyTrash sends empty json body`() = runTest {
        server.enqueue(json("""{"message":"Trash emptied"}"""))
        val reply = api.emptyTrash()
        assertEquals("Trash emptied", reply.message)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/files/trash/empty", req.path)
        assertEquals("{}", req.body.readUtf8())
    }

    @Test
    fun `actions map detail 400 to ApiException`() = runTest {
        server.enqueue(json("""{"detail":"Cannot move folder into itself"}""", 400))
        val item = FileItem(id = "f-1", name = "Movies", type = "folder")
        val e = assertThrows<ApiException> { api.move(item, "/Home/Movies") }
        assertEquals(400, e.status)
        assertEquals("Cannot move folder into itself", e.message)
    }
}
