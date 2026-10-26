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
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.backendforge.telestore.MainActivity
import com.backendforge.telestore.core.Quality
import com.backendforge.telestore.ui.components.formatBytes
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.Locale

private val SPEEDS = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)

@androidx.annotation.OptIn(UnstableApi::class)
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideoScreen(vm: VideoViewModel, onBack: () -> Unit) {
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
    var feedback by remember { mutableStateOf<String?>(null) }
    var showSettings by remember { mutableStateOf(false) }

    if (state.item == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }

    // Controls hide 3 s after the last touch while the video plays
    LaunchedEffect(controlsVisible, state.isPlaying, touchTick) {
        if (controlsVisible && state.isPlaying) {
            delay(3_000)
            controlsVisible = false
        }
    }
    LaunchedEffect(feedback) {
        if (feedback != null) {
            delay(700)
            feedback = null
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
    // Hide the status and navigation bars while immersive
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

    // Picture-in-picture: leaving the app while a video plays keeps it playing in a small window
    val ratio = if (state.videoWidth > 0 && state.videoHeight > 0) Rational(state.videoWidth, state.videoHeight) else Rational(16, 9)
    val currentRatio by rememberUpdatedState(ratio)
    val playing by rememberUpdatedState(state.isPlaying)
    LaunchedEffect(ratio, state.isPlaying) { activity?.updatePictureInPicture(ratio, state.isPlaying) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(activity, lifecycleOwner) {
        activity?.pictureInPictureRatio = { if (playing) currentRatio else null }
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Leaving the app (not into picture-in-picture) pauses the video
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && activity?.isInPictureInPictureMode != true) vm.pause()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
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

    BackHandler(enabled = fullscreen) { fullscreen = false }

    val showControls = controlsVisible && !inPip
    Box(Modifier.fillMaxSize().background(if (immersive) Color.Black else MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize()) {
            if (!immersive) {
                Row(Modifier.statusBarsPadding().fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                    Text(state.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                    IconButton(onClick = { activity?.enterPictureInPicture() }) { Icon(Icons.Filled.PictureInPictureAlt, contentDescription = "Picture in picture") }
                }
            }

            val videoBox = if (immersive) Modifier.fillMaxSize() else Modifier.fillMaxWidth().aspectRatio(ratio.toFloat().coerceIn(0.56f, 2.4f).let { if (it < 1f) 1f else it })
            Box(videoBox.background(Color.Black)) {
                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            useController = false
                            setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                            player = vm.player
                        }
                    },
                    update = { it.player = vm.player },
                    modifier = Modifier.fillMaxSize(),
                )

                if (!inPip) {
                    GestureLayer(
                        onTap = { controlsVisible = !controlsVisible; touchTick++ },
                        onDoubleTap = { forward ->
                            vm.seekBy(if (forward) 10_000 else -10_000)
                            feedback = if (forward) "+10 s" else "−10 s"
                        },
                        onFeedback = { feedback = it },
                    )
                }

                if (state.buffering && !state.ended) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center).size(48.dp), color = Color.White)
                }
                feedback?.let {
                    Text(
                        it, color = Color.White, style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.align(Alignment.Center).background(Color(0x99000000), RoundedCornerShape(12.dp)).padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }

                if (showControls) {
                    Controls(
                        state = state,
                        immersive = immersive,
                        fullscreen = fullscreen || landscape,
                        onBack = { if (fullscreen) fullscreen = false else onBack() },
                        onTogglePlay = { vm.togglePlay(); touchTick++ },
                        onSeek = { vm.seekTo(it); touchTick++ },
                        onScrub = { touchTick++ },
                        onPrevious = { vm.previous(); touchTick++ },
                        onNext = { vm.next(); touchTick++ },
                        onSettings = { showSettings = true },
                        onFullscreen = {
                            if (fullscreen || landscape) {
                                fullscreen = false
                                activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
                            } else {
                                fullscreen = true
                            }
                        },
                        onPictureInPicture = { activity?.enterPictureInPicture() },
                    )
                }
            }

            if (!immersive) {
                Details(state, onPlay = vm::playAt)
            }
        }
    }

    if (showSettings) {
        ModalBottomSheet(onDismissRequest = { showSettings = false }) {
            SettingsSheet(
                state = state,
                onSpeed = vm::setSpeed,
                onQuality = { vm.setQuality(it); showSettings = false },
                onAudio = { vm.selectAudio(it); showSettings = false },
                onSubtitle = { vm.selectSubtitle(it); showSettings = false },
            )
        }
    }
}

