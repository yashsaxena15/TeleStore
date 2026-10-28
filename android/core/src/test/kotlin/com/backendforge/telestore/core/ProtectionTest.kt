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
        assertEquals("teal", item.color)
        val plain = TeleStoreApi.json.decodeFromString<FileItem>("""{"id":"2","file_name":"a.txt"}""")
        assertFalse(plain.protected)
        assertNull(plain.color)
    }

    @Test
    fun `423 becomes ProtectedException with the server's words`() = runTest {
        server.enqueue(json("""{"detail":"“Taxes” is protected. Confirm with your password to delete it."}""", 423))
        val e = assertThrows<ProtectedException> { api.trash(taxes) }
        assertEquals(423, e.status)
        assertEquals("“Taxes” is protected. Confirm with your password to delete it.", e.message)
        val sent = body(server.takeRequest().body.readUtf8())
        assertEquals("f1", sent["file_id"]!!.jsonPrimitive.content)
        assertFalse(sent.containsKey("unlock_token"))
    }

    @Test
    fun `unlock token goes with trash, delete and empty trash`() = runTest {
        repeat(3) { server.enqueue(json("""{"message":"ok"}""")) }
        api.trash(taxes, unlockToken = "u1")
        api.deleteForever(taxes, unlockToken = "u1")
        api.emptyTrash(unlockToken = "u1")
        server.takeRequest().let { assertEquals("/files/trash", it.path); assertEquals("u1", body(it.body.readUtf8())["unlock_token"]!!.jsonPrimitive.content) }
        server.takeRequest().let { assertEquals("/files/delete", it.path); assertEquals("u1", body(it.body.readUtf8())["unlock_token"]!!.jsonPrimitive.content) }
        server.takeRequest().let { assertEquals("/files/trash/empty", it.path); assertEquals("u1", body(it.body.readUtf8())["unlock_token"]!!.jsonPrimitive.content) }
    }

    @Test
    fun `empty trash without a token sends an empty body`() = runTest {
        server.enqueue(json("""{"message":"ok"}"""))
        api.emptyTrash()
        assertEquals("{}", server.takeRequest().body.readUtf8())
    }

    @Test
    fun `protection method, code and unlock`() = runTest {
        server.enqueue(json("""{"method":"email","email_hint":"y•••@gmail.com"}"""))
        server.enqueue(json("""{"message":"Code sent."}"""))
        server.enqueue(json("""{"unlock_token":"tok-9","expires_in":300}"""))
        val m = api.protectionMethod()
        assertTrue(m.usesEmail)
        assertEquals("y•••@gmail.com", m.emailHint)
        assertEquals("Code sent.", api.sendProtectionCode().message)
        val unlock = api.unlockProtection(code = " 123456 ")
        assertEquals("tok-9", unlock.unlockToken)
        assertEquals(300, unlock.expiresIn)
        assertEquals("/files/protection", server.takeRequest().path)
        server.takeRequest().let { assertEquals("/files/protection/code", it.path); assertEquals("POST", it.method); assertEquals("{}", it.body.readUtf8()) }
        server.takeRequest().let {
            assertEquals("/files/protection/unlock", it.path)
            val b = body(it.body.readUtf8())
            assertEquals("123456", b["code"]!!.jsonPrimitive.content)
            assertFalse(b.containsKey("password"))
        }
    }

    @Test
    fun `wrong password is a plain ApiException`() = runTest {
        server.enqueue(json("""{"detail":"Wrong password."}""", 400))
        val e = assertThrows<ApiException> { api.unlockProtection(password = "nope") }
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
        body(server.takeRequest().body.readUtf8()).let { assertEquals("true", it["protected"]!!.jsonPrimitive.content); assertFalse(it.containsKey("unlock_token")) }
        server.takeRequest()
        body(server.takeRequest().body.readUtf8()).let { assertEquals("false", it["protected"]!!.jsonPrimitive.content); assertEquals("u2", it["unlock_token"]!!.jsonPrimitive.content) }
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
    fun `bulk delete asks once and retries every refused item`() = runTest {
        val protectedIds = setOf("b", "d")
        val calls = mutableListOf<Pair<String, String?>>()
        var asked = 0
        val outcome = ProtectedDelete.run(
            listOf("a", "b", "c", "d"),
            unlock = { msg -> asked++; assertEquals("b is protected", msg); "tok" },
        ) { id, token ->
            calls += id to token
            if (id in protectedIds && token == null) throw ProtectedException("$id is protected")
        }
        assertEquals(1, asked)
        assertEquals(listOf("a", "c", "b", "d"), outcome.done)
        assertTrue(outcome.kept.isEmpty())
        assertEquals(listOf("a" to null, "b" to null, "c" to null, "d" to null, "b" to "tok", "d" to "tok"), calls)
    }

    @Test
    fun `cancelled confirmation keeps protected items, other errors are reported`() = runTest {
        val outcome = ProtectedDelete.run(listOf("a", "b", "c"), unlock = { null }) { id, _ ->
            when (id) {
                "b" -> throw ProtectedException("no")
                "c" -> throw ApiException(500, "boom")
            }
        }
        assertEquals(listOf("a"), outcome.done)
        assertEquals(listOf("b"), outcome.kept)
        assertEquals("boom", outcome.firstError?.message)
    }

    @Test
    fun `nothing protected never asks`() = runTest {
        val outcome = ProtectedDelete.run(listOf(1, 2), unlock = { error("should not ask") }) { _, _ -> }
        assertEquals(listOf(1, 2), outcome.done)
    }
}
