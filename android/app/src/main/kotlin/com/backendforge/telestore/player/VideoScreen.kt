package com.backendforge.telestore.player

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.media.AudioManager
import android.provider.Settings
import android.util.Rational
import android.view.ViewGroup
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Brightness6
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionOff
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.backendforge.telestore.ui.components.PullDownState
import com.backendforge.telestore.ui.components.pullDownOffset
import com.backendforge.telestore.ui.components.pullDownToClose
import com.backendforge.telestore.ui.components.rememberHaptics
import com.backendforge.telestore.ui.components.rememberPullDownState
import com.backendforge.telestore.MainActivity
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.Quality
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.ui.components.FileInfoSheet
import com.backendforge.telestore.ui.components.FileThumbnail
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.Locale

private val SPEEDS = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
private val SLEEP_CHOICES = listOf(0 to "Off", 15 to "15 minutes", 30 to "30 minutes", 45 to "45 minutes", 60 to "1 hour", -1 to "End of video")

/** What a swipe or double-tap is doing, shown over the picture while it happens. */
private sealed interface GestureHint {
    data class Brightness(val level: Float) : GestureHint
    data class Volume(val level: Float) : GestureHint
    data class Skip(val forward: Boolean) : GestureHint
}

/** The settings sheet's pages (YouTube's ⚙ menu). */
private enum class SheetPage { MAIN, QUALITY, CAPTIONS, AUDIO, SPEED, SLEEP, MORE }

