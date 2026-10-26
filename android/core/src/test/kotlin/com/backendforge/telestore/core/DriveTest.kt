package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DriveTest {
    @Test
    fun `the sign-in token never goes to other servers`() {
        val ours = MockWebServer().apply { start() }
        val google = MockWebServer().apply { start() }
        ours.enqueue(MockResponse().setBody("ok"))
        google.enqueue(MockResponse().setBody("img"))
        val api = TeleStoreApi(ours.url("/"), { "secret-token" })
        api.http.newCall(Request.Builder().url(ours.url("/files")).build()).execute().close()
        // Same machine, different port: still another server
        api.http.newCall(Request.Builder().url(google.url("/thumb.jpg")).build()).execute().close()
        assertEquals("secret-token", ours.takeRequest().getHeader("X-Auth-Token"))
        assertNull(google.takeRequest().getHeader("X-Auth-Token"))
        ours.shutdown(); google.shutdown()
    }

    @Test
    fun `drive listing and copies use the server's paths`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().setBody("""{"items":[{"id":"my_drive","name":"My Drive","type":"folder","is_folder":true,"is_virtual":true},
            {"id":"f1","name":"clip.mp4","mimeType":"video/mp4","size":123,"is_folder":false,"thumbnailLink":"https://lh3/x"}],"nextPageToken":"n2"}"""))
        val list = api.driveFiles("acc1", "root", query = " clip ")
        assertTrue(list.items[0].isPlace)
        assertEquals(FileKind.VIDEO, list.items[1].kind)
        assertEquals("n2", list.nextPageToken)
        val req = server.takeRequest().requestUrl!!
        assertEquals("/cloud/acc1/files", req.encodedPath)
        assertEquals("clip", req.queryParameter("query"))

        server.enqueue(MockResponse().setBody("""{"message":"Queued"}"""))
        api.telestoreToDrive("acc1", listOf(FileItem(id = "a", name = "a.jpg"), FileItem(id = "b", name = "Pics", type = "folder", path = "/Home")), "folder9")
        val body = TeleStoreApi.json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(listOf("a"), body["source_file_ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(listOf("/Home/Pics"), body["source_folder_paths"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("folder9", body["target_folder_id"]!!.jsonPrimitive.content)
        assertEquals("/cloud/acc1/download/f1", api.driveDownloadPath("acc1", "f1"))
        server.shutdown()
    }
}
