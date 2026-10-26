package com.backendforge.telestore.player

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionToken
import com.backendforge.telestore.MainActivity
import kotlinx.coroutines.Job
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.MediaInfo
import com.backendforge.telestore.core.PlayQueue
import com.backendforge.telestore.core.PlaybackPlan
import com.backendforge.telestore.core.Quality
import com.backendforge.telestore.core.VideoSource
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale

/** How the picture fills the screen. */
enum class Zoom(val label: String) { FIT("Fit"), CROP("Crop"), STRETCH("Stretch") }

/** Extra loudness on top of the phone's maximum volume (LoudnessEnhancer gain, in millibels). */
val BOOST_LEVELS = listOf(0 to "Off", 400 to "+25%", 800 to "+50%", 1200 to "+100%")

/** One choice in the audio or subtitle list; [index] is the track's position, -1 = subtitles off. */
data class TrackChoice(val index: Int, val label: String, val selected: Boolean)

data class VideoState(
    val queue: List<FileItem> = emptyList(),
    val index: Int = 0,
    val isPlaying: Boolean = false,
    val buffering: Boolean = true,
    val ended: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val quality: Quality = Quality.ORIGINAL,
    val qualities: List<Quality> = Quality.entries.toList(),
    val converted: Boolean = false,
    /** Why the server converts this video, shown under the player. */
    val note: String? = null,
    val audio: List<TrackChoice> = emptyList(),
    val subtitles: List<TrackChoice> = emptyList(),
    val speed: Float = 1f,
    val videoWidth: Int = 0,
    val videoHeight: Int = 0,
    val error: String? = null,
    val backgroundPlay: Boolean = true,
    val loop: Boolean = false,
    /** "30 min", "End of video", or null when no sleep timer is set. */
    val sleepLabel: String? = null,
    val zoom: Zoom = Zoom.FIT,
    val boost: Int = 0,
    /** Play the next video in the folder when this one ends. */
    val autoplay: Boolean = true,
) {
    val item: FileItem? get() = queue.getOrNull(index)
    val title: String get() = item?.let { PlayQueue.title(it) }.orEmpty()
    val hasNext: Boolean get() = index < queue.lastIndex
    val hasPrevious: Boolean get() = index > 0
    val isWide: Boolean get() = videoWidth == 0 || videoWidth >= videoHeight
}

/**
 * Plays the folder's videos. The file itself plays directly (ExoPlayer handles MKV, MP4 and WebM
 * with seeking, every audio track and embedded subtitles). Only when the phone can't decode the
 * picture or the sound, or the user picks a smaller quality, does it switch to the server's
 * converted stream ([PlaybackPlan]).
 */
@androidx.annotation.OptIn(UnstableApi::class)
class VideoViewModel(private val container: AppContainer) : ViewModel() {
    private val api get() = container.api()

