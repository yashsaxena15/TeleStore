package com.backendforge.telestore.ui.viewers

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.DocBlock
import com.backendforge.telestore.core.DocumentException
import com.backendforge.telestore.core.DocumentKind
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.OfficeReader
import com.backendforge.telestore.core.Sheet
import com.backendforge.telestore.core.Slide
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.LocalFile
import com.backendforge.telestore.ui.components.formatBytes
import com.backendforge.telestore.ui.components.rememberOpenElsewhere
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.backendforge.telestore.ui.components.ProgressBar

/** What the viewer shows once the file is on the phone. */
private sealed interface Loaded {
    data class Pdf(val file: LocalFile) : Loaded
    data class Word(val blocks: List<DocBlock>) : Loaded
    data class Sheets(val sheets: List<Sheet>) : Loaded
    data class Slides(val slides: List<Slide>) : Loaded
    data class Text(val text: String, val truncated: Boolean) : Loaded
}

/** Office files bigger than this open in another app instead (they're read into memory). */
private const val MAX_OFFICE = 50L * 1024 * 1024
private const val MAX_TEXT = 512 * 1024

/** Shows PDFs, Word, Excel and PowerPoint files and text in the app; anything else opens in another app. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentScreen(container: AppContainer, item: FileItem?, onBack: () -> Unit, onDownload: (FileItem) -> Unit) {
    if (item == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val context = LocalContext.current
    val elsewhere = rememberOpenElsewhere(container)
    val kind = remember(item.name) { DocumentKind.of(item.name) }
    var progress by remember { mutableFloatStateOf(0f) }
    var loaded by remember { mutableStateOf<Loaded?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(item.id) {
        if (kind == DocumentKind.OTHER) return@LaunchedEffect
        if (kind in setOf(DocumentKind.WORD, DocumentKind.SHEET, DocumentKind.SLIDES) && (item.size ?: 0) > MAX_OFFICE) {
            error = "This file is too big to show in the app (${formatBytes(item.size)}). Open it in another app instead."
            return@LaunchedEffect
        }
        try {
            val file = container.files.fetch(item) { progress = it }
            loaded = withContext(Dispatchers.IO) {
                fun bytes(limit: Int = Int.MAX_VALUE): ByteArray =
                    context.contentResolver.openInputStream(file.uri)?.use { input ->
                        if (limit == Int.MAX_VALUE) input.readBytes() else {
                            val buf = ByteArray(limit)
                            var n = 0
                            while (n < limit) { val r = input.read(buf, n, limit - n); if (r < 0) break; n += r }
                            buf.copyOf(n)
                        }
                    } ?: throw DocumentException("Couldn't read the file on the phone.")
                when (kind) {
                    DocumentKind.PDF -> Loaded.Pdf(file)
                    DocumentKind.WORD -> Loaded.Word(OfficeReader.word(bytes()))
                    DocumentKind.SHEET -> Loaded.Sheets(OfficeReader.sheets(bytes()))
                    DocumentKind.SLIDES -> Loaded.Slides(OfficeReader.slides(bytes()))
                    else -> {
                        val raw = bytes(MAX_TEXT + 1)
                        Loaded.Text(String(raw, 0, minOf(raw.size, MAX_TEXT), Charsets.UTF_8), raw.size > MAX_TEXT)
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = (e as? ApiException)?.message ?: e.message ?: "Couldn't show this file."
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        item.size?.let { Text(formatBytes(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = { elsewhere.share(item) }) { Icon(Icons.Filled.Share, contentDescription = "Share") }
                    IconButton(onClick = { elsewhere.openWith(item) }) { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Open with another app") }
                    IconButton(onClick = { onDownload(item) }) { Icon(Icons.Filled.Download, contentDescription = "Download to phone") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (val content = loaded) {
                null -> when {
                    kind == DocumentKind.OTHER || error != null -> Column(
                        Modifier.align(Alignment.Center).padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(error ?: "TeleStore can't show this kind of file itself.", style = MaterialTheme.typography.bodyLarge)
                        Button(onClick = { elsewhere.openWith(item) }) { Text("Open with another app") }
                        OutlinedButton(onClick = { elsewhere.share(item) }) { Text("Share") }
                    }
                    else -> Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Getting the file…", style = MaterialTheme.typography.bodyMedium)
                        ProgressBar(progress = { progress }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                    }
                }
                is Loaded.Pdf -> PdfPages(content.file)
                is Loaded.Word -> WordView(content.blocks)
                is Loaded.Sheets -> SheetsView(content.sheets)
                is Loaded.Slides -> SlidesView(content.slides)
                is Loaded.Text -> TextView(content.text, content.truncated)
            }
        }
    }
}

// ── PDF ─────────────────────────────────────────────────────────────────────────

/** Every page, drawn by Android's own PDF renderer as it scrolls into view; pinch to zoom. */
@Composable
private fun PdfPages(file: LocalFile) {
    val context = LocalContext.current
    val opened = remember(file.uri) {
        runCatching {
            val fd = context.contentResolver.openFileDescriptor(file.uri, "r") ?: error("no file")
            fd to PdfRenderer(fd)
        }
    }
    val pdf = opened.getOrNull()
    // One page at a time: PdfRenderer allows only one open page
    val lock = remember { Mutex() }
    DisposableEffect(pdf) {
        onDispose {
            pdf?.let { (fd, renderer) ->
                runCatching { renderer.close() }
                runCatching { fd.close() }
            }
        }
    }
    if (pdf == null) {
        Text("This PDF is damaged or protected with a password.", modifier = Modifier.padding(24.dp))
        return
    }
    val renderer = pdf.second
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    BoxWithConstraints(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerLow).pointerInput(Unit) {
            // Two fingers zoom (taken before the list sees them); one finger scrolls the pages as usual
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                do {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    if (event.changes.count { it.pressed } > 1) {
                        scale = (scale * event.calculateZoom()).coerceIn(1f, 4f)
                        val max = size.width * (scale - 1) / 2
                        offsetX = if (scale == 1f) 0f else (offsetX + event.calculatePan().x).coerceIn(-max, max)
                        event.changes.forEach { it.consume() }
                    }
                } while (event.changes.any { it.pressed })
            }
        },
    ) {
        val widthPx = with(LocalDensity.current) { maxWidth.toPx() }.toInt().coerceIn(200, 2000)
        LazyColumn(
            Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = offsetX },
            contentPadding = PaddingValues(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(renderer.pageCount) { index ->
                // The page's shape and picture, made off the main thread, one page at a time
                var page by remember(index, widthPx) { mutableStateOf<Pair<Float, Bitmap?>?>(null) }
                LaunchedEffect(index, widthPx) {
                    page = withContext(Dispatchers.IO) {
                        lock.withLock {
                            runCatching {
                                val open = renderer.openPage(index)
                                try {
                                    // Sharp enough to read, small enough for many pages (~14 MB each at most)
                                    val w = minOf(widthPx * 3 / 2, 1600)
                                    val h = (w * open.height.toFloat() / open.width).toInt().coerceIn(1, 6000)
                                    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                                    bitmap.eraseColor(AndroidColor.WHITE)
                                    open.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                    open.width.toFloat() / open.height to bitmap
                                } finally {
                                    open.close()
                                }
                            }.getOrElse { 0.707f to null }
                        }
                    }
                }
                Box(Modifier.fillMaxWidth().aspectRatio(page?.first ?: 0.707f).background(Color.White), contentAlignment = Alignment.Center) {
                    val bitmap = page?.second
                    when {
                        bitmap != null -> Image(bitmap.asImageBitmap(), contentDescription = "Page ${index + 1}", modifier = Modifier.fillMaxSize())
                        page == null -> CircularProgressIndicator(Modifier.size(28.dp))
                        else -> Text("Couldn't draw page ${index + 1}.", color = Color.DarkGray)
                    }
                }
            }
        }
    }
}

