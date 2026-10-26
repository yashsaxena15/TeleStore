package com.backendforge.telestore.ui.links

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.Choice
import com.backendforge.telestore.core.InstagramPreview
import com.backendforge.telestore.core.LinkKind
import com.backendforge.telestore.core.MediaChoices
import com.backendforge.telestore.core.MediaPreview
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.player.formatTime
import com.backendforge.telestore.ui.components.FolderPickerSheet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class LinkStep { INPUT, LOADING, MEDIA, INSTAGRAM, DONE }

data class AddLinkState(
    val link: String = "",
    val folder: String = TeleStoreApi.HOME,
    val step: LinkStep = LinkStep.INPUT,
    val media: MediaPreview? = null,
    val instagram: InstagramPreview? = null,
    val audioMode: Boolean = false,
    val quality: String = "best",
    val audio: String = "original",
    val subtitles: String? = null,
    val picked: Set<Int> = emptySet(),
    val sync: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val done: String? = null,
)

/** Paste a link and the server fetches it: video sites, Instagram, Google Drive, magnets, direct files. */
class AddLinkViewModel(private val container: AppContainer, initialLink: String?) : ViewModel() {
    private val _state = MutableStateFlow(AddLinkState(link = initialLink.orEmpty()))
    val state: StateFlow<AddLinkState> = _state.asStateFlow()
    private val api get() = container.api()

    init {
        if (!initialLink.isNullOrBlank()) next()
    }

    fun setLink(text: String) = _state.update { it.copy(link = text, error = null) }
    fun setFolder(path: String) = _state.update { it.copy(folder = path) }
    fun setAudioMode(on: Boolean) = _state.update { it.copy(audioMode = on) }
    fun setQuality(v: String) = _state.update { it.copy(quality = v) }
    fun setAudio(v: String) = _state.update { it.copy(audio = v) }
    fun setSubtitles(v: String?) = _state.update { it.copy(subtitles = v) }
    fun setSync(on: Boolean) = _state.update { it.copy(sync = on) }
    fun toggle(index: Int) = _state.update { it.copy(picked = if (index in it.picked) it.picked - index else it.picked + index) }
    fun pickAll(all: Boolean) = _state.update { s -> s.copy(picked = if (all) s.media?.entries?.map { it.index }?.toSet().orEmpty() else emptySet()) }
    fun back() = _state.update { it.copy(step = LinkStep.INPUT, media = null, instagram = null, error = null) }
    fun again() {
        _state.value = AddLinkState(folder = _state.value.folder)
    }

    /** Works out what the link is: video sites and Instagram show a preview first; the rest starts now. */
    fun next() {
        val link = LinkKind.firstLink(_state.value.link) ?: _state.value.link.trim()
        val kind = LinkKind.detect(link) ?: return _state.update { it.copy(error = "That doesn't look like a link.") }
        _state.update { it.copy(link = link, step = LinkStep.LOADING, error = null) }
        run {
            when (kind) {
                LinkKind.MEDIA -> {
                    val preview = api.mediaPreview(link)
                    _state.update { it.copy(step = LinkStep.MEDIA, media = preview, picked = preview.entries.map { e -> e.index }.toSet()) }
                }
                LinkKind.INSTAGRAM -> _state.update { it.copy(step = LinkStep.INSTAGRAM, instagram = api.instagramPreview(link)) }
                LinkKind.LEECH -> finished(api.addFromLink(link, _state.value.folder).message ?: "Started. See Transfers.")
            }
        }
    }

    fun downloadMedia() {
        val s = _state.value
        val preview = s.media ?: return
        if (preview.isPlaylist && s.picked.isEmpty() && !s.sync) return _state.update { it.copy(error = "Pick at least one video.") }
        _state.update { it.copy(busy = true, error = null) }
        run {
            val reply = api.downloadMedia(
                s.link, MediaChoices.choice(s.audioMode, s.quality, s.audio, s.subtitles), s.folder,
                items = if (preview.isPlaylist) s.picked.sorted() else null, sync = preview.isPlaylist && s.sync,
            )
            finished(reply.message ?: "Downloading. See Transfers.")
        }
    }

    fun importInstagram() {
        _state.update { it.copy(busy = true, error = null) }
        run { finished(api.importInstagram(_state.value.link, _state.value.folder).message ?: "Importing. See Transfers.") }
    }

