package com.backendforge.telestore.player

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import coil3.compose.SubcomposeAsyncImage

/** A small bar above the tabs while music plays: tap it to open Now Playing. */
@Composable
fun MiniPlayer(state: MusicState, controller: MusicController, onOpen: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 2.dp) {
        Column {
            val progress = if (state.durationMs > 0) (state.positionMs.toFloat() / state.durationMs).coerceIn(0f, 1f) else 0f
            LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().height(2.dp))
            Row(
                Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(state.artworkUri, size = 40.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(state.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    Text(state.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = controller::togglePlay) {
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

@Composable
fun NowPlayingScreen(state: MusicState, controller: MusicController, onClose: () -> Unit) {
    var scrubbing by remember { mutableStateOf<Float?>(null) }
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().statusBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Close Now Playing") }
                    Text(
                        if (state.artist.isNotEmpty()) "Playing from ${state.artist}" else "Now playing",
                        Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.width(48.dp))
                }
            }
            if (!state.hasMedia) {
                item { Text("Nothing is playing.", Modifier.padding(32.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                return@LazyColumn
            }
            item {
                Box(Modifier.widthIn(max = 360.dp).fillMaxWidth().padding(horizontal = 40.dp, vertical = 16.dp).aspectRatio(1f)) {
                    Artwork(state.artworkUri, size = null)
                }
            }
            item {
                Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 24.dp)) {
                    Text(state.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(state.artist, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
                    val duration = state.durationMs.coerceAtLeast(1)
                    Slider(
                        value = scrubbing ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f),
                        onValueChange = { scrubbing = it },
                        onValueChangeFinished = {
                            scrubbing?.let { controller.seekTo((it * duration).toLong()) }
                            scrubbing = null
                        },
                        enabled = state.durationMs > 0,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    Row {
                        Text(formatTime(scrubbing?.let { (it * duration).toLong() } ?: state.positionMs), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.weight(1f))
                        Text(if (state.durationMs > 0) formatTime(state.durationMs) else "--:--", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = controller::toggleShuffle) {
                            Icon(Icons.Filled.Shuffle, contentDescription = if (state.shuffle) "Shuffle on" else "Shuffle off",
                                tint = if (state.shuffle) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(onClick = controller::previous) { Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous", modifier = Modifier.size(32.dp)) }
                        IconButton(
                            onClick = controller::togglePlay,
                            modifier = Modifier.size(72.dp).background(MaterialTheme.colorScheme.onBackground, RoundedCornerShape(36.dp)),
                        ) {
                            Icon(
                                if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                                contentDescription = if (state.isPlaying) "Pause" else "Play",
                                tint = MaterialTheme.colorScheme.background, modifier = Modifier.size(40.dp),
                            )
                        }
                        IconButton(onClick = controller::next, enabled = state.index < state.queue.lastIndex || state.repeatMode == Player.REPEAT_MODE_ALL) {
                            Icon(Icons.Filled.SkipNext, contentDescription = "Next", modifier = Modifier.size(32.dp))
                        }
                        IconButton(onClick = controller::cycleRepeat) {
                            val (icon, label) = when (state.repeatMode) {
                                Player.REPEAT_MODE_ONE -> Icons.Filled.RepeatOne to "Repeat this song"
                                Player.REPEAT_MODE_ALL -> Icons.Filled.Repeat to "Repeat all"
                                else -> Icons.Filled.Repeat to "Repeat off"
                            }
                            Icon(icon, contentDescription = label,
                                tint = if (state.repeatMode != Player.REPEAT_MODE_OFF) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Text(
                        "Keeps playing with the screen locked. Lock-screen and headphone buttons work.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "QUEUE · ${state.index + 1} OF ${state.queue.size}",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 20.dp, bottom = 6.dp),
                    )
                }
            }
            itemsIndexed(state.queue) { i, entry ->
                val current = i == state.index
                Row(
                    Modifier
                        .widthIn(max = 480.dp)
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (current) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                        .clickable { controller.skipTo(i) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (current) "▶" else "${i + 1}", Modifier.width(32.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(entry.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        fontWeight = if (current) FontWeight.SemiBold else FontWeight.Normal)
                }
            }
            item { Spacer(Modifier.navigationBarsPadding().height(24.dp)) }
        }
    }
}

/** The song's cover (the file's thumbnail) or a music note. [size] null fills the parent. */
@Composable
private fun Artwork(uri: Uri?, size: Dp?) {
    val shape = RoundedCornerShape(if (size == null) 20.dp else 8.dp)
    val box = (if (size == null) Modifier.fillMaxSize() else Modifier.size(size)).clip(shape).background(MaterialTheme.colorScheme.secondaryContainer)
    Box(box, contentAlignment = Alignment.Center) {
        val placeholder = @Composable {
            Icon(Icons.Filled.MusicNote, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.size(if (size == null) 72.dp else 22.dp))
        }
        if (uri == null) placeholder() else SubcomposeAsyncImage(
            model = uri.toString(), contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(), loading = { placeholder() }, error = { placeholder() },
        )
    }
}
