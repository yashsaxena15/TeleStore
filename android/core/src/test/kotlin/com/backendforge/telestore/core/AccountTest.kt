package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AccountTest {
    private val release = """{"html_url":"https://github.com/x/releases/tag/android-latest",
        "body":"Built from abc1234 (Build 31). Install the APK on your phone.",
        "assets":[{"name":"notes.txt","browser_download_url":"https://x/notes.txt"},
                  {"name":"TeleStore-1.0.31.apk","browser_download_url":"https://x/TeleStore-1.0.31.apk"}]}"""

    @Test
    fun `reads the build, version and apk from the release`() {
        val r = UpdateChecker.parse(release)!!
        assertEquals(31, r.build)
        assertEquals("1.0.31", r.version)
        assertEquals("https://x/TeleStore-1.0.31.apk", r.apkUrl)
    }

    @Test
    fun `a release without a build number or apk is ignored`() {
        assertNull(UpdateChecker.parse("""{"body":"no number","assets":[{"name":"a.apk","browser_download_url":"u"}]}"""))
        assertNull(UpdateChecker.parse("""{"body":"Build 3","assets":[]}"""))
        assertNull(UpdateChecker.parse("not json"))
    }

    @Test
    fun `only a higher build is an update`() = runBlocking {
        val server = MockWebServer().apply { start() }
        repeat(2) { server.enqueue(MockResponse().setBody(release)) }
        val checker = UpdateChecker(OkHttpClient(), server.url("/rel").toString())
        assertEquals(31, checker.newerThan(30)!!.build)
        assertNull(checker.newerThan(31))
        server.shutdown()
    }

    @Test
    fun `storage stats are read`() = runBlocking {
        val server = MockWebServer().apply { start() }
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(
            """{"total_bytes":2500,"total_files":12,"total_folders":3,"trash_bytes":100,"trash_count":2,"starred_count":1,
               "by_category":{"video":{"count":4,"bytes":2000},"audio":{"count":8,"bytes":500}},"largest_files":[],
               "quota_bytes":10000,"free_bytes":7500}"""))
        val stats = TeleStoreApi(server.url("/"), { "t" }).storage()
        assertEquals(0.25f, stats.usedFraction)
        assertEquals(4, stats.categories["video"]!!.count)
        assertEquals("/files/analytics", server.takeRequest().path)
        server.shutdown()
    }
}