// ── Word ────────────────────────────────────────────────────────────────────────

@Composable
private fun WordView(blocks: List<DocBlock>) {
    if (blocks.isEmpty()) {
        Text("This document has no text.", modifier = Modifier.padding(24.dp))
        return
    }
    SelectionContainer {
        LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(blocks) { block ->
                when (block) {
                    is DocBlock.Heading -> Text(
                        block.text,
                        style = when (block.level) {
                            1 -> MaterialTheme.typography.headlineSmall
                            2 -> MaterialTheme.typography.titleLarge
                            else -> MaterialTheme.typography.titleMedium
                        },
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    is DocBlock.Paragraph -> Text(if (block.bullet) "•  ${block.text}" else block.text, style = MaterialTheme.typography.bodyLarge)
                    is DocBlock.Table -> TableView(block.rows)
                }
            }
        }
    }
}

@Composable
private fun TableView(rows: List<List<String>>, header: Boolean = false) {
    val columns = rows.maxOfOrNull { it.size } ?: 0
    Column(Modifier.horizontalScroll(rememberScrollState())) {
        rows.forEachIndexed { r, row ->
            Row {
                for (c in 0 until columns) {
                    Text(
                        row.getOrNull(c).orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = if (header && r == 0) FontWeight.SemiBold else null,
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .width(120.dp)
                            .background(if (r % 2 == 0) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surface)
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }
}

// ── Excel ───────────────────────────────────────────────────────────────────────

@Composable
private fun SheetsView(sheets: List<Sheet>) {
    if (sheets.isEmpty()) {
        Text("This workbook has no sheets.", modifier = Modifier.padding(24.dp))
        return
    }
    var tab by remember { mutableIntStateOf(0) }
    val sheet = sheets[tab.coerceIn(0, sheets.lastIndex)]
    Column(Modifier.fillMaxSize()) {
        if (sheets.size > 1) {
            ScrollableTabRow(selectedTabIndex = tab.coerceIn(0, sheets.lastIndex), edgePadding = 8.dp) {
                sheets.forEachIndexed { i, s -> Tab(selected = i == tab, onClick = { tab = i }, text = { Text(s.name, maxLines = 1) }) }
            }
        }
        if (sheet.truncated) {
            Text(
                "Showing the first part of this sheet. Open it in another app for all of it.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(12.dp),
            )
        }
        val columns = sheet.rows.maxOfOrNull { it.size } ?: 0
        val hScroll = rememberScrollState()
        LazyColumn(Modifier.fillMaxSize().horizontalScroll(hScroll)) {
            item {
                Row {
                    Cell("", header = true, narrow = true)
                    for (c in 0 until columns) Cell(columnName(c), header = true)
                }
            }
            itemsIndexed(sheet.rows) { r, row ->
                Row {
                    Cell("${r + 1}", header = true, narrow = true)
                    for (c in 0 until columns) Cell(row.getOrNull(c).orEmpty())
                }
            }
        }
    }
}

@Composable
private fun Cell(text: String, header: Boolean = false, narrow: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        fontWeight = if (header) FontWeight.SemiBold else null,
        color = if (header) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .width(if (narrow) 44.dp else 110.dp)
            .background(if (header) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surface)
            .padding(horizontal = 6.dp, vertical = 6.dp),
    )
}

/** 0 → A, 26 → AA. */
private fun columnName(index: Int): String {
    var n = index + 1
    val sb = StringBuilder()
    while (n > 0) {
        val rem = (n - 1) % 26
        sb.insert(0, 'A' + rem)
        n = (n - 1) / 26
    }
    return sb.toString()
}

// ── PowerPoint ──────────────────────────────────────────────────────────────────

@Composable
private fun SlidesView(slides: List<Slide>) {
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(slides) { slide ->
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Slide ${slide.number}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    if (slide.title.isNotBlank()) Text(slide.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    slide.lines.forEach { Text("•  $it", style = MaterialTheme.typography.bodyMedium) }
                    if (slide.title.isBlank() && slide.lines.isEmpty()) {
                        Text("Pictures only. Open it in another app to see them.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

// ── Text ────────────────────────────────────────────────────────────────────────

@Composable
private fun TextView(text: String, truncated: Boolean) {
    val lines = remember(text) { text.lines() }
    SelectionContainer {
        LazyColumn(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()), contentPadding = PaddingValues(12.dp)) {
            if (truncated) item {
                Text("Showing the first 512 KB.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(lines) { line ->
                Text(line.ifEmpty { " " }, fontFamily = FontFamily.Monospace, fontSize = 13.sp, softWrap = false)
            }
        }
    }
}
