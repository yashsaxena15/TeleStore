package com.backendforge.telestore.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The TeleStore server's API for the Android app.
 *
 * Every request carries the signed-in token as X-Auth-Token. A 401 calls [onUnauthorized]
 * (the app signs out) and throws [UnauthorizedException].
 */
class TeleStoreApi(
    val baseUrl: HttpUrl,
    private val token: () -> String?,
    private val onUnauthorized: () -> Unit = {},
    client: OkHttpClient = defaultClient(),
    /** Where network work runs: sending AND reading replies (Android kills apps that read on the main thread). */
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    /** Shared with image loading and the player so they use the same connections and token. */
    val http: OkHttpClient = client.newBuilder()
        .addInterceptor { chain ->
            val request = chain.request()
            val t = token()
            chain.proceed(if (t != null && request.header(TOKEN_HEADER) == null) request.newBuilder().header(TOKEN_HEADER, t).build() else request)
        }
        .build()

    val media = MediaUrls(baseUrl, token)

    // ── Sign-in ─────────────────────────────────────────────────────────────────
    /** The Google client ID for "Continue with Google", or null when the server hasn't set it up. */
    suspend fun googleConfig(): GoogleConfig = get(url("auth/google/config"))

    suspend fun login(username: String, password: String): LoginResponse =
        post(url("auth/login"), buildJsonObject {
            put("username", username.trim())
            put("password", password)
            put("device", DEVICE)
        })

    /** Signs in with a Google ID token from Credential Manager. */
    suspend fun googleLogin(idToken: String): LoginResponse =
        post(url("auth/google"), buildJsonObject {
            put("token", idToken)
            put("device", DEVICE)
        })

    suspend fun check(): AuthCheck = get(url("auth/check"))

    /** Ends this token on the server; never throws (signing out works offline too). */
    suspend fun logout() {
        runCatching { withContext(io) { execute(Request.Builder().url(url("auth/logout")).post(EMPTY_JSON).build()).close() } }
    }

    // ── Files ───────────────────────────────────────────────────────────────────
    /**
     * One page of a folder ("/Home", "/Home/Movies", "starred", "trash", "inbox"…), or with [query]
     * a search across all of the user's folders.
     */
    suspend fun listFiles(
        path: String = HOME,
        page: Int = 1,
        pageSize: Int = 50,
        sortBy: SortBy = SortBy.NAME,
        ascending: Boolean = true,
        query: String? = null,
    ): FilePage = get(
        url("files").newBuilder()
            .addQueryParameter("path", path)
            .addQueryParameter("page", page.toString())
            .addQueryParameter("page_size", pageSize.coerceIn(1, 500).toString())
            .addQueryParameter("sort_by", sortBy.wire)
            .addQueryParameter("sort_order", if (ascending) "asc" else "desc")
            .apply { query?.trim()?.takeIf { it.isNotEmpty() }?.let { addQueryParameter("q", it) } }
            .build()
    )

    // ── Playback ────────────────────────────────────────────────────────────────
    /** Size, length, audio tracks and subtitles of a video (the server probes it once, then caches it). */
    suspend fun mediaInfo(item: FileItem): MediaInfo = get(media.info(item))

    // ── Folder & File Actions ───────────────────────────────────────────────────
    suspend fun createFolder(name: String, parentPath: String = HOME): MessageReply =
        post(url("folders/create"), buildJsonObject {
            put("folderName", name.trim())
            put("currentPath", parentPath)
        })

    suspend fun rename(item: FileItem, newName: String): MessageReply =
        post(url("files/rename"), buildJsonObject {
            put("file_id", item.id)
            put("new_name", newName.trim())
        })

    suspend fun move(item: FileItem, targetFolderPath: String): MessageReply =
        post(url("files/move"), buildJsonObject {
            put("file_id", item.id)
            put("target_path", targetFolderPath)
        })

    suspend fun copy(item: FileItem, targetFolderPath: String): MessageReply =
        post(url("files/copy"), buildJsonObject {
            put("file_id", item.id)
            put("target_path", targetFolderPath)
        })

    suspend fun setStarred(item: FileItem, starred: Boolean): Boolean {
        val reply: StarReply = post(url("files/star"), buildJsonObject {
            put("file_id", item.id)
            put("starred", starred)
        })
        return reply.starred
    }

    suspend fun trash(item: FileItem): MessageReply =
        post(url("files/trash"), buildJsonObject {
            put("file_id", item.id)
        })

    suspend fun restore(item: FileItem): MessageReply =
        post(url("files/restore"), buildJsonObject {
            put("file_id", item.id)
        })

    suspend fun deleteForever(item: FileItem): MessageReply =
        post(url("files/delete"), buildJsonObject {
            put("file_id", item.id)
        })

    suspend fun emptyTrash(): MessageReply =
        post(url("files/trash/empty"), buildJsonObject { })

    // ── Plumbing ────────────────────────────────────────────────────────────────
    fun url(path: String): HttpUrl = baseUrl.newBuilder().addPathSegments(path).build()

    private suspend inline fun <reified T> get(url: HttpUrl): T =
        call(Request.Builder().url(url).get().build())

    private suspend inline fun <reified T> post(url: HttpUrl, body: JsonObject): T =
        call(Request.Builder().url(url).post(body.toString().toRequestBody(JSON)).build())

    /** Sends the request and reads and decodes the reply, all on [io], never on the caller's thread. */
    private suspend inline fun <reified T> call(request: Request): T = withContext(io) {
        val text = try {
            execute(request).use { it.body?.string().orEmpty() }
        } catch (e: IOException) {
            throw NetworkException("The connection to ${baseUrl.host} was lost. Try again.", e)
        }
        try {
            json.decodeFromString<T>(text)
        } catch (e: SerializationException) {
            throw ApiException(0, "The server sent a reply the app couldn't read. Update the app or the server.")
        }
    }

    /** Runs the request (blocking; call it on [io]); a refused request becomes an [ApiException]. */
    private fun execute(request: Request): Response {
        val response = try {
            http.newCall(request).execute()
        } catch (e: IOException) {
            throw NetworkException("Couldn't reach ${baseUrl.host}. Check your connection.", e)
        }
        if (response.isSuccessful) return response
        val message = response.use { errorMessage(it) }
        if (response.code == 401) {
            onUnauthorized()
            throw UnauthorizedException(message ?: "Please sign in again.")
        }
        throw ApiException(response.code, message ?: "The server answered with an error (${response.code}).")
    }

    companion object {
        const val TOKEN_HEADER = "X-Auth-Token"
        const val DEVICE = "android"
        const val HOME = "/Home"
        private val JSON = "application/json".toMediaType()
        private val EMPTY_JSON = "{}".toRequestBody(JSON)
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        /** FastAPI's {"detail": "..."} (or a list of validation problems) as one readable line. */
        internal fun errorMessage(response: Response): String? {
            val text = runCatching { response.body?.string() }.getOrNull()?.takeIf { it.isNotBlank() } ?: return null
            val detail = runCatching { json.parseToJsonElement(text).jsonObject["detail"] }.getOrNull() ?: return null
            return when (detail) {
                is JsonPrimitive -> detail.contentOrNull
                is JsonArray -> detail.mapNotNull { (it as? JsonObject)?.get("msg")?.jsonPrimitive?.contentOrNull }.joinToString("; ").ifBlank { null }
                else -> null
            }
        }
    }
}
