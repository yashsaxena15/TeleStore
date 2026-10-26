package com.backendforge.telestore.player

import android.net.Uri
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lyrics
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.Player
import androidx.palette.graphics.Palette
import coil3.SingletonImageLoader
import coil3.compose.SubcomposeAsyncImage
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.request.crossfade
import coil3.toBitmap
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.Lyrics
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.ui.components.miniPlayerSwipes
import com.backendforge.telestore.ui.components.pullDownOffset
import com.backendforge.telestore.ui.components.pullDownToClose
import com.backendforge.telestore.ui.components.rememberHaptics
import com.backendforge.telestore.ui.components.rememberPullDownState
import com.backendforge.telestore.ui.components.swipeSideways
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val SPEEDS = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)
private val SLEEP = listOf(0 to "Off", 15 to "15 minutes", 30 to "30 minutes", 45 to "45 minutes", 60 to "1 hour", -1 to "End of song")

/** Lyrics already looked up this session (null = none found), by file id. */
private val lyricsCache = mutableMapOf<String, Lyrics?>()

/** A small bar above the tabs while music plays: tap it to open Now Playing. */
@Composable
fun MiniPlayer(state: MusicState, controller: MusicController, onOpen: () -> Unit) {
    val haptics = rememberHaptics()
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 2.dp) {
        Column {
            val progress = if (state.durationMs > 0) (state.positionMs.toFloat() / state.durationMs).coerceIn(0f, 1f) else 0f
            LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().height(2.dp))
            Row(
                Modifier.fillMaxWidth()
                    .miniPlayerSwipes(onNext = controller::next, onPrevious = controller::previous, onOpen = onOpen)
                    .clickable(onClick = onOpen).padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(state.artworkUri, size = 40.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(state.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    Text(state.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { haptics.click(); controller.togglePlay() }) {
                    Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (state.isPlaying) "Pause" else "Play")
                }
                IconButton(onClick = controller::next, enabled = state.index < state.queue.lastIndex) {
                    Icon(Icons.Filled.SkipNext, contentDescription = "Next song")
                }
                IconButton(onClick = controller::stop) { Icon(Icons.Filled.Close, contentDescription = "Stop and close") }
            }
        }
    }
}

private enum class MusicSheet { QUEUE, LYRICS, SPEED, SLEEP }

