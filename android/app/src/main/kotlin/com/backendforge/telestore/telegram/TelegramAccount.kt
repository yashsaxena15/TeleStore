package com.backendforge.telestore.telegram

import android.content.Context
import android.os.Build
import com.backendforge.telestore.core.DirectConfig
import com.backendforge.telestore.data.AppVersion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.withLock
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Where signing in to Telegram on this phone is. */
sealed interface TgState {
    /** TDLib isn't on this phone (not a 64-bit ARM phone): everything goes through TeleStore. */
    data object Unavailable : TgState
    data object Starting : TgState
    data object SignedOut : TgState
    data class WaitCode(val phone: String, val via: String) : TgState
    data class WaitPassword(val hint: String) : TgState

    /**
     * Signing in by QR code: [link] (tg://login?token=…) shown as a QR code, scanned on a phone where
     * Telegram is signed in (Settings › Devices › Link Desktop Device). Telegram renews it every half
     * minute or so; each new one arrives here.
     */
    data class WaitQr(val link: String) : TgState
    data class Ready(val name: String, val userId: Long) : TgState

    /** A step this app can't do (a new Telegram account, an email check): finish it in Telegram first. */
    data class Unsupported(val what: String) : TgState
}

class TgException(val code: Int, message: String) : Exception(message)

/**
 * The person's own Telegram account on this phone, through TDLib (Telegram's official library).
 * Its session stays in the app's private storage; TeleStore's server never sees it.
 */
