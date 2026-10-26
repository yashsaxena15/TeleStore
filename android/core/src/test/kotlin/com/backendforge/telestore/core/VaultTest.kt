package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class VaultTest {
    @Test
    fun `the session cookie from unlocking is sent afterwards`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().addHeader("Set-Cookie", "session=abc123; Path=/; HttpOnly").setBody("""{"success":true,"message":"Vault successfully unlocked."}"""))
        server.enqueue(MockResponse().setBody("""{"is_setup":true,"is_unlocked":true,"email":"ya***28@gmail.com","remaining_seconds":890,"auto_lock_minutes":15}"""))
        api.vaultUnlock("1234")
        val unlockBody = server.takeRequest().body.readUtf8()
        assertTrue("\"pin\":\"1234\"" in unlockBody)
        val status = api.vaultStatus()
        assertTrue(status.isUnlocked)
        assertEquals("session=abc123", server.takeRequest().getHeader("Cookie"))
        server.shutdown()
    }

    @Test
    fun `move in and out name the folder`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        repeat(2) { server.enqueue(MockResponse().setBody("""{"success":true,"message":"ok"}""")) }
        api.moveIntoVault(FileItem(id = "f1", name = "a.jpg"))
        assertTrue("\"target_path\":\"/Vault\"" in server.takeRequest().body.readUtf8())
        api.moveOutOfVault(FileItem(id = "f1", name = "a.jpg"), "/Home/Back")
        val out = server.takeRequest()
        assertEquals("/vault/move-out", out.path)
        assertTrue("\"target_path\":\"/Home/Back\"" in out.body.readUtf8())
        server.shutdown()
    }

    @Test
    fun `pins are four digits`() {
        assertTrue(VaultPin.isValid("0420"))
        assertFalse(VaultPin.isValid("123"))
        assertFalse(VaultPin.isValid("12a4"))
    }
}