    fun addTorrent(name: String, bytes: ByteArray) {
        _state.update { it.copy(step = LinkStep.LOADING, error = null) }
        run { finished(api.addTorrent(name, bytes, _state.value.folder).message ?: "Started. See Transfers.") }
    }

    private fun finished(message: String) = _state.update { it.copy(step = LinkStep.DONE, done = message, busy = false) }

    private fun run(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val message = (e as? ApiException)?.message ?: "Something went wrong: ${e.message}"
                _state.update { s ->
                    s.copy(
                        busy = false, error = message.removePrefix("TELEGRAM_NOT_VERIFIED: "),
                        step = if (s.step == LinkStep.LOADING) LinkStep.INPUT else s.step,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddLinkScreen(vm: AddLinkViewModel, container: AppContainer, onClose: () -> Unit, onTransfers: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var pickFolder by remember { mutableStateOf(false) }
    val torrentPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = uri.lastPathSegment?.substringAfterLast('/')?.let { if (it.endsWith(".torrent")) it else "$it.torrent" } ?: "file.torrent"
        val bytes = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
        if (bytes != null && bytes.size < 10 * 1024 * 1024) vm.addTorrent(name, bytes)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Add from link") },
                navigationIcon = { IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (state.step) {
                LinkStep.INPUT -> InputStep(state, vm, onPickFolder = { pickFolder = true }, onTorrent = { torrentPicker.launch(arrayOf("application/x-bittorrent", "application/octet-stream")) })
                LinkStep.LOADING -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Text("Asking the server about this link…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
                }
                LinkStep.MEDIA -> MediaStep(state, vm)
                LinkStep.INSTAGRAM -> InstagramStep(state, vm)
                LinkStep.DONE -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.done.orEmpty(), style = MaterialTheme.typography.titleMedium)
                    Button(onClick = onTransfers, modifier = Modifier.padding(top = 20.dp)) { Text("See Transfers") }
                    TextButton(onClick = vm::again) { Text("Add another link") }
                }
            }
        }
    }
    if (pickFolder) {
        FolderPickerSheet(
            title = "Save into", confirmActionLabel = "Save here", sourceItems = emptyList(), api = container.api(),
            onSelectFolder = { vm.setFolder(it); pickFolder = false }, onDismiss = { pickFolder = false },
        )
    }
}

@Composable
private fun InputStep(state: AddLinkState, vm: AddLinkViewModel, onPickFolder: () -> Unit, onTorrent: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        OutlinedTextField(
            value = state.link, onValueChange = vm::setLink, modifier = Modifier.fillMaxWidth(),
            label = { Text("Link") }, leadingIcon = { Icon(Icons.Filled.Link, contentDescription = null) },
            trailingIcon = {
                IconButton(onClick = { clipboard.getText()?.text?.let(vm::setLink) }) { Icon(Icons.Filled.ContentPaste, contentDescription = "Paste") }
            },
            supportingText = { Text("YouTube, Instagram, Facebook, X, Google Drive, a magnet, or any file link") },
            singleLine = false, maxLines = 4,
        )
        FolderRow(state.folder, onPickFolder)
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = vm::next, enabled = state.link.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Continue") }
        OutlinedButton(onClick = onTorrent, modifier = Modifier.fillMaxWidth()) { Text("Or choose a .torrent file") }
        Text(
            "The server downloads it and saves it to TeleStore, so it keeps going with this app closed. Progress shows in Transfers.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun FolderRow(folder: String, onPick: () -> Unit) {
    Surface(onClick = onPick, shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text("Save to", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(folder, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("Change", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** The server's preview images arrive as data: URLs. */
@Composable
private fun DataImage(dataUrl: String?, modifier: Modifier) {
    val bitmap = remember(dataUrl) {
        dataUrl?.substringAfter("base64,", "")?.takeIf { it.isNotEmpty() }?.let { b64 ->
            runCatching { Base64.decode(b64, Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) }?.asImageBitmap() }.getOrNull()
        }
    }
    Box(modifier.clip(RoundedCornerShape(14.dp))) {
        if (bitmap != null) Image(bitmap, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxSize()) {}
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MediaStep(state: AddLinkState, vm: AddLinkViewModel) {
    val preview = state.media ?: return
    var picker by remember { mutableStateOf<String?>(null) }
    val qualities = remember(preview) { MediaChoices.video(preview) }
    val audios = remember(preview) { MediaChoices.audio(preview) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { DataImage(preview.thumbnail, Modifier.fillMaxWidth().aspectRatio(16f / 9f)) }
        item {
            Text(preview.title, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
            val details = listOfNotNull(
                preview.uploader, preview.site,
                preview.duration?.takeIf { it > 0 }?.let { formatTime((it * 1000).toLong()) },
                if (preview.isPlaylist) "${preview.count} videos" else null,
            ).joinToString(" · ")
            Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(selected = !state.audioMode, onClick = { vm.setAudioMode(false) }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Video") }
                SegmentedButton(selected = state.audioMode, onClick = { vm.setAudioMode(true) }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Audio only") }
            }
        }
        if (!state.audioMode) {
            item { PickRow("Quality", qualities.firstOrNull { it.value == state.quality }?.label ?: state.quality) { picker = "quality" } }
            item {
                Text("Subtitles", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(listOf(null to "None", "en" to "English", "hi" to "Hindi", "all" to "All")) { (value, label) ->
                        FilterChip(selected = state.subtitles == value, onClick = { vm.setSubtitles(value) }, label = { Text(label) })
                    }
                }
            }
        } else {
            item { PickRow("Audio", audios.flatMap { it.choices }.firstOrNull { it.value == state.audio }?.label ?: state.audio) { picker = "audio" } }
        }
        if (preview.isPlaylist) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${state.picked.size} of ${preview.entries.size} picked", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    TextButton(onClick = { vm.pickAll(state.picked.size < preview.entries.size) }) { Text(if (state.picked.size < preview.entries.size) "Pick all" else "Clear") }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Keep downloading new videos", style = MaterialTheme.typography.bodyLarge)
                        Text("New uploads to this ${if (preview.isChannel) "channel" else "playlist"} download by themselves", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = state.sync, onCheckedChange = vm::setSync)
                }
            }
            items(preview.entries, key = { it.index }) { entry ->
                Row(Modifier.fillMaxWidth().clickable { vm.toggle(entry.index) }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = entry.index in state.picked, onCheckedChange = null)
                    Text(entry.title, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
                    entry.duration?.takeIf { it > 0 }?.let { Text(formatTime((it * 1000).toLong()), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        item { state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) } }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = vm::back, modifier = Modifier.weight(1f)) { Text("Back") }
                Button(onClick = vm::downloadMedia, enabled = !state.busy, modifier = Modifier.weight(1f)) {
                    if (state.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Download")
                }
            }
        }
    }
    picker?.let { which ->
        val groups = if (which == "quality") listOf("Quality" to qualities) else audios.map { it.title to it.choices }
        ChoiceDialog(
            groups = groups, selected = if (which == "quality") state.quality else state.audio,
            onPick = { if (which == "quality") vm.setQuality(it) else vm.setAudio(it); picker = null },
            onDismiss = { picker = null },
        )
    }
}

@Composable
private fun PickRow(label: String, value: String, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun ChoiceDialog(groups: List<Pair<String, List<Choice>>>, selected: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        text = {
            LazyColumn(Modifier.height(420.dp)) {
                groups.forEach { (title, choices) ->
                    item { Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)) }
                    items(choices, key = { "$title-${it.value}" }) { c ->
                        Row(Modifier.fillMaxWidth().clickable { onPick(c.value) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(c.label, fontWeight = if (c.value == selected) FontWeight.Bold else FontWeight.Normal, color = if (c.value == selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
            }
        },
    )
}

@Composable
private fun InstagramStep(state: AddLinkState, vm: AddLinkViewModel) {
    val post = state.instagram ?: return
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        DataImage(post.thumbnail, Modifier.fillMaxWidth().aspectRatio(1f))
        Text("@${post.owner}", style = MaterialTheme.typography.titleMedium)
        post.caption?.takeIf { it.isNotBlank() }?.let { Text(it, maxLines = 4, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium) }
        val videos = post.items.count { it.isVideo }
        Text(
            "${post.items.size} item${if (post.items.size != 1) "s" else ""}" + if (videos > 0) " · $videos video${if (videos != 1) "s" else ""}" else "",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = vm::back, modifier = Modifier.weight(1f)) { Text("Back") }
            Button(onClick = vm::importInstagram, enabled = !state.busy, modifier = Modifier.weight(1f)) {
                if (state.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Import")
            }
        }
    }
}
