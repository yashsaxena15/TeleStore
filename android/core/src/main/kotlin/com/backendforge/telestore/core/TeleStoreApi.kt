package com.backendforge.telestore.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
        runCatching { send(Request.Builder().url(url("auth/logout")).post(EMPTY_JSON).build()).close() }
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

    // ── Plumbing ────────────────────────────────────────────────────────────────
    fun url(path: String): HttpUrl = baseUrl.newBuilder().addPathSegments(path).build()

    private suspend inline fun <reified T> get(url: HttpUrl): T =
        decode(send(Request.Builder().url(url).get().build()))

    private suspend inline fun <reified T> post(url: HttpUrl, body: JsonObject): T =
        decode(send(Request.Builder().url(url).post(body.toString().toRequestBody(JSON)).build()))

    private inline fun <reified T> decode(response: Response): T = response.use {
        json.decodeFromString(it.body?.string().orEmpty())
    }

    private suspend fun send(request: Request): Response = withContext(Dispatchers.IO) {
        val response = try {
            http.newCall(request).execute()
        } catch (e: IOException) {
            throw NetworkException("Couldn't reach ${baseUrl.host}. Check your connection.", e)
        }
        if (response.isSuccessful) return@withContext response
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