/** YouTube Music-style Now Playing: the album art's colour behind everything, lyrics a tap away. */
@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun NowPlayingScreen(state: MusicState, controller: MusicController, container: AppContainer, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val tint = rememberArtworkColor(state.artworkUri, dark)
    val ground by animateColorAsState(tint, tween(700), label = "ground")
    val onGround = if (dark) Color.White else Color(0xFF1E1033)
    val muted = onGround.copy(alpha = 0.72f)
    var sheet by remember { mutableStateOf<MusicSheet?>(null) }
    var scrubbing by remember { mutableStateOf<Float?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val haptics = rememberHaptics()
    // Pull down anywhere (outside the lyrics and sliders) to go back to the mini player
    val pull = rememberPullDownState(onClose)

    // Lyrics for the song playing (looked up once per song)
    val item = state.item
    var online by remember { mutableStateOf(container.settings.onlineLyrics) }
    var lyrics by remember(item?.id) { mutableStateOf(item?.id?.let { lyricsCache[it] }) }
    var lyricsLoading by remember(item?.id) { mutableStateOf(item != null && item.id !in lyricsCache) }
    LaunchedEffect(item?.id, online) {
        val song = item ?: return@LaunchedEffect
        if (song.id in lyricsCache && !(lyricsCache[song.id] == null && online)) return@LaunchedEffect
        lyricsLoading = true
        val found = try {
            container.lyrics().find(song, state.durationMs, online)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        lyricsCache[song.id] = found
        lyrics = found
        lyricsLoading = false
    }

    Box(Modifier.fillMaxSize().background(ground).pullDownToClose(pull).pullDownOffset(pull)) {
        if (!state.hasMedia) {
            Text("Nothing is playing.", color = muted, modifier = Modifier.align(Alignment.Center))
            return@Box
        }
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Close", tint = onGround, modifier = Modifier.size(28.dp)) }
                Text(
                    if (state.artist.isNotEmpty()) "PLAYING FROM ${state.artist.uppercase()}" else "NOW PLAYING",
                    color = muted, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                Spacer(Modifier.width(48.dp))
            }

            // Artwork: full size while playing, a little smaller when paused
            val artScale by animateFloatAsState(if (state.isPlaying) 1f else 0.88f, tween(450, easing = FastOutSlowInEasing), label = "art")
            Box(
                Modifier.weight(1f).fillMaxWidth().padding(horizontal = 28.dp, vertical = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.widthIn(max = 420.dp).fillMaxWidth().aspectRatio(1f, matchHeightConstraintsFirst = true)
                        .swipeSideways(onNext = controller::next, onPrevious = controller::previous)
                        .scale(artScale).shadow(24.dp, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp)),
                ) { Artwork(state.artworkUri, size = null) }
            }

            Column(Modifier.widthIn(max = 520.dp).fillMaxWidth().padding(horizontal = 24.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(state.title, color = onGround, style = MaterialTheme.typography.headlineSmall, maxLines = 1, modifier = Modifier.basicMarquee())
                        Text(state.artist, color = muted, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (state.isPlaying) EqualizerBars(onGround.copy(alpha = 0.85f))
                    IconButton(onClick = {
                        val song = item ?: return@IconButton
                        scope.launch {
                            try {
                                val starred = container.api().setStarred(song, !song.starred)
                                controller.updateItem(song.copy(starred = starred))
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                message = (e as? ApiException)?.message ?: "Couldn't update the star."
                            }
                        }
                    }) {
                        Icon(if (item?.starred == true) Icons.Filled.Star else Icons.Filled.StarBorder, contentDescription = "Star", tint = onGround)
                    }
                }

                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 12.dp)) {
                    item { Chip(Icons.Filled.Download, "Download", onGround) { item?.let { container.transfers.download(it); message = "Downloading ${it.name}. See Transfers." } } }
                    item { Chip(Icons.Filled.Lyrics, "Lyrics", onGround) { sheet = MusicSheet.LYRICS } }
                    item { Chip(Icons.Filled.Bedtime, state.sleepLabel ?: "Sleep timer", onGround) { sheet = MusicSheet.SLEEP } }
                    item { Chip(Icons.Filled.Speed, if (state.speed == 1f) "Speed" else "${state.speed}×", onGround) { sheet = MusicSheet.SPEED } }
                }
                message?.let { Text(it, color = muted, style = MaterialTheme.typography.bodySmall) }

                val duration = state.durationMs.coerceAtLeast(1)
                Slider(
                    value = scrubbing ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f),
                    onValueChange = { scrubbing = it },
                    onValueChangeFinished = { scrubbing?.let { controller.seekTo((it * duration).toLong()) }; scrubbing = null },
                    enabled = state.durationMs > 0,
                    colors = SliderDefaults.colors(thumbColor = onGround, activeTrackColor = onGround, inactiveTrackColor = onGround.copy(alpha = 0.25f)),
                )
                Row {
                    Text(formatTime(scrubbing?.let { (it * duration).toLong() } ?: state.positionMs), color = muted, style = MaterialTheme.typography.labelMedium)
                    Spacer(Modifier.weight(1f))
                    Text(if (state.durationMs > 0) formatTime(state.durationMs) else "--:--", color = muted, style = MaterialTheme.typography.labelMedium)
                }

                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = controller::toggleShuffle) {
                        Icon(Icons.Filled.Shuffle, contentDescription = if (state.shuffle) "Shuffle on" else "Shuffle off", tint = if (state.shuffle) onGround else muted.copy(alpha = 0.5f))
                    }
                    IconButton(onClick = { haptics.click(); controller.previous() }, modifier = Modifier.size(56.dp)) { Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous", tint = onGround, modifier = Modifier.size(34.dp)) }
                    IconButton(onClick = { haptics.click(); controller.togglePlay() }, modifier = Modifier.size(76.dp).background(onGround, CircleShape)) {
                        if (state.buffering) CircularProgressIndicator(Modifier.size(30.dp), color = ground, strokeWidth = 3.dp)
                        else Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (state.isPlaying) "Pause" else "Play", tint = ground, modifier = Modifier.size(38.dp))
                    }
                    IconButton(onClick = { haptics.click(); controller.next() }, modifier = Modifier.size(56.dp)) { Icon(Icons.Filled.SkipNext, contentDescription = "Next", tint = onGround, modifier = Modifier.size(34.dp)) }
                    IconButton(onClick = controller::cycleRepeat) {
                        val (icon, label) = when (state.repeatMode) {
                            Player.REPEAT_MODE_ONE -> Icons.Filled.RepeatOne to "Repeat this song"
                            Player.REPEAT_MODE_ALL -> Icons.Filled.Repeat to "Repeat all"
                            else -> Icons.Filled.Repeat to "Repeat off"
                        }
                        Icon(icon, contentDescription = label, tint = if (state.repeatMode != Player.REPEAT_MODE_OFF) onGround else muted.copy(alpha = 0.5f))
                    }
                }
            }

            // Tabs at the bottom, as in YouTube Music
            Row(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 10.dp)) {
                TabText("UP NEXT", onGround, Modifier.weight(1f)) { sheet = MusicSheet.QUEUE }
                TabText("LYRICS", onGround, Modifier.weight(1f)) { sheet = MusicSheet.LYRICS }
            }
        }
    }

    sheet?.let { page ->
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = page == MusicSheet.LYRICS || page == MusicSheet.QUEUE)
        ModalBottomSheet(onDismissRequest = { sheet = null }, sheetState = sheetState, containerColor = lerp(ground, if (dark) Color.Black else Color.White, 0.25f)) {
            when (page) {
                MusicSheet.QUEUE -> QueueList(state, onGround, muted) { controller.skipTo(it) }
                MusicSheet.LYRICS -> LyricsView(
                    lyrics = lyrics, loading = lyricsLoading, positionMs = state.positionMs, color = onGround,
                    online = online, onOnline = { on -> online = on; container.settings.onlineLyrics = on },
                    onSeek = { controller.seekTo(it) },
                )
                MusicSheet.SPEED -> Choices(SPEEDS.map { (if (it == 1f) "Normal" else "${it}×") to (it == state.speed) }, onGround) { controller.setSpeed(SPEEDS[it]); sheet = null }
                MusicSheet.SLEEP -> Choices(SLEEP.map { (m, label) ->
                    label to (if (m == 0) state.sleepLabel == null else state.sleepLabel == (if (m == -1) "End of song" else "$m min"))
                }, onGround) { controller.setSleepTimer(SLEEP[it].first); sheet = null }
            }
        }
    }
}