@androidx.annotation.OptIn(UnstableApi::class)
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideoScreen(vm: VideoViewModel, api: TeleStoreApi, onBack: () -> Unit, onDownload: (FileItem) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = context.findActivity() as? MainActivity
    val pipFlow = remember(activity) { activity?.inPictureInPicture ?: MutableStateFlow(false) }
    val inPip by pipFlow.collectAsStateWithLifecycle()
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    var fullscreen by rememberSaveable { mutableStateOf(false) }
    val immersive = fullscreen || landscape || inPip
    var controlsVisible by remember { mutableStateOf(true) }
    var touchTick by remember { mutableIntStateOf(0) }
    var hint by remember { mutableStateOf<GestureHint?>(null) }
    var locked by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<SheetPage?>(null) }
    var info by remember { mutableStateOf<FileItem?>(null) }
    val haptics = rememberHaptics()
    // Pulling the video down shrinks it to the mini player (portrait only; full screen keeps brightness and volume)
    val pull = rememberPullDownState(onBack)

    if (state.item == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }

    // Controls fade 3 s after the last touch while the video plays
    LaunchedEffect(controlsVisible, state.isPlaying, touchTick, sheet) {
        if (controlsVisible && state.isPlaying && sheet == null) {
            delay(3_000)
            controlsVisible = false
        }
    }
    LaunchedEffect(hint) {
        if (hint != null) {
            delay(800)
            hint = null
        }
    }

    // Fullscreen turns a wide video sideways; leaving it goes back to portrait
    LaunchedEffect(fullscreen, state.isWide) {
        val a = activity ?: return@LaunchedEffect
        if (fullscreen) {
            a.requestedOrientation = if (state.isWide) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        } else if (a.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE) {
            a.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
        }
    }
    LaunchedEffect(immersive) {
        val window = activity?.window ?: return@LaunchedEffect
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (immersive) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    // Picture-in-picture when leaving the app while it plays (Android 12+ by itself)
    val ratio = if (state.videoWidth > 0 && state.videoHeight > 0) Rational(state.videoWidth, state.videoHeight) else Rational(16, 9)
    val currentRatio by rememberUpdatedState(ratio)
    val playing by rememberUpdatedState(state.isPlaying)
    LaunchedEffect(ratio, state.isPlaying) { activity?.updatePictureInPicture(ratio, state.isPlaying) }

    // Leaving the app (Play in background or pause) is handled by MainScreen, as the video may be minimized
    DisposableEffect(activity) {
        activity?.pictureInPictureRatio = { if (playing) currentRatio else null }
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            activity?.pictureInPictureRatio = null
            activity?.updatePictureInPicture(null, playing = false)
            activity?.window?.let { window ->
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                window.attributes = window.attributes.apply { screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
                WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
            }
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    BackHandler(enabled = fullscreen || locked) {
        if (locked) locked = false else fullscreen = false
    }

    fun toggleFullscreen() {
        if (fullscreen || landscape) {
            fullscreen = false
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
        } else {
            fullscreen = true
        }
    }

    val video: @Composable (Modifier) -> Unit = { modifier ->
        Box(modifier.background(Color.Black)) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        useController = false
                        setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        player = vm.player
                    }
                },
                onRelease = { it.player = null },
                update = {
                    it.player = vm.player
                    it.resizeMode = when (state.zoom) {
                        Zoom.FIT -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                        Zoom.CROP -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        Zoom.STRETCH -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            if (!inPip) {
                GestureLayer(
                    enabled = !locked,
                    pull = if (immersive) null else pull,
                    onTap = { controlsVisible = !controlsVisible; touchTick++ },
                    onDoubleTap = { forward ->
                        haptics.tick()
                        vm.seekBy(if (forward) 10_000 else -10_000)
                        hint = GestureHint.Skip(forward)
                    },
                    onHint = { hint = it },
                )
            }
            if (state.buffering && !state.ended) {
                CircularProgressIndicator(Modifier.align(Alignment.Center).size(48.dp), color = Color.White, strokeWidth = 3.dp)
            }
            hint?.let { GestureOverlay(it) }

            if (!inPip) {
                if (locked) {
                    AnimatedVisibility(visible = controlsVisible, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.CenterStart)) {
                        IconButton(
                            onClick = { haptics.click(); locked = false; touchTick++ },
                            modifier = Modifier.padding(24.dp).size(52.dp).background(Color(0x99000000), CircleShape),
                        ) { Icon(Icons.Filled.LockOpen, contentDescription = "Unlock", tint = Color.White) }
                    }
                } else {
                    AnimatedVisibility(visible = controlsVisible, enter = fadeIn(), exit = fadeOut()) {
                        if (immersive) {
                            FullscreenControls(
                                state = state,
                                onBack = { if (fullscreen) toggleFullscreen() else onBack() },
                                onTogglePlay = { haptics.click(); vm.togglePlay(); touchTick++ },
                                onSeek = { vm.seekTo(it); touchTick++ },
                                onScrub = { touchTick++ },
                                onPrevious = { vm.previous(); touchTick++ },
                                onNext = { vm.next(); touchTick++ },
                                onSheet = { sheet = it },
                                onLock = { haptics.click(); locked = true; controlsVisible = true; touchTick++ },
                                onZoom = { vm.setZoom(Zoom.entries[(state.zoom.ordinal + 1) % Zoom.entries.size]); touchTick++ },
                                onRotate = {
                                    activity?.requestedOrientation = if (LocalOrientation.isLandscape(activity)) {
                                        ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                                    } else {
                                        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                    }
                                    touchTick++
                                },
                                onPictureInPicture = { activity?.enterPictureInPicture() },
                                onExitFullscreen = { toggleFullscreen() },
                            )
                        } else {
                            PortraitControls(
                                state = state,
                                onMinimize = onBack,
                                onTogglePlay = { haptics.click(); vm.togglePlay(); touchTick++ },
                                onPrevious = { vm.previous(); touchTick++ },
                                onNext = { vm.next(); touchTick++ },
                                onBackgroundPlay = { vm.setBackgroundPlay(!state.backgroundPlay); touchTick++ },
                                onCaptions = { vm.toggleCaptions(); touchTick++ },
                                onSettings = { sheet = SheetPage.MAIN },
                                onFullscreen = { toggleFullscreen() },
                            )
                        }
                    }
                }
                if (!immersive) {
                    ThinProgress(state, controlsVisible && !locked, onSeek = { vm.seekTo(it); touchTick++ }, onScrub = { touchTick++ }, modifier = Modifier.align(Alignment.BottomCenter))
                }
            }
        }
    }

    if (immersive) {
        video(Modifier.fillMaxSize())
    } else {
        Column(Modifier.fillMaxSize().pullDownOffset(pull).background(MaterialTheme.colorScheme.background)) {
            Spacer(Modifier.fillMaxWidth().background(Color.Black).statusBarsPadding())
            val boxRatio = ratio.toFloat().coerceIn(1f, 2.4f)
            video(Modifier.fillMaxWidth().aspectRatio(boxRatio))
            Details(
                state = state,
                api = api,
                onPlay = vm::playAt,
                onStar = vm::toggleStar,
                onDownload = { state.item?.let(onDownload) },
                onInfo = { info = state.item },
                onAutoplay = vm::setAutoplay,
            )
        }
    }

    sheet?.let { page ->
        ModalBottomSheet(onDismissRequest = { sheet = null }, containerColor = MaterialTheme.colorScheme.surfaceContainerHigh) {
            SettingsSheet(page, state, vm, onPage = { sheet = it }, onClose = { sheet = null })
        }
    }
    info?.let { FileInfoSheet(item = it, api = api, onDismiss = { info = null }) }
}

