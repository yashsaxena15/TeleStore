package com.backendforge.telestore.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonNull
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ProtectionTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TeleStoreApi

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = TeleStoreApi(server.url("/"), { "tok" }, {})
    }

    @AfterEach
    fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private fun body(raw: String) = Json.parseToJsonElement(raw).jsonObject
    private val taxes = FileItem(id = "f1", name = "Taxes", type = "folder", protected = true)

    @Test
    fun `file items carry protection and colour`() {
        val item = TeleStoreApi.json.decodeFromString<FileItem>("""{"id":"1","file_name":"Taxes","file_type":"folder","protected":true,"color":"teal"}""")
        assertTrue(item.protected)
        assertTrue(item.isProtected)
        assertNull(item.protectedBy)
        assertEquals("teal", item.color)
        val plain = TeleStoreApi.json.decodeFromString<FileItem>("""{"id":"2","file_name":"a.txt"}""")
        assertFalse(plain.protected)
        assertFalse(plain.isProtected)
        assertNull(plain.protectedBy)
        assertNull(plain.color)
    }

    @Test
    fun `protected_by makes an item protected without its own flag`() {
        val inside = TeleStoreApi.json.decodeFromString<FileItem>("""{"id":"3","file_name":"2024.pdf","protected":false,"protected_by":"Taxes"}""")
        assertFalse(inside.protected)
        assertEquals("Taxes", inside.protectedBy)
        assertTrue(inside.isProtected)
        val nullBy = TeleStoreApi.json.decodeFromString<FileItem>("""{"id":"4","file_name":"b.txt","protected_by":null}""")
        assertFalse(nullBy.isProtected)
    }

    @Test
    fun `423 becomes ProtectedException with the server's words`() = runTest {
        server.enqueue(json("""{"detail":"“Taxes” is protected. Remove protection first."}""", 423))
        val e = assertThrows<ProtectedException> { api.trash(taxes) }
        assertEquals(423, e.status)
        assertEquals("“Taxes” is protected. Remove protection first.", e.message)
        val sent = body(server.takeRequest().body.readUtf8())
        assertEquals("f1", sent["file_id"]!!.jsonPrimitive.content)
        assertFalse(sent.containsKey("unlock_token"))
    }

    @Test
    fun `trash, delete and empty trash never send an unlock token`() = runTest {
        server.enqueue(json("""{"message":"ok"}"""))
        server.enqueue(json("""{"detail":"“2024.pdf” is inside the protected folder “Taxes”. Remove protection first."}""", 423))
        server.enqueue(json("""{"message":"ok"}"""))
        api.trash(taxes)
        val e = assertThrows<ProtectedException> { api.deleteForever(taxes) }
        assertEquals("“2024.pdf” is inside the protected folder “Taxes”. Remove protection first.", e.message)
        api.emptyTrash()
        server.takeRequest().let { assertEquals("/files/trash", it.path); assertEquals(setOf("file_id"), body(it.body.readUtf8()).keys) }
        server.takeRequest().let { assertEquals("/files/delete", it.path); assertEquals(setOf("file_id"), body(it.body.readUtf8()).keys) }
        server.takeRequest().let { assertEquals("/files/trash/empty", it.path); assertEquals("{}", it.body.readUtf8()) }
    }

    @Test
    fun `empty trash reports the protected items it kept`() = runTest {
        server.enqueue(json("""{"message":"Trash emptied. 2 protected items kept.","kept":2}"""))
        server.enqueue(json("""{"message":"Trash emptied"}"""))
        val reply = api.emptyTrash()
        assertEquals(2, reply.kept)
        assertEquals("Trash emptied. 2 protected items kept.", reply.message)
        assertEquals(0, api.emptyTrash().kept)
        assertEquals("Trash emptied, 2 protected items kept", ProtectedDelete.emptyTrashMessage(2))
        assertEquals("Trash emptied, 1 protected item kept", ProtectedDelete.emptyTrashMessage(1))
        assertEquals("Trash emptied", ProtectedDelete.emptyTrashMessage(0))
        assertEquals("2 protected — remove protection first", ProtectedDelete.selectionBlockedMessage(2))
    }

    @Test
    fun `protection method, code and unlock for one file`() = runTest {
        server.enqueue(json("""{"method":"email","email_hint":"y•••@gmail.com"}"""))
        server.enqueue(json("""{"message":"Code sent."}"""))
        server.enqueue(json("""{"unlock_token":"tok-9","expires_in":120}"""))
        val m = api.protectionMethod()
        assertTrue(m.usesEmail)
        assertEquals("y•••@gmail.com", m.emailHint)
        assertEquals("Code sent.", api.sendProtectionCode().message)
        val unlock = api.unlockProtection(taxes, code = " 123456 ")
        assertEquals("tok-9", unlock.unlockToken)
        assertEquals(120, unlock.expiresIn)
        assertEquals("/files/protection", server.takeRequest().path)
        server.takeRequest().let { assertEquals("/files/protection/code", it.path); assertEquals("POST", it.method); assertEquals("{}", it.body.readUtf8()) }
        server.takeRequest().let {
            assertEquals("/files/protection/unlock", it.path)
            val b = body(it.body.readUtf8())
            assertEquals("123456", b["code"]!!.jsonPrimitive.content)
            assertEquals("f1", b["file_id"]!!.jsonPrimitive.content)
            assertFalse(b.containsKey("password"))
        }
    }

    @Test
    fun `unlock with a password sends it and the file id`() = runTest {
        server.enqueue(json("""{"unlock_token":"tok-1"}"""))
        val reply = api.unlockProtection(taxes, password = "secret")
        assertEquals(120, reply.expiresIn)
        val b = body(server.takeRequest().body.readUtf8())
        assertEquals("secret", b["password"]!!.jsonPrimitive.content)
        assertEquals("f1", b["file_id"]!!.jsonPrimitive.content)
        assertFalse(b.containsKey("code"))
    }

    @Test
    fun `wrong password is a plain ApiException`() = runTest {
        server.enqueue(json("""{"detail":"Wrong password."}""", 400))
        val e = assertThrows<ApiException> { api.unlockProtection(taxes, password = "nope") }
        assertEquals(400, e.status)
        assertEquals("Wrong password.", e.message)
    }

    @Test
    fun `protect and unprotect`() = runTest {
        server.enqueue(json("""{"protected":true}"""))
        server.enqueue(json("""{"detail":"Confirm with your password to remove protection."}""", 423))
        server.enqueue(json("""{"protected":false}"""))
        assertTrue(api.setProtected(taxes, true))
        assertThrows<ProtectedException> { api.setProtected(taxes, false) }
        assertFalse(api.setProtected(taxes, false, unlockToken = "u2"))
        body(server.takeRequest().body.readUtf8()).let {
            assertEquals("true", it["protected"]!!.jsonPrimitive.content)
            assertEquals("f1", it["file_id"]!!.jsonPrimitive.content)
            assertFalse(it.containsKey("unlock_token"))
        }
        server.takeRequest()
        body(server.takeRequest().body.readUtf8()).let {
            assertEquals("false", it["protected"]!!.jsonPrimitive.content)
            assertEquals("f1", it["file_id"]!!.jsonPrimitive.content)
            assertEquals("u2", it["unlock_token"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun `sets and clears a folder colour`() = runTest {
        server.enqueue(json("""{"color":"blue"}"""))
        server.enqueue(json("""{"color":null}"""))
        server.enqueue(json("""{"detail":"Only folders have colours."}""", 400))
        assertEquals("blue", api.setFolderColor(taxes, "blue"))
        assertNull(api.setFolderColor(taxes, null))
        assertThrows<ApiException> { api.setFolderColor(taxes.copy(type = "file"), "red") }
        server.takeRequest().let { assertEquals("/files/color", it.path); assertEquals("blue", body(it.body.readUtf8())["color"]!!.jsonPrimitive.content) }
        assertEquals(JsonNull, body(server.takeRequest().body.readUtf8())["color"])
    }

    @Test
    fun `palette matches the website`() {
        assertEquals(listOf("red", "orange", "yellow", "green", "teal", "blue", "purple", "grey"), FolderColors.names)
        val hex = FolderColors.palette.mapValues { "#%06x".format(it.value and 0xFFFFFF) }
        assertEquals(
            mapOf("red" to "#ef4444", "orange" to "#f97316", "yellow" to "#eab308", "green" to "#22c55e",
                "teal" to "#14b8a6", "blue" to "#3b82f6", "purple" to "#a855f7", "grey" to "#6b7280"),
            hex,
        )
        FolderColors.palette.values.forEach { assertEquals(0xFF000000, it and 0xFF000000) }
        assertEquals(0xFF6B7280, FolderColors.argb("Gray"))
        assertNull(FolderColors.argb(null))
        assertNull(FolderColors.argb("pink"))
        assertEquals("Teal", FolderColors.label("teal"))
    }

    @Test
    fun `bulk delete keeps protected items without asking or retrying`() = runTest {
        val calls = mutableListOf<String>()
        val outcome = ProtectedDelete.run(listOf("a", "b", "c", "d")) { id ->
            calls += id
            if (id == "b" || id == "d") throw ProtectedException("“$id” is protected. Remove protection first.")
        }
        assertEquals(listOf("a", "b", "c", "d"), calls)
        assertEquals(listOf("a", "c"), outcome.done)
        assertEquals(listOf("b", "d"), outcome.kept)
        assertEquals("“b” is protected. Remove protection first.", outcome.protectedMessage)
        assertEquals("Moved to Trash 2 items, 2 protected items not deleted", ProtectedDelete.message(outcome, "Moved to Trash"))
    }

    @Test
    fun `one protected item shows the server's message, other errors are reported`() = runTest {
        val single = ProtectedDelete.run(listOf("x")) { throw ProtectedException("“x” is protected. Remove protection first.") }
        assertEquals("“x” is protected. Remove protection first.", ProtectedDelete.message(single, "Moved to Trash"))

        val mixed = ProtectedDelete.run(listOf("a", "b", "c")) { id ->
            when (id) {
                "b" -> throw ProtectedException("no")
                "c" -> throw ApiException(500, "boom")
            }
        }
        assertEquals(listOf("a"), mixed.done)
        assertEquals(listOf("b"), mixed.kept)
        assertEquals("boom", mixed.firstError?.message)
        assertEquals("Permanently deleted 1 item, 1 protected item not deleted, 1 failed: boom", ProtectedDelete.message(mixed, "Permanently deleted"))
    }

    @Test
    fun `nothing protected deletes everything`() = runTest {
        val outcome = ProtectedDelete.run(listOf(1, 2)) { }
        assertEquals(listOf(1, 2), outcome.done)
        assertTrue(outcome.kept.isEmpty())
        assertEquals("Moved to Trash 2 items", ProtectedDelete.message(outcome, "Moved to Trash"))
    }
}