/** The colour behind Now Playing, taken from the album art (YouTube Music does the same). */
@Composable
private fun rememberArtworkColor(uri: Uri?, dark: Boolean): Color {
    val context = LocalContext.current
    val fallback = if (dark) Color(0xFF24133F) else Color(0xFFF1ECFB)
    var color by remember(uri, dark) { mutableStateOf(fallback) }
    LaunchedEffect(uri, dark) {
        if (uri == null) return@LaunchedEffect
        val result = runCatching {
            SingletonImageLoader.get(context).execute(ImageRequest.Builder(context).data(uri.toString()).allowHardware(false).size(96).build())
        }.getOrNull() as? SuccessResult ?: return@LaunchedEffect
        val bitmap = runCatching { result.image.toBitmap() }.getOrNull() ?: return@LaunchedEffect
        val palette = Palette.from(bitmap).generate()
        val swatch = palette.darkVibrantSwatch ?: palette.darkMutedSwatch ?: palette.vibrantSwatch ?: palette.dominantSwatch ?: return@LaunchedEffect
        val base = Color(swatch.rgb)
        // Keep text readable: dark grounds stay dark, light grounds stay pale
        color = if (dark) lerp(base, Color.Black, 0.45f) else lerp(base, Color.White, 0.82f)
    }
    return color
}

/** Little bars bouncing next to the title while the song plays. */
@Composable
private fun EqualizerBars(color: Color) {
    val transition = rememberInfiniteTransition(label = "eq")
    Row(Modifier.height(18.dp).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
        listOf(420, 300, 520, 360).forEach { ms ->
            val h by transition.animateFloat(0.3f, 1f, infiniteRepeatable(tween(ms), RepeatMode.Reverse), label = "bar")
            Box(Modifier.width(3.dp).fillMaxHeight(h).clip(RoundedCornerShape(2.dp)).background(color))
        }
    }
}

