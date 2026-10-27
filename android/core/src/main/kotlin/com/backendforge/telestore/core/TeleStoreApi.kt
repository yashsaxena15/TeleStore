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
            // Only to our own server: thumbnails from Google Drive etc. use this client too
            val ours = request.url.host == baseUrl.host && request.url.port == baseUrl.port
            chain.proceed(if (t != null && ours && request.header(TOKEN_HEADER) == null) request.newBuilder().header(TOKEN_HEADER, t).build() else request)
        }
        .build()

    val media = MediaUrls(baseUrl, token)

    /** For the few requests the server takes minutes to answer (updating yt-dlp). */
    private val slowHttp: OkHttpClient by lazy { http.newBuilder().readTimeout(6, TimeUnit.MINUTES).build() }

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
        /** With path "all": only files inside this /Home folder and its subfolders. */
        under: String? = null,
    ): FilePage = get(
        url("files").newBuilder()
            .addQueryParameter("path", path)
            .addQueryParameter("page", page.toString())
            .addQueryParameter("page_size", pageSize.coerceIn(1, 500).toString())
            .addQueryParameter("sort_by", sortBy.wire)
            .addQueryParameter("sort_order", if (ascending) "asc" else "desc")
            .apply { query?.trim()?.takeIf { it.isNotEmpty() }?.let { addQueryParameter("q", it) } }
            .apply { (if (mediaOnly) "media" else kind?.wire)?.let { addQueryParameter("kind", it) } }
            .apply { under?.takeIf { it.isNotBlank() }?.let { addQueryParameter("under", it) } }
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

    // ── Google Drive ────────────────────────────────────────────────────────────
    suspend fun cloudAccounts(): CloudAccounts = get(url("cloud/accounts"))

    /** The Google page that lets TeleStore use a Drive account (opened in the browser). */
    suspend fun driveConnectUrl(): DriveAuthUrl = post(url("cloud/gdrive/auth-url"), buildJsonObject { })

    suspend fun disconnectCloud(accountId: String) {
        withContext(io) { execute(Request.Builder().url(url("cloud/accounts").newBuilder().addPathSegment(accountId).build()).delete().build()).close() }
    }

    suspend fun driveFiles(accountId: String, folderId: String = "root", pageToken: String? = null, query: String? = null): DriveList =
        get(
            url("cloud").newBuilder().addPathSegment(accountId).addPathSegment("files")
                .addQueryParameter("folder_id", folderId)
                .addQueryParameter("page_size", "100")
                .apply { pageToken?.let { addQueryParameter("page_token", it) } }
                .apply { query?.trim()?.takeIf { it.isNotEmpty() }?.let { addQueryParameter("query", it) } }
                .build(),
        )

    suspend fun driveQuota(accountId: String): DriveQuota = get(url("cloud").newBuilder().addPathSegment(accountId).addPathSegment("storage").build())

    /** A Drive file or folder into TeleStore ("copy", or "cut" to remove it from Drive). */
    suspend fun driveToTelestore(accountId: String, fileId: String, folder: String, cut: Boolean = false): AddReply =
        post(cloudUrl(accountId, "transfer-to-telegram"), buildJsonObject {
            put("source_file_id", fileId)
            put("destination_path", folder)
            put("operation", if (cut) "cut" else "copy")
        })

    /** TeleStore files and folders into a Drive folder. */
    suspend fun telestoreToDrive(accountId: String, items: List<FileItem>, driveFolderId: String): AddReply =
        post(cloudUrl(accountId, "transfer-from-telegram"), buildJsonObject {
            put("source_file_ids", JsonArray(items.filterNot { it.isFolder }.map { JsonPrimitive(it.id) }))
            put("source_folder_paths", JsonArray(items.filter { it.isFolder }.map { JsonPrimitive(FolderPaths.childPath(it)) }))
            put("target_folder_id", driveFolderId)
            put("operation", "copy")
        })

    suspend fun driveMkdir(accountId: String, name: String, parentId: String): MessageReply =
        post(cloudUrl(accountId, "files/mkdir"), buildJsonObject { put("folder_name", name.trim()); put("parent_id", parentId) })

    suspend fun driveRename(accountId: String, fileId: String, name: String): MessageReply =
        post(cloudUrl(accountId, "files/rename"), buildJsonObject { put("file_id", fileId); put("new_name", name.trim()) })

    /** To Drive's own trash (or gone for good with [permanent]). */
    suspend fun driveDelete(accountId: String, fileId: String, permanent: Boolean = false): MessageReply =
        post(cloudUrl(accountId, "files/delete"), buildJsonObject { put("file_id", fileId); put("permanent", permanent) })

    suspend fun driveStar(accountId: String, fileId: String, starred: Boolean): MessageReply =
        post(cloudUrl(accountId, "files/star"), buildJsonObject { put("file_id", fileId); put("starred", starred) })

    /** Where a Drive file can be downloaded through this server (the phone never talks to Google). */
    fun driveDownloadPath(accountId: String, fileId: String): String = "/cloud/$accountId/download/$fileId"

    private fun cloudUrl(accountId: String, path: String) = url("cloud").newBuilder().addPathSegment(accountId).addPathSegments(path).build()

    /** What made the app close unexpectedly, so it can be fixed (the server logs it). */
    suspend fun reportCrash(report: String, version: String, device: String): MessageReply =
        post(url("system/app-crash"), buildJsonObject {
            put("report", report.take(19_000))
            put("version", version.take(40))
            put("device", device.take(120))
        })

    // ── Settings ────────────────────────────────────────────────────────────────
    suspend fun profile(): UserProfile = get(url("user/profile"))
    suspend fun isOwner(): Boolean = get<OwnerReply>(url("user/is-owner")).isOwner

    /** [user]: an id from the user list, or the signed-in username for your own password. Empty [current] when you have none yet. */
    suspend fun changePassword(user: String, current: String, new: String): MessageReply =
        put(url("user").newBuilder().addPathSegment(user).addPathSegment("password").build(), buildJsonObject {
            put("current_password", current)
            put("new_password", new)
        })

    /** A code and a link that opens the bot in Telegram; sending it links this account's Telegram. */
    suspend fun telegramVerification(): TelegramVerification =
        post(url("telegram/generate-verification"), buildJsonObject { put("user_id", "None") })

    suspend fun indexChat(): IndexChat = get(url("user/index-chat"))
    suspend fun setIndexChat(chatId: Long): IndexChat = put(url("user/index-chat"), buildJsonObject { put("index_chat_id", chatId) })

    /** Forgot password: a 6-digit code goes to the account's email. */
    suspend fun forgotPassword(username: String): MessageReply =
        post(url("auth/forgot-password/request"), buildJsonObject { put("username", username.trim()) })

    suspend fun resetPassword(username: String, code: String, new: String): MessageReply =
        post(url("auth/forgot-password/reset"), buildJsonObject {
            put("username", username.trim())
            put("code", code.trim())
            put("new_password", new)
        })

    suspend fun vaultRecoveryCode(email: String, pin: String): MessageReply =
        post(url("vault/recovery-email/request-otp"), buildJsonObject {
            put("email", email.trim())
            put("pin", pin)
        })

    suspend fun vaultRecoveryConfirm(email: String, pin: String, code: String): MessageReply =
        post(url("vault/recovery-email/confirm"), buildJsonObject {
            put("email", email.trim())
            put("pin", pin)
            put("otp_code", code.trim())
        })

    // Users (owner)
    suspend fun users(): ManagedUsers = get(url("user"))

    /** A password account ([username] and [password]) or a Google one (email only). */
    suspend fun addUser(email: String, canUpload: Boolean, username: String? = null, password: String? = null): ManagedUser =
        post(url("user"), buildJsonObject {
            username?.let { put("username", it.trim()) }
            password?.let { put("password", it) }
            put("email", email.trim())
            put("can_upload", canUpload)
        })

    suspend fun updateUser(id: String, email: String? = null, active: Boolean? = null, canUpload: Boolean? = null): ManagedUser =
        put(url("user").newBuilder().addPathSegment(id).build(), buildJsonObject {
            email?.let { put("email", it.trim()) }
            active?.let { put("active", it) }
            canUpload?.let { put("can_upload", it) }
        })

    suspend fun removeUser(id: String) = delete(url("user").newBuilder().addPathSegment(id).build())

    // Video downloads (yt-dlp; changing them is for the owner)
    suspend fun mediaSettings(): MediaSettings = get(url("transfers/remote/media/settings"))

    suspend fun uploadCookies(name: String, bytes: ByteArray): MediaSettings =
        call(
            Request.Builder().url(url("transfers/remote/media/cookies")).post(
                MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("file", name, bytes.toRequestBody("text/plain".toMediaType()))
                    .build(),
            ).build(),
        )

    suspend fun removeCookies(): MediaSettings = call(Request.Builder().url(url("transfers/remote/media/cookies")).delete().build())

    /** Installs the newest yt-dlp on the server; takes up to a few minutes. */
    suspend fun updateDownloader(): MediaSettings =
        call(Request.Builder().url(url("transfers/remote/media/update")).post(EMPTY_JSON).build(), slowHttp)
    suspend fun useBuiltinDownloader(): MediaSettings = post(url("transfers/remote/media/use-builtin"), buildJsonObject { })

    suspend fun mediaSyncs(): MediaSyncs = get(url("transfers/remote/media/syncs"))
    suspend fun setSyncEnabled(id: String, enabled: Boolean): MediaSync =
        post(syncUrl(id), buildJsonObject { put("enabled", enabled) })
    suspend fun checkSync(id: String): SyncCheck = post(syncUrl(id).newBuilder().addPathSegment("check").build(), buildJsonObject { })
    suspend fun removeSync(id: String) = delete(syncUrl(id))
    private fun syncUrl(id: String) = url("transfers/remote/media/syncs").newBuilder().addPathSegment(id).build()

    // Instagram (the owner's account, used for every import)
    suspend fun instagramSession(): InstagramSession = get(url("transfers/remote/instagram/session"))
    suspend fun instagramLogin(username: String, password: String): InstagramSession =
        post(url("transfers/remote/instagram/session/login"), buildJsonObject {
            put("username", username.trim())
            put("password", password)
        })
    suspend fun instagramCode(code: String): InstagramSession =
        post(url("transfers/remote/instagram/session/2fa"), buildJsonObject { put("code", code.trim()) })
    suspend fun instagramBrowserSession(sessionId: String): InstagramSession =
        post(url("transfers/remote/instagram/session/browser"), buildJsonObject { put("sessionid", sessionId.trim()) })
    suspend fun instagramLogout(): InstagramSession = call(Request.Builder().url(url("transfers/remote/instagram/session")).delete().build())

    // ── Archives ────────────────────────────────────────────────────────────────
    /** What's inside a ZIP, RAR, 7z or TAR. The server reads the archive, so this can take a while. */
    suspend fun inspectArchive(item: FileItem): ArchiveContents =
        get(url("archive/inspect").newBuilder().addPathSegment(item.id).build())

    /** Unpacks the archive into [folder] on the server; progress in [archiveTasks]. */
    suspend fun extractArchive(item: FileItem, folder: String): MessageReply =
        post(url("archive/extract"), buildJsonObject {
            put("file_id", item.id)
            put("target_path", folder)
        })

    /** Packs [items] into one ZIP saved in [folder]. */
    suspend fun compress(items: List<FileItem>, folder: String, zipName: String): MessageReply =
        post(url("archive/compress"), buildJsonObject {
            put("item_ids", JsonArray(items.map { JsonPrimitive(it.id) }))
            put("destination_path", folder)
            put("zip_name", zipName.trim())
        })

    suspend fun archiveTasks(): ArchiveTasks = get(url("archive/tasks"))
    suspend fun cancelArchiveTask(id: String): MessageReply =
        post(url("archive/tasks").newBuilder().addPathSegment(id).addPathSegment("cancel").build(), buildJsonObject { })

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

    // ── Playlists ───────────────────────────────────────────────────────────────
    /** Liked music first, then the user's playlists. */
    suspend fun playlists(): List<Playlist> = get<PlaylistsReply>(url("files/playlists")).playlists

    /** One playlist with its items. */
    suspend fun playlist(id: String): Playlist = get(playlistUrl(id))

    suspend fun createPlaylist(name: String, items: List<FileItem> = emptyList()): Playlist = post(url("files/playlists"), buildJsonObject {
        put("name", name.trim())
        if (items.isNotEmpty()) put("file_ids", fileIds(items))
    })

    suspend fun renamePlaylist(id: String, name: String): Playlist =
        call(Request.Builder().url(playlistUrl(id)).patch(buildJsonObject { put("name", name.trim()) }.toString().toRequestBody(JSON)).build())

    suspend fun deletePlaylist(id: String) {
        call<MessageReply>(Request.Builder().url(playlistUrl(id)).delete().build())
    }

    suspend fun addToPlaylist(id: String, items: List<FileItem>): Playlist =
        post(playlistUrl(id, "items"), buildJsonObject { put("file_ids", fileIds(items)) })

    suspend fun removeFromPlaylist(id: String, items: List<FileItem>): Playlist =
        post(playlistUrl(id, "items/remove"), buildJsonObject { put("file_ids", fileIds(items)) })

    /** [items] in their new order (exactly the playlist's items). */
    suspend fun reorderPlaylist(id: String, items: List<FileItem>): Playlist =
        put(playlistUrl(id, "order"), buildJsonObject { put("file_ids", fileIds(items)) })

    /** Likes or unlikes [item]; returns whether it's liked now. */
    suspend fun setLiked(item: FileItem, liked: Boolean): Boolean = post<LikeReply>(url("files/playlists/like"), buildJsonObject {
        put("file_id", item.id)
        put("liked", liked)
    }).liked

    private fun playlistUrl(id: String, rest: String? = null): HttpUrl =
        url("files/playlists").newBuilder().addPathSegment(id).apply { if (rest != null) addPathSegments(rest) }.build()

    private fun fileIds(items: List<FileItem>) = kotlinx.serialization.json.JsonArray(items.map { kotlinx.serialization.json.JsonPrimitive(it.id) })

    // ── Notifications ───────────────────────────────────────────────────────────
    /** The newest notifications, or with [after] only those newer than that id. */
    suspend fun notifications(after: String? = null, limit: Int = 30): NotificationList = get(
        url("user/notifications").newBuilder()
            .apply { after?.let { addQueryParameter("after", it) } }
            .addQueryParameter("limit", limit.coerceIn(1, 100).toString())
            .build()
    )

    /** Marks [ids] read, or every one with [all]; returns how many are still unread. */
    suspend fun markNotificationsRead(ids: List<String> = emptyList(), all: Boolean = false): Int = post<UnreadReply>(url("user/notifications/read"), buildJsonObject {
        put("ids", kotlinx.serialization.json.JsonArray(ids.map { kotlinx.serialization.json.JsonPrimitive(it) }))
        put("all", all)
    }).unread

    // ── Your devices ────────────────────────────────────────────────────────────
    /** Where this account is signed in, this phone first. */
    suspend fun devices(): List<SignedInDevice> = get<DevicesReply>(url("auth/devices")).devices

    /** Signs another device out; its next request lands on its sign-in screen. */
    suspend fun signOutDevice(id: String): MessageReply =
        call(Request.Builder().url(url("auth/devices").newBuilder().addPathSegment(id).build()).delete().build())

    /** Signs out every device but this one; returns how many. */
    suspend fun signOutOtherDevices(): Int = post<SignedOutReply>(url("auth/devices/sign-out-others"), buildJsonObject { }).signedOut

    /** Every file in [folderPath] and its subfolders (for folders kept offline). */
    suspend fun filesUnder(folderPath: String, max: Int = 5000): List<FileItem> {
        val found = mutableListOf<FileItem>()
        val folders = ArrayDeque(listOf(folderPath))
        while (folders.isNotEmpty() && found.size < max) {
            val path = folders.removeFirst()
            var page = 1
            while (true) {
                val result = listFiles(path, page = page, pageSize = 500)
                result.files.forEach { if (it.isFolder) folders += FolderPaths.childPath(it) else found += it }
                if (result.pagination?.hasNext != true) break
                page++
            }
        }
        return found.take(max)
    }

    // ── Plumbing ────────────────────────────────────────────────────────────────
    fun url(path: String): HttpUrl = baseUrl.newBuilder().addPathSegments(path).build()

    private suspend inline fun <reified T> get(url: HttpUrl): T =
        call(Request.Builder().url(url).get().build())

    private suspend inline fun <reified T> post(url: HttpUrl, body: JsonObject): T =
        call(Request.Builder().url(url).post(body.toString().toRequestBody(JSON)).build())

    private suspend inline fun <reified T> put(url: HttpUrl, body: JsonObject): T =
        call(Request.Builder().url(url).put(body.toString().toRequestBody(JSON)).build())

    private suspend fun delete(url: HttpUrl) {
        withContext(io) { execute(Request.Builder().url(url).delete().build()).close() }
    }

    /** Sends the request and reads and decodes the reply, all on [io], never on the caller's thread. */
    private suspend inline fun <reified T> call(request: Request, client: OkHttpClient = http): T = withContext(io) {
        val text = try {
            execute(request, client).use { it.body?.string().orEmpty() }
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
    private fun execute(request: Request, client: OkHttpClient = http): Response {
        val response = try {
            client.newCall(request).execute()
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