/** Tap: show/hide controls. Double-tap a side: skip 10 s. Swipe up/down: brightness (left), volume (right). */
@Composable
private fun GestureLayer(onTap: () -> Unit, onDoubleTap: (forward: Boolean) -> Unit, onFeedback: (String) -> Unit) {
    val context = LocalContext.current
    val activity = context.findActivity()
    val audio = remember { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    val tap by rememberUpdatedState(onTap)
    val doubleTap by rememberUpdatedState(onDoubleTap)
    val feedback by rememberUpdatedState(onFeedback)
    var leftSide by remember { mutableStateOf(true) }
    var level by remember { mutableFloatStateOf(0f) }

    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { tap() },
                    onDoubleTap = { doubleTap(it.x > size.width / 2) },
                )
            }
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { start ->
                        leftSide = start.x < size.width / 2
                        level = if (leftSide) currentBrightness(activity) else
                            audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    },
                    onVerticalDrag = { change, dragAmount ->
                        change.consume()
                        level = (level - dragAmount / size.height).coerceIn(0f, 1f)
                        if (leftSide) {
                            activity?.window?.let { w -> w.attributes = w.attributes.apply { screenBrightness = level.coerceAtLeast(0.01f) } }
                            feedback("Brightness ${(level * 100).toInt()}%")
                        } else {
                            val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                            audio.setStreamVolume(AudioManager.STREAM_MUSIC, (level * max).toInt(), 0)
                            feedback("Volume ${(level * 100).toInt()}%")
                        }
                    },
                )
            },
    )
}

private fun currentBrightness(activity: Activity?): Float {
    val own = activity?.window?.attributes?.screenBrightness ?: -1f
    if (own >= 0f) return own
    val system = activity?.let { runCatching { Settings.System.getInt(it.contentResolver, Settings.System.SCREEN_BRIGHTNESS) }.getOrNull() } ?: 128
    return system / 255f
}

@Composable
private fun Controls(
    state: VideoState,
    immersive: Boolean,
    fullscreen: Boolean,
    onBack: () -> Unit,
    onTogglePlay: () -> Unit,
    onSeek: (Long) -> Unit,
    onScrub: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onSettings: () -> Unit,
    onFullscreen: () -> Unit,
    onPictureInPicture: () -> Unit,
) {
    var scrubbing by remember { mutableStateOf<Float?>(null) }
    Box(Modifier.fillMaxSize().background(Color(0x66000000))) {
        if (immersive) {
            Row(Modifier.align(Alignment.TopStart).fillMaxWidth().statusBarsPadding().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White) }
                Text(state.title, Modifier.weight(1f), color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                IconButton(onClick = onPictureInPicture) { Icon(Icons.Filled.PictureInPictureAlt, contentDescription = "Picture in picture", tint = Color.White) }
            }
        }

        Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onPrevious, enabled = state.hasPrevious || state.positionMs > 3_000) {
                Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous video", tint = Color.White, modifier = Modifier.size(32.dp))
            }
            IconButton(onClick = onTogglePlay, modifier = Modifier.size(64.dp).background(Color(0x33FFFFFF), RoundedCornerShape(32.dp))) {
                val icon = when {
                    state.ended -> Icons.Filled.Replay
                    state.isPlaying -> Icons.Filled.Pause
                    else -> Icons.Filled.PlayArrow
                }
                Icon(icon, contentDescription = if (state.isPlaying) "Pause" else "Play", tint = Color.White, modifier = Modifier.size(40.dp))
            }
            IconButton(onClick = onNext, enabled = state.hasNext) {
                Icon(Icons.Filled.SkipNext, contentDescription = "Next video", tint = Color.White, modifier = Modifier.size(32.dp))
            }
        }

        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().then(if (immersive) Modifier.navigationBarsPadding() else Modifier).padding(horizontal = 12.dp)) {
            val duration = state.durationMs.coerceAtLeast(1)
            Slider(
                value = scrubbing ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f),
                onValueChange = { scrubbing = it; onScrub() },
                onValueChangeFinished = {
                    scrubbing?.let { onSeek((it * duration).toLong()) }
                    scrubbing = null
                },
                enabled = state.durationMs > 0,
                colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = MaterialTheme.colorScheme.primary, inactiveTrackColor = Color(0x55FFFFFF)),
                modifier = Modifier.height(28.dp),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                val shown = scrubbing?.let { (it * duration).toLong() } ?: state.positionMs
                Text(
                    "${formatTime(shown)} / ${if (state.durationMs > 0) formatTime(state.durationMs) else "--:--"}",
                    color = Color.White, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onSettings) { Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = Color.White) }
                IconButton(onClick = onFullscreen) {
                    Icon(if (fullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen, contentDescription = if (fullscreen) "Exit fullscreen" else "Fullscreen", tint = Color.White)
                }
            }
        }
    }
}

