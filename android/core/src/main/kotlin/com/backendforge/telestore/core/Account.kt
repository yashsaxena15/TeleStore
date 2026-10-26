package com.backendforge.telestore.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

@Serializable
data class CategoryStat(val count: Int = 0, val bytes: Long = 0)

/** GET /files/analytics: what the account stores. */
@Serializable
data class StorageStats(
    @SerialName("total_bytes") val usedBytes: Long = 0,
    @SerialName("total_files") val files: Int = 0,
    @SerialName("total_folders") val folders: Int = 0,
    @SerialName("trash_bytes") val trashBytes: Long = 0,
    @SerialName("trash_count") val trashCount: Int = 0,
    @SerialName("quota_bytes") val quotaBytes: Long = 0,
    @SerialName("free_bytes") val freeBytes: Long = 0,
    @SerialName("by_category") val categories: Map<String, CategoryStat> = emptyMap(),
) {
    val usedFraction: Float get() = if (quotaBytes > 0) (usedBytes.toFloat() / quotaBytes).coerceIn(0f, 1f) else 0f
}

/** The newest app build on GitHub Releases. */
data class AppRelease(val build: Int, val version: String, val apkUrl: String, val pageUrl: String)

/**
 * Looks for a newer APK on the repo's rolling "android-latest" release. CI writes "Build N" (the
 * app's versionCode) into the release notes; a higher N than the installed one is an update.
 */
class UpdateChecker(
    private val http: OkHttpClient,
    private val releaseUrl: String = "https://api.github.com/repos/yashsaxena15/TeleStore/releases/tags/android-latest",
) {
    suspend fun latest(): AppRelease? = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(releaseUrl).header("Accept", "application/vnd.github+json").build()
        val text = try {
            http.newCall(request).execute().use { if (it.isSuccessful) it.body?.string() else null }
        } catch (e: IOException) {
            throw NetworkException("Couldn't reach GitHub to look for updates.", e)
        } ?: return@withContext null
        parse(text)
    }

    /** The newer release, or null when [installedBuild] is already the newest. */
    suspend fun newerThan(installedBuild: Long): AppRelease? = latest()?.takeIf { it.build > installedBuild }

    companion object {
        private val BUILD = Regex("""Build (\d+)""")
        private val VERSION = Regex("""TeleStore-([\w.\-]+)\.apk""")

        fun parse(json: String): AppRelease? {
            val root = runCatching { TeleStoreApi.json.parseToJsonElement(json).jsonObject }.getOrNull() ?: return null
            val body = root["body"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val build = BUILD.find(body)?.groupValues?.get(1)?.toIntOrNull() ?: return null
            val apk = root["assets"]?.jsonArray?.map { it.jsonObject }
                ?.firstOrNull { (it["name"]?.jsonPrimitive?.contentOrNull ?: "").endsWith(".apk") } ?: return null
            val name = apk.str("name")
            val url = apk.str("browser_download_url").ifEmpty { return null }
            return AppRelease(
                build = build,
                version = VERSION.find(name)?.groupValues?.get(1) ?: "build $build",
                apkUrl = url,
                pageUrl = root.str("html_url"),
            )
        }

        private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull.orEmpty()
    }
}