@Composable
private fun Chip(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(18.dp), color = color.copy(alpha = 0.12f)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
            Text(label, color = color, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun TabText(text: String, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.clickable(onClick = onClick).padding(vertical = 14.dp), contentAlignment = Alignment.Center) {
        Text(text, color = color, style = MaterialTheme.typography.labelLarge, letterSpacing = 1.sp)
    }
}

@Composable
private fun QueueList(state: MusicState, color: Color, muted: Color, onPick: (Int) -> Unit) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = (state.index - 2).coerceAtLeast(0))
    Text("Up next", color = color, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 20.dp, bottom = 8.dp))
    LazyColumn(state = list, modifier = Modifier.fillMaxWidth().height(520.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        itemsIndexed(state.queue) { i, entry ->
            val current = i == state.index
            Row(
                Modifier.fillMaxWidth().clickable { onPick(i) }.background(if (current) color.copy(alpha = 0.10f) else Color.Transparent).padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(32.dp)) {
                    if (current && state.isPlaying) EqualizerBars(color) else Text("${i + 1}", color = muted, style = MaterialTheme.typography.labelMedium)
                }
                Column(Modifier.weight(1f)) {
                    Text(entry.title, color = color, fontWeight = if (current) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (entry.subtitle.isNotEmpty()) Text(entry.subtitle, color = muted, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                }
            }
        }
    }
}

/** Synced lyrics: the line being sung is bright and kept in view; tap a line to jump there. */
@Composable
private fun LyricsView(
    lyrics: Lyrics?,
    loading: Boolean,
    positionMs: Long,
    color: Color,
    online: Boolean,
    onOnline: (Boolean) -> Unit,
    onSeek: (Long) -> Unit,
) {
    val list = rememberLazyListState()
    val current = lyrics?.currentIndex(positionMs) ?: -1
    LaunchedEffect(current) {
        if (current >= 0) list.animateScrollToItem((current - 2).coerceAtLeast(0))
    }
    Column(Modifier.fillMaxWidth().height(600.dp)) {
        when {
            loading -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = color) }
            lyrics == null -> Box(Modifier.weight(1f).fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    if (online) "No lyrics found for this song." else "No lyrics in this song. Turn on online lyrics below to look them up.",
                    color = color.copy(alpha = 0.72f), style = MaterialTheme.typography.bodyLarge,
                )
            }
            else -> LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                itemsIndexed(lyrics.lines) { i, line ->
                    val active = i == current
                    val alpha by animateFloatAsState(
                        when {
                            !lyrics.synced -> 0.9f
                            active -> 1f
                            i < current -> 0.38f
                            else -> 0.6f
                        },
                        tween(300), label = "line",
                    )
                    val size by animateFloatAsState(if (active) 1.04f else 1f, tween(300), label = "size")
                    Text(
                        line.text.ifEmpty { "♪" },
                        color = color.copy(alpha = alpha),
                        fontSize = 24.sp, fontWeight = FontWeight.Bold, lineHeight = 31.sp,
                        modifier = Modifier.scale(size).clickable(enabled = line.timeMs != null) { line.timeMs?.let(onSeek) },
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                lyrics?.let { "Lyrics from ${it.source}" + if (it.synced) " · synced" else "" } ?: "Online lyrics (LRCLIB)",
                color = color.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f),
            )
            Text("Online", color = color.copy(alpha = 0.72f), style = MaterialTheme.typography.labelMedium)
            Switch(checked = online, onCheckedChange = onOnline, modifier = Modifier.padding(start = 6.dp))
        }
    }
}

@Composable
private fun Choices(choices: List<Pair<String, Boolean>>, color: Color, onPick: (Int) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        choices.forEachIndexed { i, (label, selected) ->
            Row(Modifier.fillMaxWidth().clickable { onPick(i) }.padding(horizontal = 20.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(36.dp)) { if (selected) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = color) }
                Text(label, color = color, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

/** The song's cover (the file's thumbnail) or a music note. [size] null fills the parent. */
@Composable
private fun Artwork(uri: Uri?, size: Dp?) {
    val context = LocalContext.current
    val shape = RoundedCornerShape(if (size == null) 10.dp else 8.dp)
    val box = (if (size == null) Modifier.fillMaxSize() else Modifier.size(size)).clip(shape).background(MaterialTheme.colorScheme.secondaryContainer)
    Box(box, contentAlignment = Alignment.Center) {
        val placeholder = @Composable {
            Icon(Icons.Filled.MusicNote, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(if (size == null) 72.dp else 22.dp))
        }
        if (uri == null) placeholder() else SubcomposeAsyncImage(
            model = ImageRequest.Builder(context).data(uri.toString()).crossfade(true).build(),
            contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(), loading = { placeholder() }, error = { placeholder() },
        )
    }
}
