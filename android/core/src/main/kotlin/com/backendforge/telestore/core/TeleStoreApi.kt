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
import okhttp3.FormBody
import okhttp3.MultipartBody
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
        // The server's session cookie: it holds "vault unlocked". Kept in memory only, so closing the app locks the vault.
        .cookieJar(MemoryCookieJar())
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
        /** With path "all": only this kind (video, photo, audio or document). */
        kind: FileKind? = null,
        /** With path "all": photos and videos together (the Photos timeline). */
        mediaOnly: Boolean = false,
    ): FilePage = get(
        url("files").newBuilder()
            .addQueryParameter("path", path)
            .addQueryParameter("page", page.toString())
            .addQueryParameter("page_size", pageSize.coerceIn(1, 500).toString())
            .addQueryParameter("sort_by", sortBy.wire)
            .addQueryParameter("sort_order", if (ascending) "asc" else "desc")
            .apply { query?.trim()?.takeIf { it.isNotEmpty() }?.let { addQueryParameter("q", it) } }
            .apply { (if (mediaOnly) "media" else kind?.wire)?.let { addQueryParameter("kind", it) } }
            .build()
    )

    // ── Private Vault ───────────────────────────────────────────────────────────
    suspend fun vaultStatus(): VaultStatus = get(url("vault/status"))
    suspend fun vaultSetupCode(email: String): MessageReply = post(url("vault/setup/request-otp"), buildJsonObject { put("email", email.trim()) })
    suspend fun vaultCheckCode(code: String, email: String): MessageReply = post(url("vault/verify-otp"), buildJsonObject {
        put("otp_code", code.trim())
        put("purpose", "Private Vault Setup")
        put("email", email.trim())
    })
    suspend fun vaultCreate(email: String, code: String, pin: String): MessageReply = post(url("vault/setup/verify-and-create"), buildJsonObject {
        put("email", email.trim())
        put("otp_code", code.trim())
        put("pin", pin)
    })
    suspend fun vaultUnlock(pin: String): MessageReply = post(url("vault/unlock"), buildJsonObject { put("pin", pin) })
    suspend fun vaultLock(): MessageReply = post(url("vault/lock"), buildJsonObject { })
    suspend fun vaultForgotCode(): MessageReply = post(url("vault/forgot-pin/request-otp"), buildJsonObject { })
    suspend fun vaultResetPin(code: String, newPin: String): MessageReply = post(url("vault/forgot-pin/reset"), buildJsonObject {
        put("otp_code", code.trim())
        put("new_pin", newPin)
    })
    suspend fun vaultChangePin(current: String, newPin: String): MessageReply = post(url("vault/change-pin"), buildJsonObject {
        put("current_pin", current)
        put("new_pin", newPin)
    })
    suspend fun vaultAutoLock(minutes: Int): MessageReply =
        call(Request.Builder().url(url("vault/settings")).put(buildJsonObject { put("auto_lock_minutes", minutes) }.toString().toRequestBody(JSON)).build())
    suspend fun moveIntoVault(item: FileItem, folder: String = VAULT): MessageReply = post(url("vault/move-in"), buildJsonObject {
        put("file_id", item.id)
        put("target_path", folder)
    })
    suspend fun moveOutOfVault(item: FileItem, folder: String = HOME): MessageReply = post(url("vault/move-out"), buildJsonObject {
        put("file_id", item.id)
        put("target_path", folder)
    })
    suspend fun createVaultFolder(name: String, parent: String = VAULT): MessageReply = post(url("vault/create-folder"), buildJsonObject {
        put("folder_name", name.trim())
        put("current_path", parent)
    })

    // ── Account ─────────────────────────────────────────────────────────────────
    /** How much the account stores, out of its quota. */
    suspend fun storage(): StorageStats = get(url("files/analytics"))

    // ── Playback ────────────────────────────────────────────────────────────────
    /** Size, length, audio tracks and subtitles of a video (the server probes it once, then caches it). */
    suspend fun mediaInfo(item: FileItem): MediaInfo = get(media.info(item))

    // ── Uploads (the website's chunked protocol) ────────────────────────────────
    /** Starts an upload, or continues [resumeId] when the server still has it. */
    suspend fun uploadInit(name: String, size: Long, folder: String, resumeId: String? = null, takenAt: String? = null): UploadSession =
        post(url("files/upload/init"), buildJsonObject {
            put("filename", name)
            put("filesize", size)
            put("path", folder)
            resumeId?.let { put("resume_upload_id", it) }
            takenAt?.let { put("taken_at", it) }
        })

    /** Makes every folder along [fullPath] (e.g. "/Home/Phone Backup/Camera"); fine if they exist. */
    suspend fun createFolderPath(fullPath: String): MessageReply =
        post(url("folders/create-path"), buildJsonObject { put("fullPath", fullPath) })

    /** One chunk as the raw body; a chunk sent twice is simply written again in place. */
    suspend fun uploadChunk(uploadId: String, index: Int, bytes: ByteArray, length: Int = bytes.size) {
        val body = bytes.toRequestBody(OCTET, 0, length)
        val request = Request.Builder().url(url("files/upload/chunk/$uploadId/$index")).put(body).build()
        withContext(io) { execute(request).close() }
    }

    suspend fun uploadComplete(uploadId: String): UploadStatus =
        call(Request.Builder().url(url("files/upload/complete")).post(FormBody.Builder().add("upload_id", uploadId).build()).build())

    suspend fun uploadStatus(uploadId: String): UploadStatus = get(url("files/upload/status/$uploadId"))

    /** Drops the server's half-uploaded copy; never throws. */
    suspend fun uploadAbort(uploadId: String) {
        runCatching { post<MessageReply>(url("files/upload/abort"), buildJsonObject { put("upload_id", uploadId) }) }
    }

    // ── Folder downloads and server transfers ──────────────────────────────────
    /** A folder is downloaded as one or more ZIP files of up to 2 GB each. */
    suspend fun folderDownloadInfo(folderPath: String): FolderDownloadInfo =
        get(url("folders/download-info").newBuilder().addQueryParameter("path", folderPath).build())

    /** The server's own transfers (cloud leech, Google Drive, video links). */
    suspend fun remoteTasks(): RemoteTaskList = get(url("transfers/remote/tasks"))
    suspend fun cancelRemote(taskId: String): MessageReply = post(url("transfers/remote/cancel"), buildJsonObject { put("task_id", taskId) })
    suspend fun retryRemote(taskId: String): MessageReply = post(url("transfers/remote/retry"), buildJsonObject { put("task_id", taskId) })
    suspend fun cancelRemoteGroup(groupId: String): MessageReply = post(url("transfers/remote/cancel-group"), buildJsonObject { put("group_id", groupId) })
    suspend fun resumeRemoteGroup(groupId: String): MessageReply = post(url("transfers/remote/resume-group"), buildJsonObject { put("group_id", groupId) })
    suspend fun clearFinishedRemote(): MessageReply = post(url("transfers/remote/clear-completed"), buildJsonObject { })

    // ── Add from a link (the server fetches it) ────────────────────────────────
    /** A Google Drive file or folder, a magnet, or a direct link, saved into [folder]. */
    suspend fun addFromLink(link: String, folder: String): AddReply =
        post(url("transfers/remote/add"), buildJsonObject {
            put("url", link.trim())
            put("destination_path", folder)
        })

    /** A .torrent file's bytes. */
    suspend fun addTorrent(name: String, bytes: ByteArray, folder: String): AddReply =
        call(
            Request.Builder().url(url("transfers/remote/upload-torrent")).post(
                MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("file", name, bytes.toRequestBody("application/x-bittorrent".toMediaType()))
                    .addFormDataPart("destination_path", folder)
                    .build(),
            ).build(),
        )

    /** What a video link holds (title, sizes, or a playlist's videos). Can take a while: the server asks the site. */
    suspend fun mediaPreview(link: String): MediaPreview =
        post(url("transfers/remote/media/preview"), buildJsonObject { put("url", link.trim()) })

    suspend fun downloadMedia(link: String, choice: JsonObject, folder: String, items: List<Int>? = null, sync: Boolean = false): AddReply =
        post(url("transfers/remote/media"), buildJsonObject {
            put("url", link.trim())
            put("choice", choice)
            put("destination", homeDestination(folder))
            items?.let { put("items", JsonArray(it.map { i -> JsonPrimitive(i) })) }
            put("sync", sync)
        })

    suspend fun instagramPreview(link: String): InstagramPreview =
        post(url("transfers/remote/instagram/preview"), buildJsonObject { put("url", link.trim()) })

    suspend fun importInstagram(link: String, folder: String): AddReply =
        post(url("transfers/remote/instagram"), buildJsonObject {
            put("url", link.trim())
            put("destination", homeDestination(folder))
        })

    private fun homeDestination(folder: String) = buildJsonObject {
        put("kind", "home")
        put("path", folder)
    }

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
        if (response.code == 429) {
            val wait = response.header("Retry-After")?.toLongOrNull() ?: 3
            throw RetryLaterException(wait.coerceIn(1, 60), message ?: "The server is busy. Trying again shortly.")
        }
        throw ApiException(response.code, message ?: "The server answered with an error (${response.code}).")
    }

    companion object {
        const val TOKEN_HEADER = "X-Auth-Token"
        const val DEVICE = "android"
        const val HOME = "/Home"
        const val VAULT = "/Vault"
        private val JSON = "application/json".toMediaType()
        private val OCTET = "application/octet-stream".toMediaType()
        private val EMPTY_JSON = "{}".toRequestBody(JSON)
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS) // video link previews ask the site and can be slow
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