class TelegramAccount(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow<TgState>(TgState.Starting)
    val state: StateFlow<TgState> = _state.asStateFlow()
    private val _updates = MutableSharedFlow<TdApi.Object>(extraBufferCapacity = 512)

    /** Everything TDLib reports besides sign-in (file progress for uploads and playback). */
    val updates: SharedFlow<TdApi.Object> = _updates.asSharedFlow()
    @Volatile private var client: Client? = null
    @Volatile private var config: DirectConfig? = null
    private var phone = ""

    /** Whether TDLib's native library is on this phone (loaded once). */
    val available: Boolean by lazy {
        runCatching { System.loadLibrary("tdjni"); true }.getOrDefault(false)
    }

    val isReady: Boolean get() = _state.value is TgState.Ready

    /** Starts TDLib with the server's Telegram app ID; a saved session signs in by itself. */
    @Synchronized
    fun start(config: DirectConfig) {
        if (!available) {
            _state.value = TgState.Unavailable
            return
        }
        this.config = config
        if (client != null) return
        _state.value = TgState.Starting
        runCatching { Client.execute(TdApi.SetLogVerbosityLevel(1)) }
        client = Client.create({ onUpdate(it) }, null, null)
    }

    private fun onUpdate(update: TdApi.Object) {
        when (update) {
            is TdApi.UpdateAuthorizationState -> onAuthorization(update.authorizationState)
            is TdApi.UpdateMessageSendSucceeded -> sent(update.oldMessageId, Result.success(update.message))
            is TdApi.UpdateMessageSendFailed -> sent(update.oldMessageId, Result.failure(TgException(update.error.code, friendly(update.error.message))))
            else -> _updates.tryEmit(update)
        }
    }

    // ── Sending: Telegram first answers with a temporary message, then reports when it's really sent ──
    private val waiting = java.util.concurrent.ConcurrentHashMap<Long, kotlinx.coroutines.CompletableDeferred<TdApi.Message>>()
    private val early = java.util.concurrent.ConcurrentHashMap<Long, Result<TdApi.Message>>()

    private fun sent(oldId: Long, result: Result<TdApi.Message>) {
        val wait = waiting.remove(oldId)
        if (wait == null) early[oldId] = result else result.fold({ wait.complete(it) }, { wait.completeExceptionally(it) })
    }

    /** Waits until the message Telegram is sending ([pending]) is really in the chat, reporting its upload progress. */
    suspend fun awaitSent(pending: TdApi.Message, fileId: Int?, onProgress: (Long) -> Unit): TdApi.Message = kotlinx.coroutines.coroutineScope {
        val progress = launch {
            if (fileId != null) {
                updates.collect { u -> if (u is TdApi.UpdateFile && u.file.id == fileId) onProgress(u.file.remote.uploadedSize) }
            }
        }
        try {
            early.remove(pending.id)?.let { return@coroutineScope it.getOrThrow() }
            val wait = kotlinx.coroutines.CompletableDeferred<TdApi.Message>()
            waiting[pending.id] = wait
            early.remove(pending.id)?.let { waiting.remove(pending.id); return@coroutineScope it.getOrThrow() }
            wait.await()
        } finally {
            waiting.remove(pending.id)
            progress.cancel()
        }
    }

    // ── The storage channel ──
    private val knownChats = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<Long, Boolean>())

    /** Makes sure Telegram on this phone knows the storage channel (it must have seen it once). */
    suspend fun ensureChat(chatId: Long) {
        if (chatId in knownChats) return
        if (runCatching { send(TdApi.GetChat(chatId)) }.isFailure) {
            var found = false
            for (round in 0 until 50) {
                val more = runCatching { send(TdApi.LoadChats(TdApi.ChatListMain(), 100)) }
                found = runCatching { send(TdApi.GetChat(chatId)) }.isSuccess
                if (found || more.isFailure) break // found it, or every chat is loaded
            }
            if (!found) throw TgException(404, "This Telegram account isn't in your TeleStore storage channel. " +
                "Sign in with the account that owns the channel.")
        }
        knownChats += chatId
    }

    // ── Reading files of the storage channel ──
    private val fileIds = java.util.concurrent.ConcurrentHashMap<Pair<Long, Long>, Int>()

    /** TDLib's id for the file in one message ([messageId] as the server knows it). */
    suspend fun fileIdFor(chatId: Long, messageId: Long): Int {
        fileIds[chatId to messageId]?.let { return it }
        ensureChat(chatId)
        val msg = send(TdApi.GetMessage(chatId, TgIds.toTdlib(messageId)))
        val file = when (val c = msg.content) {
            is TdApi.MessageDocument -> c.document.document
            is TdApi.MessageVideo -> c.video.video
            is TdApi.MessageAudio -> c.audio.audio
            is TdApi.MessagePhoto -> c.photo.sizes.maxByOrNull { it.width.toLong() * it.height }?.photo
            else -> null
        } ?: throw TgException(404, "That message has no file.")
        fileIds[chatId to messageId] = file.id
        fileSizes[file.id] = maxOf(file.size, file.expectedSize)
        return file.id
    }

    // TDLib downloads one range of a file at a time: a new downloadFile with another offset replaces
    // the running one. So each file has one request in flight, a window ahead of the reader, and
    // bytes are read once TDLib says they're there (getFileDownloadedPrefixSize).
    private val fileSizes = java.util.concurrent.ConcurrentHashMap<Int, Long>()
    private val wanted = java.util.concurrent.ConcurrentHashMap<Int, LongRange>()
    private val fileLocks = java.util.concurrent.ConcurrentHashMap<Int, kotlinx.coroutines.sync.Mutex>()

    /** Bytes [offset, offset + length) of one message's file, fetched from Telegram as needed. */
    suspend fun readPart(chatId: Long, messageId: Long, offset: Long, length: Long): ByteArray {
        val fileId = fileIdFor(chatId, messageId)
        val lock = fileLocks.getOrPut(fileId) { kotlinx.coroutines.sync.Mutex() }
        return lock.withLock {
            val started = System.nanoTime()
            var lastHave = -1L
            var lastMove = started
            while (true) {
                val have = send(TdApi.GetFileDownloadedPrefixSize(fileId, offset)).size
                if (have >= length) {
                    // Enough is here; when little is left ready beyond it, the next window is asked for now
                    if (have - length < LOW_WATER) want(fileId, offset + have)
                    break
                }
                val now = System.nanoTime()
                if (have != lastHave) {
                    lastHave = have
                    lastMove = now
                } else if (now - lastMove > STALL_NS) {
                    wanted.remove(fileId) // nothing arrived for a while (the request was replaced): ask again
                    lastMove = now
                }
                want(fileId, offset + have)
                if (now - started > TIMEOUT_NS) throw TgException(0, "Telegram is too slow to send this file right now.")
                kotlinx.coroutines.delay(POLL_MS)
            }
            send(TdApi.ReadFilePart(fileId, offset, length)).data
        }
    }

    /** Makes sure Telegram is fetching [fileId] from [from] (a window of [AHEAD] bytes), asking once per window. */
    private suspend fun want(fileId: Int, from: Long) {
        val size = fileSizes[fileId] ?: 0L
        if (size in 1..from) return // the end of the file: nothing more to fetch
        val running = wanted[fileId]
        if (running != null && from >= running.first && from < running.last - LOW_WATER) return
        wanted[fileId] = from until from + AHEAD
        send(TdApi.DownloadFile(fileId, 32, from, AHEAD, false))
    }

    /** Keeps Telegram's own copies of played and downloaded files under [maxBytes] on this phone. */
    fun trimCache(maxBytes: Long = 1L shl 30) {
        if (client == null) return
        scope.launch {
            runCatching {
                send(TdApi.OptimizeStorage(maxBytes, 3 * 24 * 3600, -1, 60, arrayOf<TdApi.FileType>(), longArrayOf(), longArrayOf(), false, 0))
            }
        }
    }

    private fun onAuthorization(auth: TdApi.AuthorizationState) {
        when (auth) {
            is TdApi.AuthorizationStateWaitTdlibParameters -> scope.launch {
                runCatching { send(parameters()) }.onFailure { _state.value = TgState.Unsupported(it.message ?: "Telegram couldn't start") }
            }
            is TdApi.AuthorizationStateWaitPhoneNumber -> _state.value = TgState.SignedOut
            is TdApi.AuthorizationStateWaitCode -> _state.value = TgState.WaitCode(phone, via(auth.codeInfo?.type))
            is TdApi.AuthorizationStateWaitPassword -> _state.value = TgState.WaitPassword(auth.passwordHint.orEmpty())
            is TdApi.AuthorizationStateWaitOtherDeviceConfirmation -> _state.value = TgState.WaitQr(auth.link)
            is TdApi.AuthorizationStateReady -> scope.launch {
                val me = runCatching { send(TdApi.GetMe()) }.getOrNull()
                val name = listOfNotNull(me?.firstName, me?.lastName).joinToString(" ").ifBlank { "your Telegram account" }
                _state.value = TgState.Ready(name, me?.id ?: 0L)
            }
            is TdApi.AuthorizationStateLoggingOut, is TdApi.AuthorizationStateClosing -> _state.value = TgState.Starting
            is TdApi.AuthorizationStateClosed -> {
                // After signing out TDLib closes; a new client waits for the next sign-in
                synchronized(this) { client = null }
                config?.let { start(it) }
            }
            else -> _state.value = TgState.Unsupported(
                "Telegram needs a step this app can't do here. Finish signing in in the Telegram app, then try again.",
            )
        }
    }

    private fun parameters() = TdApi.SetTdlibParameters().apply {
        val c = config!!
        useTestDc = false
        databaseDirectory = File(context.noBackupFilesDir, "tdlib").path
        filesDirectory = File(context.cacheDir, "tdlib-files").path
        databaseEncryptionKey = ByteArray(0)
        useFileDatabase = true
        useChatInfoDatabase = true
        useMessageDatabase = false
        useSecretChats = false
        apiId = c.apiId
        apiHash = c.apiHash
        systemLanguageCode = "en"
        deviceModel = "TeleStore for Android (${Build.MANUFACTURER} ${Build.MODEL})".take(64)
        systemVersion = "Android ${Build.VERSION.RELEASE}"
        applicationVersion = runCatching { AppVersion.of(context).name }.getOrDefault("1.0")
    }

    private fun via(type: TdApi.AuthenticationCodeType?): String = when (type) {
        is TdApi.AuthenticationCodeTypeTelegramMessage -> "in your Telegram app"
        is TdApi.AuthenticationCodeTypeSms -> "by SMS"
        is TdApi.AuthenticationCodeTypeCall, is TdApi.AuthenticationCodeTypeFlashCall, is TdApi.AuthenticationCodeTypeMissedCall -> "by a phone call"
        else -> "to your phone"
    }

    /** Sends one request to TDLib and waits for its answer (a TDLib error becomes a [TgException]). */
    @Suppress("UNCHECKED_CAST")
    suspend fun <T : TdApi.Object> send(function: TdApi.Function<T>): T {
        val c = client ?: throw TgException(0, "Telegram isn't started on this phone.")
        return suspendCancellableCoroutine { cont ->
            c.send(function, { result ->
                if (result is TdApi.Error) cont.resumeWithException(TgException(result.code, friendly(result.message)))
                else cont.resume(result as T)
            }, { e -> cont.resumeWithException(e) })
        }
    }

    suspend fun sendPhone(number: String) {
        phone = number.filter { it.isDigit() || it == '+' }
        send(TdApi.SetAuthenticationPhoneNumber(phone, TdApi.PhoneNumberAuthenticationSettings().apply { authenticationTokens = arrayOf() }))
    }

    /**
     * Signs in by QR code instead of a phone number: no number or code is typed on this phone, so it
     * suits someone else's phone. The QR code comes as [TgState.WaitQr].
     */
    suspend fun startQr() {
        send(TdApi.RequestQrCodeAuthentication(longArrayOf()))
    }

    suspend fun sendCode(code: String) {
        send(TdApi.CheckAuthenticationCode(code.trim()))
    }

    suspend fun sendPassword(password: String) {
        send(TdApi.CheckAuthenticationPassword(password))
    }

    /** Leaves a half-done sign-in (a QR code showing) and starts again from the choice of QR code or phone number. */
    suspend fun restartSignIn() {
        if (client != null && _state.value !is TgState.Ready) runCatching { send(TdApi.LogOut()) }
    }

    /** Signs this phone out of Telegram (the session is ended on Telegram's side too). */
    suspend fun signOut() {
        if (client != null && _state.value is TgState.Ready) send(TdApi.LogOut())
    }

    companion object {
        /** How much Telegram fetches ahead of the reader in one request. */
        const val AHEAD = 16L shl 20
        /** When less than this is ready ahead, the next window is asked for. */
        const val LOW_WATER = 4L shl 20
        const val POLL_MS = 40L
        const val STALL_NS = 4_000_000_000L
        const val TIMEOUT_NS = 90_000_000_000L

        fun friendly(message: String): String = when {
            message.contains("PHONE_NUMBER_INVALID") -> "That phone number isn't valid. Use the international format, like +91 98765 43210."
            message.contains("PHONE_CODE_INVALID") -> "That code isn't right. Check the code Telegram sent and try again."
            message.contains("PHONE_CODE_EXPIRED") -> "That code has expired. Ask for a new one."
            message.contains("PASSWORD_HASH_INVALID") -> "That two-step verification password isn't right."
            message.contains("PHONE_NUMBER_BANNED") -> "Telegram has blocked this phone number."
            message.startsWith("Too Many Requests") || message.contains("FLOOD_WAIT") -> "Telegram asks to wait before trying again."
            else -> message
        }
    }
}
