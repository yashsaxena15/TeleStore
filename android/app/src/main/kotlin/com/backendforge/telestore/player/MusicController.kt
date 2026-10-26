package com.backendforge.telestore.player

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.PlayQueue
import com.backendforge.telestore.core.TeleStoreApi
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class QueueEntry(val title: String, val subtitle: String)

data class MusicState(
    val hasMedia: Boolean = false,
    val title: String = "",
    val artist: String = "",
    val artworkUri: Uri? = null,
    val isPlaying: Boolean = false,
    val buffering: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val queue: List<QueueEntry> = emptyList(),
    val index: Int = 0,
    val shuffle: Boolean = false,
    val repeatMode: Int = Player.REPEAT_MODE_OFF,
    val error: String? = null,
)

/**
 * The app's handle on [PlaybackService]: starts it, sends it the queue and mirrors what it plays
 * as [state] for the mini player and the Now Playing screen. All calls are on the main thread.
 */
class MusicController(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var future: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var ticker: Job? = null

    private val _state = MutableStateFlow(MusicState())
    val state: StateFlow<MusicState> = _state.asStateFlow()

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = publish()
        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
            _state.value = _state.value.copy(error = "Couldn't play this song (${error.errorCodeName}).")
        }
    }

    private fun withController(action: (MediaController) -> Unit) {
        controller?.let { return action(it) }
        val pending = future ?: MediaController.Builder(
            context,
            SessionToken(context, ComponentName(context, PlaybackService::class.java)),
        ).buildAsync().also { future = it }
        pending.addListener({
            val ready = runCatching { pending.get() }.getOrNull()
            if (ready == null) {
                future = null
                _state.value = _state.value.copy(error = "The music player couldn't start.")
                return@addListener
            }
            if (controller == null) {
                controller = ready
                ready.addListener(listener)
            }
            action(ready)
            publish()
        }, ContextCompat.getMainExecutor(context))
    }

    /** Plays [items] (songs of one folder) starting at [index]. */
    fun play(api: TeleStoreApi, items: List<FileItem>, index: Int, localCopy: (FileItem) -> Uri? = { null }) {
        val mediaItems = items.map { item ->
            val uri = localCopy(item) ?: Uri.parse(api.media.file(item).toString())
            val folder = item.path.trimEnd('/').substringAfterLast('/').ifEmpty { "TeleStore" }
            MediaItem.Builder()
                .setMediaId(item.id)
                .setUri(uri)
                .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(PlayQueue.title(item))
                        .setArtist(folder)
                        .setArtworkUri(api.media.thumbnail(item)?.let { Uri.parse(it.toString()) })
                        .build(),
                )
                .build()
        }
        _state.value = _state.value.copy(error = null)
        withController { c ->
            c.setMediaItems(mediaItems, index.coerceIn(0, (mediaItems.size - 1).coerceAtLeast(0)), 0L)
            c.prepare()
            c.play()
        }
    }

    fun togglePlay() = withController { if (it.isPlaying) it.pause() else it.play() }
    fun next() = withController { it.seekToNextMediaItem() }
    fun previous() = withController { it.seekToPrevious() }
    fun seekTo(ms: Long) = withController { it.seekTo(ms) }
    fun skipTo(index: Int) = withController { it.seekTo(index, 0L) }
    fun toggleShuffle() = withController { it.shuffleModeEnabled = !it.shuffleModeEnabled }
    fun cycleRepeat() = withController {
        it.repeatMode = when (it.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }

    /** Stops and clears the queue (sign-out, or the user closes the mini player). */
    fun stop() {
        controller?.run {
            stop()
            clearMediaItems()
        }
        _state.value = MusicState()
    }

    private fun publish() {
        val c = controller ?: return
        val meta = c.mediaMetadata
        val queue = (0 until c.mediaItemCount).map { i ->
            val m = c.getMediaItemAt(i).mediaMetadata
            QueueEntry(m.title?.toString().orEmpty(), m.artist?.toString().orEmpty())
        }
        _state.value = _state.value.copy(
            hasMedia = c.mediaItemCount > 0,
            title = meta.title?.toString().orEmpty(),
            artist = meta.artist?.toString().orEmpty(),
            artworkUri = meta.artworkUri,
            isPlaying = c.isPlaying,
            buffering = c.playbackState == Player.STATE_BUFFERING,
            positionMs = c.currentPosition.coerceAtLeast(0),
            durationMs = c.duration.takeIf { it > 0 } ?: 0,
            queue = queue,
            index = c.currentMediaItemIndex,
            shuffle = c.shuffleModeEnabled,
            repeatMode = c.repeatMode,
        )
        // Keep the progress bar moving only while something plays
        if (c.isPlaying && ticker?.isActive != true) {
            ticker = scope.launch {
                while (isActive) {
                    delay(500)
                    val now = controller ?: break
                    _state.value = _state.value.copy(positionMs = now.currentPosition.coerceAtLeast(0))
                    if (!now.isPlaying) break
                }
            }
        }
    }
}
