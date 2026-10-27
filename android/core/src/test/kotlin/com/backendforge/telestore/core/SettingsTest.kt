package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SettingsTest {
    @Test
    fun `changing a password puts both passwords to the user's address`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().setBody("""{"message":"Password updated successfully"}"""))
        api.changePassword("yash", "old-one", "new-one")
        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertEquals("/user/yash/password", request.path)
        val body = request.body.readUtf8()
        assertTrue("\"current_password\":\"old-one\"" in body && "\"new_password\":\"new-one\"" in body)
        server.shutdown()
    }

    @Test
    fun `user updates send only what changed`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().setBody("""{"id":"u1","username":"sam","active":false,"can_upload":true,"created_at":"2026-10-01"}"""))
        val user = api.updateUser("u1", active = false)
        assertFalse(user.active)
        assertEquals("""{"active":false}""", server.takeRequest().body.readUtf8())
        server.enqueue(MockResponse().setResponseCode(200))
        api.removeUser("u1")
        val removed = server.takeRequest()
        assertEquals("DELETE", removed.method)
        assertEquals("/user/u1", removed.path)
        server.shutdown()
    }

    @Test
    fun `a user's setup says what they still need`() {
        assertEquals("Needs Telegram", ManagedUser("1").setup)
        assertEquals("Needs index chat", ManagedUser("1", hasTelegram = true).setup)
        val ready = ManagedUser("1", hasTelegram = true, hasIndexChat = true)
        assertTrue(ready.ready)
        assertTrue(ManagedUser("1", username = "admin").locked)
        assertTrue(ManagedUser("2", isOwner = true).locked)
        assertFalse(ManagedUser("3", username = "sam").locked)
    }

    @Test
    fun `cookies are uploaded as a file and the settings come back`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().setBody("""{"version":"2026.10.01","has_cookies":true,"cookie_sites":["youtube.com"],"youtube_sign_in":"signed_in","pot_helper":true}"""))
        val settings = api.uploadCookies("cookies.txt", "# Netscape HTTP Cookie File".toByteArray())
        val request = server.takeRequest()
        assertEquals("/transfers/remote/media/cookies", request.path)
        assertTrue(request.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        assertTrue("filename=\"cookies.txt\"" in request.body.readUtf8())
        assertTrue(settings.hasYouTube)
        assertTrue("confirmed the sign-in" in settings.cookiesStatus)
        server.shutdown()
    }

    @Test
    fun `synced playlists describe themselves`() {
        val json = """{"syncs":[{"id":"s1","title":"Lo-fi","is_channel":false,"choice":{"mode":"audio","audio_format":"m4a"},"destination_label":"/Home/Music","enabled":true}],"every_hours":6.0}"""
        val sync = TeleStoreApi.json.decodeFromString<MediaSyncs>(json).syncs.single()
        assertEquals("Playlist · M4A · to /Home/Music", sync.summary)
        val video = TeleStoreApi.json.decodeFromString<MediaSync>("""{"id":"s2","is_channel":true,"choice":{"mode":"video","quality":"1080"}}""")
        assertEquals("Channel · 1080p video", video.summary)
    }

    @Test
    fun `instagram sign-in can ask for the code`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().setBody("""{"needs_2fa":true}"""))
        server.enqueue(MockResponse().setBody("""{"connected":true,"username":"spare"}"""))
        assertTrue(api.instagramLogin("spare", "pw").needsCode)
        server.takeRequest()
        val done = api.instagramCode(" 123456 ")
        assertEquals("spare", done.username)
        assertEquals("""{"code":"123456"}""", server.takeRequest().body.readUtf8())
        server.shutdown()
    }

    @Test
    fun `forgot password sends the username then the code`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { null })
        repeat(2) { server.enqueue(MockResponse().setBody("""{"message":"ok"}""")) }
        api.forgotPassword(" yash ")
        assertEquals("""{"username":"yash"}""", server.takeRequest().body.readUtf8())
        api.resetPassword("yash", "123456", "secret1")
        val reset = server.takeRequest()
        assertEquals("/auth/forgot-password/reset", reset.path)
        assertTrue("\"code\":\"123456\"" in reset.body.readUtf8())
        server.shutdown()
    }
}
