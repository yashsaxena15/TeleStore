package com.backendforge.telestore.data

import android.content.Context
import coil3.ImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.backendforge.telestore.core.ServerAddress
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.backup.BackupStore
import com.backendforge.telestore.core.LyricsFinder
import com.backendforge.telestore.core.UpdateChecker
import com.backendforge.telestore.player.MusicController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import com.backendforge.telestore.transfers.PickedFile
import com.backendforge.telestore.transfers.TransferManager
import okhttp3.HttpUrl

/** The app's shared objects, made once in [com.backendforge.telestore.TeleStoreApplication]. */
class AppContainer(val context: Context) {
    val session = SessionStore(context.applicationContext)
    val playback = PlaybackQueue()
    val settings = AppSettings(context.applicationContext)
    val appLock = com.backendforge.telestore.security.AppLock(settings)
    val watchHistory = WatchHistory(context.applicationContext)
    /** Looks for new APKs on GitHub, with its own client: the sign-in token must never go there. */
    val updates = UpdateChecker(TeleStoreApi.defaultClient())

    /** Lyrics for the song playing; LRCLIB gets its own client too (no token). */
    private val webClient = TeleStoreApi.defaultClient()
    fun lyrics(): LyricsFinder = LyricsFinder(api(), webClient)
    val transfers = TransferManager(context.applicationContext)
    val backup = BackupStore(context.applicationContext)

    /** Files shared into TeleStore from other apps, waiting for the user to pick a folder. */
    val pendingShare = MutableStateFlow<List<PickedFile>>(emptyList())

    /** A link shared into TeleStore (e.g. from YouTube's Share button), opened in "Add from link". */
    val pendingLink = MutableStateFlow<String?>(null)

    /** A home-screen widget button that opened the app: "upload", "link", "photos" or "search". */
    val pendingAction = MutableStateFlow<String?>(null)

    /** Files fetched to show in a viewer, share or open in another app. */
    val files: FileCache by lazy { FileCache(context.applicationContext, { api() }) { transfers.store.offlineCopy(context, it) } }

    /** Background music; made on first use so the service only starts when a song plays. */
    val music: MusicController by lazy { MusicController(context.applicationContext) }
    private var musicStarted = false
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    init {
        // Signing out stops the music (its stream needs the token that just ended)
        scope.launch {
            session.state.collect {
                if (it == null && musicStarted) music.stop()
                if (it == null) {
                    // Nothing about the account stays on the phone: the widget's storage line, cached files
                    if (settings.lastStorageLine != null) {
                        settings.lastStorageLine = null
                        com.backendforge.telestore.widget.QuickWidget.refresh(context)
                    }
                    files.clear()
                }
            }
        }
    }

    /** Locks the Private Vault on the server (the app was left); never throws. */
    fun lockVaultInBackground() {
        files.forgetVault()
        scope.launch { runCatching { api().vaultLock() } }
    }

    /** The music controller, marking that it exists (see the sign-out rule above). */
    fun startMusic(): MusicController = music.also { musicStarted = true }

    private var cached: TeleStoreApi? = null

    val imageLoader: ImageLoader by lazy {
        ImageLoader.Builder(context)
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = { api().http }))
            }
            .build()
    }

    /** The API for the signed-in server; a 401 anywhere signs the app out. */
    fun api(): TeleStoreApi {
        val server = session.state.value?.server ?: session.lastServer
        val base = ServerAddress.normalize(server) ?: ServerAddress.normalize(ServerAddress.DEFAULT)!!
        cached?.takeIf { it.baseUrl == base }?.let { return it }
        return apiFor(base).also { cached = it }
    }

    /** An API for a server typed on the sign-in screen (before anyone is signed in). */
    fun apiFor(base: HttpUrl): TeleStoreApi =
        TeleStoreApi(base, token = { session.state.value?.token }, onUnauthorized = { session.signedOut() })
}