@Composable
private fun Details(state: VideoState, onPlay: (Int) -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(state.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                val details = listOfNotNull(
                    formatBytes(state.item?.size).takeIf { it.isNotEmpty() },
                    if (state.videoHeight > 0) "${state.videoHeight}p" else null,
                    if (state.quality != Quality.ORIGINAL) "Playing ${state.quality.label}" else null,
                ).joinToString(" · ")
                if (details.isNotEmpty()) Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                state.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                state.error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
                Text(
                    "Double-tap a side to skip 10 s. Swipe up or down on the left for brightness, on the right for volume.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        if (state.queue.size > 1) {
            item {
                Text(
                    "UP NEXT · ${state.index + 1} of ${state.queue.size}",
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            itemsIndexed(state.queue, key = { _, it -> it.id }) { i, item ->
                val current = i == state.index
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onPlay(i) }
                        .background(if (current) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (current) "▶" else "${i + 1}", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(32.dp),
                    )
                    Column(Modifier.weight(1f)) {
                        Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        Text(formatBytes(item.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item { Spacer(Modifier.navigationBarsPadding().height(16.dp)) }
    }
}

@Composable
private fun SettingsSheet(
    state: VideoState,
    onSpeed: (Float) -> Unit,
    onQuality: (Quality) -> Unit,
    onAudio: (Int) -> Unit,
    onSubtitle: (Int) -> Unit,
) {
    LazyColumn(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        item { SectionTitle("Speed") }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SPEEDS.forEach { speed ->
                    FilterChip(
                        selected = state.speed == speed,
                        onClick = { onSpeed(speed) },
                        label = { Text(if (speed == 1f) "Normal" else "${speed}×") },
                    )
                }
            }
        }
        item { SectionTitle("Quality") }
        state.qualities.forEach { q ->
            item { ChoiceRow(q.label + if (q == Quality.ORIGINAL) " (the file itself)" else "", q == state.quality) { onQuality(q) } }
        }
        if (state.audio.size > 1) {
            item { SectionTitle("Audio") }
            state.audio.forEach { t -> item { ChoiceRow(t.label, t.selected) { onAudio(t.index) } } }
        }
        item { SectionTitle("Subtitles") }
        if (state.subtitles.isEmpty()) {
            item {
                Text(
                    if (state.converted) "Subtitles aren't available while the server converts this video." else "This video has no subtitles.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        } else {
            state.subtitles.forEach { t -> item { ChoiceRow(t.label, t.selected) { onSubtitle(t.index) } } }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text.uppercase(Locale.ROOT), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
    )
}

@Composable
private fun ChoiceRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (selected) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = MaterialTheme.colorScheme.primary)
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