/** Is the window wider than tall right now. */
private object LocalOrientation {
    fun isLandscape(activity: Activity) = activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
}

// ── Gestures (VLC-style) ───────────────────────────────────────────────────────

/** Tap: show/hide controls. Double-tap a side: skip 10 s. Swipe up/down: brightness (left), volume (right). */
@Composable
private fun GestureLayer(
    enabled: Boolean,
    /** Set in portrait: a vertical swipe pulls the video down to minimize it instead. */
    pull: PullDownState?,
    onTap: () -> Unit,
    onDoubleTap: (forward: Boolean) -> Unit,
    onHint: (GestureHint) -> Unit,
) {
    val context = LocalContext.current
    val activity = context.findActivity()
    val audio = remember { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    val tap by rememberUpdatedState(onTap)
    val doubleTap by rememberUpdatedState(onDoubleTap)
    val showHint by rememberUpdatedState(onHint)
    val active by rememberUpdatedState(enabled)
    var leftSide by remember { mutableStateOf(true) }
    var level by remember { mutableFloatStateOf(0f) }

    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { tap() },
                    onDoubleTap = { if (active) doubleTap(it.x > size.width / 2) else tap() },
                )
            }
            .then(if (pull != null) Modifier.pullDownToClose(pull, enabled) else Modifier.pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { start ->
                        leftSide = start.x < size.width / 2
                        level = if (leftSide) currentBrightness(activity) else
                            audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    },
                    onVerticalDrag = { change, dragAmount ->
                        if (!active) return@detectVerticalDragGestures
                        change.consume()
                        level = (level - dragAmount / (size.height * 0.8f)).coerceIn(0f, 1f)
                        if (leftSide) {
                            activity?.window?.let { w -> w.attributes = w.attributes.apply { screenBrightness = level.coerceAtLeast(0.01f) } }
                            showHint(GestureHint.Brightness(level))
                        } else {
                            val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                            audio.setStreamVolume(AudioManager.STREAM_MUSIC, (level * max).toInt(), 0)
                            showHint(GestureHint.Volume(level))
                        }
                    },
                )
            }),
    )
}

private fun currentBrightness(activity: Activity?): Float {
    val own = activity?.window?.attributes?.screenBrightness ?: -1f
    if (own >= 0f) return own
    val system = activity?.let { runCatching { Settings.System.getInt(it.contentResolver, Settings.System.SCREEN_BRIGHTNESS) }.getOrNull() } ?: 128
    return system / 255f
}