    val player: ExoPlayer = ExoPlayer.Builder(container.context)
        // Reads downloaded copies (content://) as well as the server (through the app's own client)
        .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(container.context, OkHttpDataSource.Factory(container.api().http))))
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            /* handleAudioFocus = */ true, // pauses the music player while a video plays
        )
        .setHandleAudioBecomingNoisy(true)
        .build()

    private val _state = MutableStateFlow(VideoState(queue = container.playback.videos, index = container.playback.videoIndex))
    val state: StateFlow<VideoState> = _state.asStateFlow()

    private var source: VideoSource? = null
    private var info: MediaInfo? = null
    /** The server's audio track while converted (the index among the file's audio streams). */
    private var serverAudioTrack = 0
    /** The phone can't decode this file itself: stay on the server's stream. */
    private var mustConvert = false

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            _state.update {
                it.copy(
                    isPlaying = player.isPlaying,
                    buffering = player.playbackState == Player.STATE_BUFFERING,
                    ended = player.playbackState == Player.STATE_ENDED,
                )
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState != Player.STATE_ENDED) return
            if (sleepAtEnd) {
                sleepAtEnd = false
                _state.update { it.copy(sleepLabel = null) }
                return
            }
            if (_state.value.hasNext && _state.value.autoplay) next()
        }

        override fun onAudioSessionIdChanged(audioSessionId: Int) = applyBoost()

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width == 0 || videoSize.height == 0) return
            val width = (videoSize.width * videoSize.pixelWidthHeightRatio).toInt()
            _state.update { it.copy(videoWidth = width, videoHeight = videoSize.height) }
        }

        override fun onTracksChanged(tracks: Tracks) {
            if (source?.converted == true) return
            val video = tracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }
            val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
            val videoUnsupported = video.isNotEmpty() && video.none { it.isSupported }
            val audioUnsupported = audio.isNotEmpty() && audio.none { it.isSupported }
            if (videoUnsupported || audioUnsupported) {
                convertInstead(
                    reencode = videoUnsupported,
                    note = if (videoUnsupported) "This phone can't play this video's picture, so the server converts it." else
                        "This phone can't play this video's sound, so the server converts the sound.",
                )
                return
            }
            publishTracks(tracks)
        }

        override fun onPlayerError(error: PlaybackException) {
            if (source?.converted != true && error.errorCode in FORMAT_ERRORS) {
                convertInstead(reencode = true, note = "This phone can't play this file, so the server converts it.")
            } else {
                _state.update { it.copy(error = "Couldn't play this video (${error.errorCodeName}).", buffering = false) }
            }
        }
    }

    /** Hosts this player's session in [VideoSessionService] so its sound can go on in the background. */
    private val session: MediaSession = MediaSession.Builder(container.context, player)
        .setId("video")
        .setSessionActivity(
            PendingIntent.getActivity(
                container.context, 2,
                Intent(container.context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
        )
        .build()
    private val serviceConnection = MediaController.Builder(
        container.context, SessionToken(container.context, ComponentName(container.context, VideoSessionService::class.java)),
    ).also { VideoSessions.current = session }.buildAsync()

    private var enhancer: LoudnessEnhancer? = null
    private var sleepJob: Job? = null
    private var sleepAtEnd = false
    private var inBackground = false

    init {
        player.addListener(listener)
        _state.update { it.copy(backgroundPlay = container.settings.videoBackgroundPlay) }
        if (_state.value.item != null) open(_state.value.index)
        viewModelScope.launch {
            while (isActive) {
                delay(500)
                tick()
            }
        }
    }

    // ── Opening ────────────────────────────────────────────────────────────────
    /** Another video was picked while this player is open (full screen or minimized). */
    fun start(queue: List<FileItem>, index: Int) {
        if (index !in queue.indices) return
        saveProgress()
        _state.update { it.copy(queue = queue) }
        open(index)
    }

    fun playAt(index: Int) {
        if (index !in _state.value.queue.indices) return
        saveProgress()
        open(index)
    }

    fun next() = playAt(_state.value.index + 1)
    fun previous() = if (shownPosition() > 3_000) seekTo(0) else playAt(_state.value.index - 1)

    private fun open(index: Int) {
        info = null
        serverAudioTrack = 0
        mustConvert = false
        _state.update {
            it.copy(
                index = index, quality = Quality.ORIGINAL, qualities = Quality.entries.toList(), converted = false,
                note = null, error = null, audio = emptyList(), subtitles = emptyList(), positionMs = 0, durationMs = 0,
                videoWidth = 0, videoHeight = 0, ended = false,
            )
        }
        load(container.watchHistory.resumeAt(_state.value.item?.id.orEmpty()))
        // The video's height trims the quality list; not needed to start playing
        val item = _state.value.item ?: return
        viewModelScope.launch {
            val probed = fetchInfo(item) ?: return@launch
            if (_state.value.item?.id != item.id) return@launch
            _state.update { it.copy(qualities = Quality.choicesFor(probed.height)) }
            if (source?.converted == true) publishServerTracks()
        }
    }

    private fun load(startMs: Long) {
        val item = _state.value.item ?: return
        val next = PlaybackPlan.source(api.media, item, _state.value.quality, mustConvert, serverAudioTrack, startMs)
        source = next
        // A downloaded copy on the phone plays without the internet
        val local = if (next.converted) null else container.transfers.store.offlineCopy(container.context, item.id)
        val mediaItem = MediaItem.Builder()
            .setMediaId(item.id)
            .setUri(local?.toString() ?: next.url.toString())
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(PlayQueue.title(item))
                    .setArtist(item.path.trimEnd('/').substringAfterLast('/').ifEmpty { "TeleStore" })
                    .setArtworkUri(api.media.thumbnail(item)?.let { Uri.parse(it.toString()) })
                    .build(),
            )
            .build()
        player.setMediaItem(mediaItem, if (next.converted) 0L else startMs)
        player.prepare()
        player.playWhenReady = true
        _state.update { it.copy(converted = next.converted, error = null, ended = false) }
        if (next.converted) publishServerTracks()
    }

    private fun convertInstead(reencode: Boolean, note: String) {
        if (mustConvert) return
        mustConvert = true
        val item = _state.value.item ?: return
        val at = shownPosition()
        viewModelScope.launch {
            // Also makes the server store the codec, which its conversion needs
            val probed = fetchInfo(item)
            if (_state.value.item?.id != item.id) return@launch
            val quality = if (reencode) Quality.fallbackFor(probed?.height) else Quality.ORIGINAL
            _state.update { it.copy(quality = quality, note = note) }
            load(at)
        }
    }

    private suspend fun fetchInfo(item: FileItem): MediaInfo? {
        info?.let { return it }
        return try {
            api.mediaInfo(item).also { info = it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    // ── Controls ───────────────────────────────────────────────────────────────
    fun togglePlay() {
        when {
            _state.value.ended -> seekTo(0)
            player.isPlaying -> player.pause()
            else -> player.play()
        }
    }

    fun pause() {
        player.pause()
        saveProgress()
    }

    fun seekTo(ms: Long) {
        val target = ms.coerceIn(0, _state.value.durationMs.takeIf { it > 0 } ?: Long.MAX_VALUE)
        if (source?.converted == true) load(target) else player.seekTo(target)
        _state.update { it.copy(positionMs = target) }
        player.play()
    }

    fun seekBy(deltaMs: Long) = seekTo(shownPosition() + deltaMs)

    fun setSpeed(speed: Float) {
        player.setPlaybackSpeed(speed)
        _state.update { it.copy(speed = speed) }
    }

    fun setQuality(quality: Quality) {
        if (quality == _state.value.quality) return
        val at = shownPosition()
        _state.update { it.copy(quality = quality) }
        load(at)
    }

    fun selectAudio(index: Int) {
        val at = shownPosition()
        if (source?.converted == true) {
            serverAudioTrack = index
            load(at)
            return
        }
        val group = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.getOrNull(index) ?: return
        if (group.isSupported) {
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
                .build()
        } else {
            // This language's sound can't be decoded here: the server converts that track
            mustConvert = true
            serverAudioTrack = index
            _state.update { it.copy(note = "This phone can't play that sound track, so the server converts it.") }
            load(at)
        }
    }

    /** [index] -1 turns subtitles off. */
    fun selectSubtitle(index: Int) {
        val builder = player.trackSelectionParameters.buildUpon()
        if (index < 0) {
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            val group = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }.getOrNull(index) ?: return
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
        }
        player.trackSelectionParameters = builder.build()
    }

    // ── Player options ─────────────────────────────────────────────────────────
    fun setBackgroundPlay(on: Boolean) {
        container.settings.videoBackgroundPlay = on
        _state.update { it.copy(backgroundPlay = on) }
    }

    fun setLoop(on: Boolean) {
        player.repeatMode = if (on) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        _state.update { it.copy(loop = on) }
    }

    fun setZoom(zoom: Zoom) = _state.update { it.copy(zoom = zoom) }

    fun setAutoplay(on: Boolean) = _state.update { it.copy(autoplay = on) }

    /** Star or unstar the video playing now. */
    fun toggleStar() {
        val item = _state.value.item ?: return
        viewModelScope.launch {
            try {
                val starred = api.setStarred(item, !item.starred)
                _state.update { s -> s.copy(queue = s.queue.map { if (it.id == item.id) it.copy(starred = starred) else it }) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(error = (e as? com.backendforge.telestore.core.ApiException)?.message ?: "Couldn't update the star.") }
            }
        }
    }

    fun setBoost(millibels: Int) {
        _state.update { it.copy(boost = millibels) }
        applyBoost()
    }

    private fun applyBoost() {
        val gain = _state.value.boost
        runCatching {
            if (gain <= 0) {
                enhancer?.setEnabled(false)
            } else {
                val id = player.audioSessionId
                if (enhancer == null && id != C.AUDIO_SESSION_ID_UNSET) enhancer = LoudnessEnhancer(id)
                enhancer?.setTargetGain(gain)
                enhancer?.setEnabled(true)
            }
        }
    }

    /** [minutes] 0 cancels, -1 means "at the end of this video". */
    fun setSleepTimer(minutes: Int) {
        sleepJob?.cancel()
        sleepAtEnd = minutes == -1
        _state.update { it.copy(sleepLabel = if (minutes > 0) "$minutes min" else if (minutes == -1) "End of video" else null) }
        if (minutes > 0) {
            sleepJob = viewModelScope.launch {
                delay(minutes * 60_000L)
                player.pause()
                _state.update { it.copy(sleepLabel = null) }
            }
        }
        if (sleepAtEnd) setLoop(false)
    }

    /** CC button: subtitles on (the first track) or off. */
    fun toggleCaptions() {
        val subs = _state.value.subtitles
        if (subs.isEmpty()) return
        val on = subs.any { it.selected && it.index >= 0 }
        selectSubtitle(if (on) -1 else subs.first { it.index >= 0 }.index)
    }

    /** The app went to the background: keep the sound (no picture) or pause, per the setting. */
    fun onAppHidden() {
        if (_state.value.backgroundPlay && player.isPlaying) {
            inBackground = true
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true).build()
        } else {
            pause()
        }
    }

    fun onAppShown() {
        if (!inBackground) return
        inBackground = false
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, false).build()
    }

    // ── State ──────────────────────────────────────────────────────────────────
    private fun shownPosition(): Long = PlaybackPlan.shownPosition(source, player.currentPosition)

    private var ticks = 0

    private fun tick() {
        val duration = if (source?.converted == true) info?.durationMs ?: 0 else player.duration.takeIf { it > 0 } ?: 0
        _state.update { it.copy(positionMs = shownPosition(), durationMs = duration) }
        if (player.isPlaying && ++ticks % 10 == 0) saveProgress()
    }

    /** Saves where this video is, for Continue watching. */
    private fun saveProgress() {
        val s = _state.value
        val item = s.item ?: return
        if (s.durationMs > 0) container.watchHistory.save(item, s.positionMs, s.durationMs)
    }

    private fun publishTracks(tracks: Tracks) {
        val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.mapIndexed { i, g ->
            val label = trackLabel(g.getTrackFormat(0).label, g.getTrackFormat(0).language, "Track ${i + 1}")
            TrackChoice(i, if (g.isSupported) label else "$label (converted)", g.isSelected)
        }
        val text = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        val subtitles = if (text.isEmpty()) emptyList() else
            listOf(TrackChoice(-1, "Off", text.none { it.isSelected })) + text.mapIndexed { i, g ->
                TrackChoice(i, trackLabel(g.getTrackFormat(0).label, g.getTrackFormat(0).language, "Subtitles ${i + 1}"), g.isSelected)
            }
        _state.update { it.copy(audio = audio, subtitles = subtitles) }
    }

    /** While converted, the server picks the sound; subtitles come only from the file itself. */
    private fun publishServerTracks() {
        val tracks = info?.audioTracks.orEmpty()
        _state.update {
            it.copy(
                audio = tracks.map { t -> TrackChoice(t.index, t.label, t.index == serverAudioTrack) },
                subtitles = emptyList(),
            )
        }
    }

    private fun trackLabel(label: String?, language: String?, fallback: String): String =
        label?.takeIf { it.isNotBlank() }
            ?: language?.takeIf { it.isNotBlank() && it != C.LANGUAGE_UNDETERMINED }?.let { Locale.forLanguageTag(it).displayLanguage.ifBlank { it } }
            ?: fallback

    override fun onCleared() {
        saveProgress()
        sleepJob?.cancel()
        runCatching { enhancer?.release() }
        if (VideoSessions.current === session) VideoSessions.current = null
        MediaController.releaseFuture(serviceConnection)
        session.release()
        player.removeListener(listener)
        player.release()
    }

    private companion object {
        val FORMAT_ERRORS = setOf(
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        )
    }
}