/** The vertical level bar (brightness left, volume right) or the "« 10 s" ripple. */
@Composable
private fun GestureOverlay(hint: GestureHint) {
    Box(Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 24.dp)) {
        when (hint) {
            is GestureHint.Brightness -> LevelBar(Icons.Filled.Brightness6, hint.level, "${(hint.level * 100).toInt()}", Modifier.align(Alignment.CenterStart))
            is GestureHint.Volume -> LevelBar(Icons.Filled.VolumeUp, hint.level, "${(hint.level * 100).toInt()}", Modifier.align(Alignment.CenterEnd))
            is GestureHint.Skip -> Box(
                Modifier
                    .align(if (hint.forward) Alignment.CenterEnd else Alignment.CenterStart)
                    .size(width = 130.dp, height = 110.dp)
                    .background(Color(0x22FFFFFF), RoundedCornerShape(60.dp)),
                contentAlignment = Alignment.Center,
            ) { Text(if (hint.forward) "10 s »" else "« 10 s", color = Color.White, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun LevelBar(icon: ImageVector, level: Float, label: String, modifier: Modifier) {
    Column(
        modifier.width(44.dp).height(170.dp).background(Color(0x80000000), RoundedCornerShape(22.dp)).padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f).width(6.dp).clip(RoundedCornerShape(3.dp)).background(Color(0x40FFFFFF)), contentAlignment = Alignment.BottomCenter) {
            Box(Modifier.fillMaxWidth().fillMaxHeight(level.coerceIn(0f, 1f)).background(Color.White))
        }
        Text(label, color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

// ── Controls ───────────────────────────────────────────────────────────────────

@Composable
private fun PortraitControls(
    state: VideoState,
    onMinimize: () -> Unit,
    onTogglePlay: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onBackgroundPlay: () -> Unit,
    onCaptions: () -> Unit,
    onSettings: () -> Unit,
    onFullscreen: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Color(0x61000000))) {
        Row(Modifier.align(Alignment.TopStart).fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onMinimize) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Minimize", tint = Color.White) }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onBackgroundPlay) {
                Icon(
                    Icons.Filled.Headphones,
                    contentDescription = if (state.backgroundPlay) "Play in background: on" else "Play in background: off",
                    tint = if (state.backgroundPlay) MaterialTheme.colorScheme.primary else Color.White,
                )
            }
            CaptionsButton(state, onCaptions)
            IconButton(onClick = onSettings) { Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = Color.White) }
        }
        CenterButtons(state, onPrevious, onTogglePlay, onNext, Modifier.align(Alignment.Center))
        Row(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 12.dp, end = 4.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${formatTime(state.positionMs)} / ${if (state.durationMs > 0) formatTime(state.durationMs) else "--:--"}",
                color = Color.White, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onFullscreen) { Icon(Icons.Filled.Fullscreen, contentDescription = "Fullscreen", tint = Color.White) }
        }
    }
}

@Composable
private fun CaptionsButton(state: VideoState, onCaptions: () -> Unit) {
    val on = state.subtitles.any { it.selected && it.index >= 0 }
    IconButton(onClick = onCaptions, enabled = state.subtitles.isNotEmpty()) {
        Icon(
            if (on) Icons.Filled.ClosedCaption else Icons.Filled.ClosedCaptionOff,
            contentDescription = if (on) "Subtitles on" else "Subtitles off",
            tint = if (state.subtitles.isEmpty()) Color(0x66FFFFFF) else Color.White,
        )
    }
}

@Composable
private fun CenterButtons(state: VideoState, onPrevious: () -> Unit, onTogglePlay: () -> Unit, onNext: () -> Unit, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(40.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onPrevious, enabled = state.hasPrevious || state.positionMs > 3_000) {
            Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous", tint = Color.White, modifier = Modifier.size(30.dp))
        }
        IconButton(onClick = onTogglePlay, modifier = Modifier.size(64.dp).background(Color(0x73000000), CircleShape)) {
            val icon = when {
                state.ended -> Icons.Filled.Replay
                state.isPlaying -> Icons.Filled.Pause
                else -> Icons.Filled.PlayArrow
            }
            Icon(icon, contentDescription = if (state.isPlaying) "Pause" else "Play", tint = Color.White, modifier = Modifier.size(38.dp))
        }
        IconButton(onClick = onNext, enabled = state.hasNext) {
            Icon(Icons.Filled.SkipNext, contentDescription = "Next", tint = Color.White, modifier = Modifier.size(30.dp))
        }
    }
}

/** YouTube's thin line at the bottom of the portrait player; it grows a thumb while controls show. */
@Composable
private fun ThinProgress(state: VideoState, expanded: Boolean, onSeek: (Long) -> Unit, onScrub: () -> Unit, modifier: Modifier) {
    var scrubbing by remember { mutableStateOf<Float?>(null) }
    val duration = state.durationMs.coerceAtLeast(1)
    val value = scrubbing ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    if (expanded) {
        Slider(
            value = value,
            onValueChange = { scrubbing = it; onScrub() },
            onValueChangeFinished = { scrubbing?.let { onSeek((it * duration).toLong()) }; scrubbing = null },
            enabled = state.durationMs > 0,
            colors = SliderDefaults.colors(thumbColor = MaterialTheme.colorScheme.primary, activeTrackColor = MaterialTheme.colorScheme.primary, inactiveTrackColor = Color(0x4DFFFFFF)),
            modifier = modifier.fillMaxWidth().height(20.dp).padding(horizontal = 0.dp),
        )
    } else {
        Box(modifier.fillMaxWidth().height(3.dp).background(Color(0x4DFFFFFF))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(value).background(MaterialTheme.colorScheme.primary))
        }
    }
}

@Composable
private fun FullscreenControls(
    state: VideoState,
    onBack: () -> Unit,
    onTogglePlay: () -> Unit,
    onSeek: (Long) -> Unit,
    onScrub: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onSheet: (SheetPage) -> Unit,
    onLock: () -> Unit,
    onZoom: () -> Unit,
    onRotate: () -> Unit,
    onPictureInPicture: () -> Unit,
    onExitFullscreen: () -> Unit,
) {
    var scrubbing by remember { mutableStateOf<Float?>(null) }
    Box(Modifier.fillMaxSize().background(Color(0x6B000000))) {
        Row(
            Modifier.align(Alignment.TopStart).fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White) }
            Text(state.title, color = Color.White, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            state.audio.firstOrNull { it.selected }?.let { Pill(it.label) { onSheet(SheetPage.AUDIO) } }
            if (state.subtitles.isNotEmpty()) Pill("CC " + (state.subtitles.firstOrNull { it.selected && it.index >= 0 }?.label ?: "Off")) { onSheet(SheetPage.CAPTIONS) }
            Pill(if (state.speed == 1f) "1×" else "${state.speed}×") { onSheet(SheetPage.SPEED) }
            IconButton(onClick = { onSheet(SheetPage.MAIN) }) { Icon(Icons.Filled.MoreVert, contentDescription = "More settings", tint = Color.White) }
        }
        CenterButtons(state, onPrevious, onTogglePlay, onNext, Modifier.align(Alignment.Center))
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 6.dp)) {
            val duration = state.durationMs.coerceAtLeast(1)
            Slider(
                value = scrubbing ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f),
                onValueChange = { scrubbing = it; onScrub() },
                onValueChangeFinished = { scrubbing?.let { onSeek((it * duration).toLong()) }; scrubbing = null },
                enabled = state.durationMs > 0,
                colors = SliderDefaults.colors(thumbColor = MaterialTheme.colorScheme.primary, activeTrackColor = MaterialTheme.colorScheme.primary, inactiveTrackColor = Color(0x47FFFFFF)),
                modifier = Modifier.height(28.dp),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                val shown = scrubbing?.let { (it * duration).toLong() } ?: state.positionMs
                Text(
                    "${formatTime(shown)} / ${if (state.durationMs > 0) formatTime(state.durationMs) else "--:--"}",
                    color = Color.White, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onLock) { Icon(Icons.Filled.Lock, contentDescription = "Lock the screen", tint = Color.White) }
                TextButton(onClick = onZoom) { Text(state.zoom.label, color = Color.White) }
                IconButton(onClick = onRotate) { Icon(Icons.Filled.ScreenRotation, contentDescription = "Rotate", tint = Color.White) }
                IconButton(onClick = onPictureInPicture) { Icon(Icons.Filled.PictureInPictureAlt, contentDescription = "Picture in picture", tint = Color.White) }
                IconButton(onClick = onExitFullscreen) { Icon(Icons.Filled.FullscreenExit, contentDescription = "Exit fullscreen", tint = Color.White) }
            }
        }
    }
}

@Composable
private fun Pill(text: String, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(18.dp), color = Color(0x24FFFFFF)) {
        Text(text, color = Color.White, style = MaterialTheme.typography.labelLarge, maxLines = 1, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
    }
}

// ── Below the portrait player (YouTube-style) ─────────────────────────────────

@Composable
private fun Details(
    state: VideoState,
    api: TeleStoreApi,
    onPlay: (Int) -> Unit,
    onStar: () -> Unit,
    onDownload: () -> Unit,
    onInfo: () -> Unit,
    onAutoplay: (Boolean) -> Unit,
) {
    val item = state.item ?: return
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp)) {
                Text(state.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val details = listOfNotNull(
                    item.path.trimEnd('/').substringAfterLast('/').ifEmpty { null },
                    formatBytes(item.size).takeIf { it.isNotEmpty() },
                    if (state.videoHeight > 0) "${state.videoHeight}p" else null,
                    if (state.quality != Quality.ORIGINAL) "playing ${state.quality.label}" else null,
                ).joinToString(" · ")
                Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                state.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp)) }
                state.error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp)) }
            }
        }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { ActionChip(if (item.starred) Icons.Filled.Star else Icons.Filled.StarBorder, if (item.starred) "Starred" else "Star", onStar) }
                item { ActionChip(Icons.Filled.Download, "Download", onDownload) }
                item { ActionChip(Icons.Filled.Info, "Info", onInfo) }
            }
        }
        if (state.queue.size > 1) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Up next · ${state.index + 1} of ${state.queue.size}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Text("Autoplay", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Switch(checked = state.autoplay, onCheckedChange = onAutoplay, modifier = Modifier.padding(start = 6.dp))
                }
            }
            itemsIndexed(state.queue, key = { _, it -> it.id }) { i, next ->
                val current = i == state.index
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onPlay(i) }
                        .background(if (current) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f) else Color.Transparent)
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.width(160.dp).aspectRatio(16f / 9f)) {
                        FileThumbnail(item = next, api = api, modifier = Modifier.fillMaxSize(), shapeRadius = 10.dp, iconSize = 28.dp)
                        if (current) Text(
                            "Playing", color = Color.White, style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp).background(Color(0xBF000000), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 1.dp),
                        )
                    }
                    Column(Modifier.weight(1f)) {
                        Text(next.name.substringBeforeLast('.'), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(formatBytes(next.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionChip(icon: ImageVector, label: String, onClick: () -> Unit) {
    AssistChip(onClick = onClick, label = { Text(label) }, leadingIcon = { Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp)) }, shape = RoundedCornerShape(18.dp))
}

// ── Settings sheet (YouTube's ⚙) ───────────────────────────────────────────────

@Composable
private fun SettingsSheet(page: SheetPage, state: VideoState, vm: VideoViewModel, onPage: (SheetPage) -> Unit, onClose: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        when (page) {
            SheetPage.MAIN -> {
                SheetRow(Icons.Filled.HighQuality, "Quality", state.quality.label + if (state.quality == Quality.ORIGINAL) " (the file)" else "") { onPage(SheetPage.QUALITY) }
                SheetRow(Icons.Filled.ClosedCaption, "Captions", state.subtitles.firstOrNull { it.selected && it.index >= 0 }?.label ?: if (state.subtitles.isEmpty()) "None" else "Off") { onPage(SheetPage.CAPTIONS) }
                if (state.audio.size > 1) SheetRow(Icons.Filled.Audiotrack, "Audio track", state.audio.firstOrNull { it.selected }?.label ?: "") { onPage(SheetPage.AUDIO) }
                SheetRow(Icons.Filled.Speed, "Playback speed", if (state.speed == 1f) "Normal" else "${state.speed}×") { onPage(SheetPage.SPEED) }
                SheetRow(Icons.Filled.Bedtime, "Sleep timer", state.sleepLabel ?: "Off") { onPage(SheetPage.SLEEP) }
                SwitchRow(Icons.Filled.Headphones, "Play in background", "Sound keeps going when you leave the app", state.backgroundPlay, vm::setBackgroundPlay)
                SwitchRow(Icons.Filled.Repeat, "Loop video", null, state.loop, vm::setLoop)
                SheetRow(Icons.Filled.Tune, "Additional settings", "Zoom, volume boost") { onPage(SheetPage.MORE) }
            }
            SheetPage.QUALITY -> Choices("Quality", state.qualities.map { (if (it == Quality.ORIGINAL) "Original (the file itself)" else it.label) to (it == state.quality) }) {
                state.qualities.getOrNull(it)?.let(vm::setQuality); onClose()
            }
            SheetPage.CAPTIONS -> if (state.subtitles.isEmpty()) {
                Text(
                    if (state.converted) "Subtitles aren't available while the server converts this video." else "This video has no subtitles.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp),
                )
            } else {
                Choices("Captions", state.subtitles.map { it.label to it.selected }) { state.subtitles.getOrNull(it)?.let { t -> vm.selectSubtitle(t.index) }; onClose() }
            }
            SheetPage.AUDIO -> Choices("Audio track", state.audio.map { it.label to it.selected }) { state.audio.getOrNull(it)?.let { t -> vm.selectAudio(t.index) }; onClose() }
            SheetPage.SPEED -> Choices("Playback speed", SPEEDS.map { (if (it == 1f) "Normal" else "${it}×") to (it == state.speed) }) { vm.setSpeed(SPEEDS[it]); onClose() }
            SheetPage.SLEEP -> Choices("Sleep timer", SLEEP_CHOICES.map { (minutes, label) ->
                label to (if (minutes == 0) state.sleepLabel == null else state.sleepLabel == if (minutes == -1) "End of video" else "$minutes min")
            }) { vm.setSleepTimer(SLEEP_CHOICES[it].first); onClose() }
            SheetPage.MORE -> {
                Text("Zoom", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 4.dp))
                Zoom.entries.forEach { z -> CheckRow(z.label, z == state.zoom) { vm.setZoom(z) } }
                Text("Volume boost", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 4.dp))
                BOOST_LEVELS.forEach { (gain, label) -> CheckRow(label, gain == state.boost) { vm.setBoost(gain) } }
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) { TextButton(onClick = onClose) { Text("Done") } }
            }
        }
    }
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, value: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).padding(start = 18.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SwitchRow(icon: ImageVector, label: String, detail: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        Column(Modifier.weight(1f).padding(start = 18.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun Choices(title: String, choices: List<Pair<String, Boolean>>, onPick: (Int) -> Unit) {
    Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 20.dp, top = 4.dp, bottom = 8.dp))
    choices.forEachIndexed { i, (label, selected) -> CheckRow(label, selected) { onPick(i) } }
}

@Composable
private fun CheckRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(36.dp)) {
            if (selected) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = MaterialTheme.colorScheme.primary)
        }
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}

/** 1:05:09 or 4:07. */
fun formatTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
}

fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}
