package com.backendforge.telestore.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.zip.ZipInputStream

/** How the app shows a document. */
enum class DocumentKind {
    PDF, WORD, SHEET, SLIDES, TEXT,
    /** Nothing in the app reads it: offer another app. */
    OTHER;

    companion object {
        private val text = setOf(
            "txt", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "ini", "conf", "srt", "vtt",
            "py", "js", "ts", "kt", "java", "c", "cpp", "h", "cs", "go", "rs", "sh", "sql", "html", "css",
        )

        fun of(name: String): DocumentKind = when (val ext = FileKinds.extension(name)) {
            "pdf" -> PDF
            "docx" -> WORD
            "xlsx" -> SHEET
            "pptx" -> SLIDES
            in text -> TEXT
            else -> OTHER
        }
    }
}

/** A Word document's content, simplified for reading on a phone. */
sealed interface DocBlock {
    data class Heading(val level: Int, val text: String) : DocBlock
    data class Paragraph(val text: String, val bullet: Boolean = false) : DocBlock
    data class Table(val rows: List<List<String>>) : DocBlock
}

data class Sheet(val name: String, val rows: List<List<String>>, val truncated: Boolean = false)

data class Slide(val number: Int, val title: String, val lines: List<String>)

/** The file isn't a document this reader understands (damaged, or an old .doc/.xls/.ppt). */
class DocumentException(message: String) : IOException(message)

/**
 * Reads .docx, .xlsx and .pptx (zipped XML) into simple content: text, tables, sheets and slides.
 * Uses its own tiny XML reader, which never follows DTDs or outside references, so a crafted file
 * can't make the app fetch anything; and limits how much it unpacks, so a "zip bomb" can't fill memory.
 */
object OfficeReader {
    private const val MAX_ENTRY = 40L * 1024 * 1024
    private const val MAX_ROWS = 2000
    private const val MAX_COLS = 60

    fun word(bytes: ByteArray): List<DocBlock> {
        val doc = entries(bytes) { it == "word/document.xml" }["word/document.xml"] ?: throw DocumentException("This isn't a Word document the app can read.")
        val blocks = mutableListOf<DocBlock>()
        val body = Xml.parse(doc).first("body") ?: return blocks
        for (node in body.children) {
            when (node.local) {
                "p" -> paragraph(node)?.let(blocks::add)
                // Content controls (forms, tables of contents) hold ordinary paragraphs
                "sdt" -> node.all("p").forEach { p -> paragraph(p)?.let(blocks::add) }
                "tbl" -> blocks += DocBlock.Table(
                    node.all("tr").map { tr -> tr.children.filter { it.local == "tc" }.map { tc -> tc.all("p").joinToString("\n") { it.runsText() }.trim() } }
                        .take(MAX_ROWS),
                )
            }
        }
        return blocks
    }

    private fun paragraph(p: Xml.Node): DocBlock? {
        val text = p.runsText()
        if (text.isBlank()) return null
        val style = p.first("pStyle")?.attr("val").orEmpty().lowercase()
        val heading = Regex("""heading(\d)""").find(style)?.groupValues?.get(1)?.toIntOrNull() ?: if (style == "title") 1 else null
        return when {
            heading != null -> DocBlock.Heading(heading.coerceIn(1, 6), text)
            p.first("numPr") != null || "list" in style -> DocBlock.Paragraph(text, bullet = true)
            else -> DocBlock.Paragraph(text)
        }
    }

    /** Text of a paragraph's runs, with tabs and line breaks. */
    private fun Xml.Node.runsText(): String = buildString {
        fun walk(n: Xml.Node) {
            when (n.local) {
                "t" -> append(n.text())
                "tab" -> append('\t')
                "br", "cr" -> append('\n')
                else -> n.children.forEach(::walk)
            }
        }
        walk(this@runsText)
    }

    fun sheets(bytes: ByteArray): List<Sheet> {
        val files = entries(bytes) { it == "xl/workbook.xml" || it == "xl/sharedStrings.xml" || it == "xl/_rels/workbook.xml.rels" || it.startsWith("xl/worksheets/sheet") }
        val workbook = files["xl/workbook.xml"] ?: throw DocumentException("This isn't an Excel workbook the app can read.")
        val shared = files["xl/sharedStrings.xml"]?.let { xml -> Xml.parse(xml).all("si").map { si -> si.all("t").joinToString("") { it.text() } } }.orEmpty()
        val targets = files["xl/_rels/workbook.xml.rels"]?.let { rels ->
            Xml.parse(rels).all("Relationship").associate { it.attr("Id").orEmpty() to "xl/" + it.attr("Target").orEmpty().removePrefix("/xl/").removePrefix("./") }
        }.orEmpty()
        return Xml.parse(workbook).all("sheet").mapIndexedNotNull { i, sheet ->
            val path = targets[sheet.attr("id").orEmpty()] ?: "xl/worksheets/sheet${i + 1}.xml"
            val xml = files[path] ?: return@mapIndexedNotNull null
            readSheet(sheet.attr("name") ?: "Sheet ${i + 1}", xml, shared)
        }
    }

    private fun readSheet(name: String, xml: String, shared: List<String>): Sheet {
        val rows = sortedMapOf<Int, MutableMap<Int, String>>()
        var truncated = false
        for (row in Xml.parse(xml).all("row")) {
            val r = row.attr("r")?.toIntOrNull() ?: ((if (rows.isEmpty()) 0 else rows.lastKey()) + 1)
            if (r > MAX_ROWS) { truncated = true; break }
            val cells = rows.getOrPut(r) { mutableMapOf() }
            var next = 0
            for (c in row.children.filter { it.local == "c" }) {
                val col = c.attr("r")?.let(::columnIndex) ?: next
                next = col + 1
                if (col >= MAX_COLS) { truncated = true; continue }
                val raw = c.first("v")?.text()
                val value = when (c.attr("t")) {
                    "s" -> raw?.toIntOrNull()?.let { shared.getOrNull(it) }
                    "inlineStr" -> c.all("t").joinToString("") { it.text() }
                    "b" -> if (raw == "1") "TRUE" else "FALSE"
                    else -> raw?.let(::number)
                }.orEmpty()
                if (value.isNotEmpty()) cells[col] = value
            }
        }
        val width = rows.values.maxOfOrNull { (it.keys.maxOrNull() ?: -1) + 1 } ?: 0
        val first = rows.keys.firstOrNull() ?: 1
        val last = rows.keys.lastOrNull() ?: 0
        val grid = (first..last).map { r -> (0 until width).map { c -> rows[r]?.get(c).orEmpty() } }
        return Sheet(name, grid, truncated)
    }

    /** "AB12" → 27 (column index from 0). */
    fun columnIndex(ref: String): Int? {
        val letters = ref.takeWhile { it.isLetter() }.uppercase()
        if (letters.isEmpty()) return null
        return letters.fold(0) { acc, ch -> acc * 26 + (ch - 'A' + 1) } - 1
    }

    /** Plain numbers as Excel shows them: no "3.0", no "1.0E7". */
    private fun number(raw: String): String {
        val d = raw.toDoubleOrNull() ?: return raw
        if (d == Math.floor(d) && kotlin.math.abs(d) < 1e15) return d.toLong().toString()
        return runCatching { java.math.BigDecimal(raw.trim()).stripTrailingZeros().toPlainString() }.getOrDefault(raw)
    }

    fun slides(bytes: ByteArray): List<Slide> {
        val files = entries(bytes) { Regex("""ppt/slides/slide\d+\.xml""").matches(it) }
        if (files.isEmpty()) throw DocumentException("This isn't a PowerPoint file the app can read.")
        return files.entries.sortedBy { it.key.filter(Char::isDigit).toIntOrNull() ?: 0 }.mapIndexed { i, (_, xml) ->
            val shapes = Xml.parse(xml).all("sp")
            val titleShape = shapes.firstOrNull { sp -> sp.first("ph")?.attr("type") in setOf("title", "ctrTitle") }
            fun lines(sp: Xml.Node) = sp.all("p").map { p -> p.all("t").joinToString("") { it.text() } }.filter { it.isNotBlank() }
            val title = titleShape?.let(::lines)?.joinToString(" ").orEmpty()
            Slide(i + 1, title, shapes.filter { it !== titleShape }.flatMap(::lines))
        }
    }

    /** The zip's entries whose names [want] accepts, as text; refuses oversized entries. */
    private fun entries(bytes: ByteArray, want: (String) -> Boolean): Map<String, String> {
        val out = mutableMapOf<String, String>()
        try {
            ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (entry.isDirectory || !want(entry.name)) continue
                    val buffer = ByteArrayOutputStream()
                    val chunk = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = zip.read(chunk)
                        if (n < 0) break
                        total += n
                        if (total > MAX_ENTRY) throw DocumentException("This document is too big to show in the app.")
                        buffer.write(chunk, 0, n)
                    }
                    out[entry.name] = buffer.toString(Charsets.UTF_8.name())
                }
            }
        } catch (e: DocumentException) {
            throw e
        } catch (e: Exception) {
            throw DocumentException("This file is damaged or isn't a document the app can read.")
        }
        return out
    }
}

/**
 * A small XML reader for the files inside Office documents: elements, attributes and text. It
 * skips <!DOCTYPE>, comments and processing instructions without acting on them.
 */
object Xml {
    class Node(val name: String, val attrs: Map<String, String>) {
        val children = mutableListOf<Node>()
        internal val parts = StringBuilder()

        /** The name without its namespace prefix ("w:p" → "p"). */
        val local: String get() = name.substringAfter(':')

        fun attr(local: String): String? = attrs.entries.firstOrNull { it.key.substringAfter(':') == local }?.value

        /** Text directly inside this element. */
        fun text(): String = parts.toString()

        fun first(local: String): Node? {
            for (c in children) {
                if (c.local == local) return c
                c.first(local)?.let { return it }
            }
            return null
        }

        fun all(local: String): List<Node> = buildList {
            fun walk(n: Node) {
                for (c in n.children) {
                    if (c.local == local) add(c) else walk(c)
                }
            }
            walk(this@Node)
        }
    }

    fun parse(xml: String): Node {
        val root = Node("#root", emptyMap())
        val stack = ArrayDeque<Node>().apply { addLast(root) }
        var i = 0
        val n = xml.length
        while (i < n) {
            val lt = xml.indexOf('<', i)
            val textEnd = if (lt < 0) n else lt
            if (textEnd > i) stack.last().parts.append(decode(xml.substring(i, textEnd)))
            if (lt < 0) break
            when {
                xml.startsWith("<!--", lt) -> i = xml.indexOf("-->", lt).let { if (it < 0) n else it + 3 }
                xml.startsWith("<![CDATA[", lt) -> {
                    val end = xml.indexOf("]]>", lt).let { if (it < 0) n else it }
                    stack.last().parts.append(xml, lt + 9, end)
                    i = minOf(n, end + 3)
                }
                xml.startsWith("<?", lt) -> i = xml.indexOf("?>", lt).let { if (it < 0) n else it + 2 }
                xml.startsWith("<!", lt) -> i = skipDeclaration(xml, lt)
                xml.startsWith("</", lt) -> {
                    val gt = xml.indexOf('>', lt).let { if (it < 0) n else it }
                    if (stack.size > 1) stack.removeLast()
                    i = gt + 1
                }
                else -> {
                    val gt = tagEnd(xml, lt)
                    val selfClosing = gt > 0 && xml[gt - 1] == '/'
                    val inner = xml.substring(lt + 1, if (selfClosing) gt - 1 else gt)
                    val name = inner.takeWhile { !it.isWhitespace() }
                    val node = Node(name, attributes(inner.substring(name.length)))
                    stack.last().children += node
                    if (!selfClosing) stack.addLast(node)
                    i = gt + 1
                }
            }
        }
        return root
    }

    /** Where a start tag ends, ignoring '>' inside quoted attribute values. */
    private fun tagEnd(xml: String, from: Int): Int {
        var quote: Char? = null
        for (j in from until xml.length) {
            val c = xml[j]
            if (quote != null) { if (c == quote) quote = null } else if (c == '"' || c == '\'') quote = c else if (c == '>') return j
        }
        return xml.length - 1
    }

    /** <!DOCTYPE …> (with an inline [ … ] part) is skipped, never interpreted. */
    private fun skipDeclaration(xml: String, from: Int): Int {
        var depth = 0
        for (j in from until xml.length) {
            when (xml[j]) {
                '[' -> depth++
                ']' -> depth--
                '>' -> if (depth <= 0) return j + 1
            }
        }
        return xml.length
    }

    private val ATTR = Regex("""([\w:.\-]+)\s*=\s*("([^"]*)"|'([^']*)')""")

    private fun attributes(s: String): Map<String, String> =
        ATTR.findAll(s).associate { m -> m.groupValues[1] to decode(m.groupValues[3].ifEmpty { m.groupValues[4] }) }

    private val ENTITY = Regex("""&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);""")

    fun decode(s: String): String = if ('&' !in s) s else ENTITY.replace(s) { m ->
        when (val e = m.groupValues[1]) {
            "lt" -> "<"
            "gt" -> ">"
            "amp" -> "&"
            "quot" -> "\""
            "apos" -> "'"
            else -> {
                val code = if (e.startsWith("#x")) e.drop(2).toIntOrNull(16) else e.drop(1).toIntOrNull()
                code?.takeIf { Character.isValidCodePoint(it) }?.let { String(Character.toChars(it)) } ?: ""
            }
        }
    }
}

/** GET /archive/inspect/{id}: what's inside a ZIP, RAR, 7z or TAR without extracting it. */
@kotlinx.serialization.Serializable
data class ArchiveContents(
    @kotlinx.serialization.SerialName("total_files") val totalFiles: Int = 0,
    @kotlinx.serialization.SerialName("total_uncompressed_size") val totalSize: Long = 0,
    val files: List<ArchiveEntry> = emptyList(),
)

@kotlinx.serialization.Serializable
data class ArchiveEntry(
    val name: String,
    @kotlinx.serialization.SerialName("is_dir") val isDir: Boolean = false,
    val size: Long = 0,
)

/** A compress or extract job the server runs in the background. */
@kotlinx.serialization.Serializable
data class ArchiveTask(
    @kotlinx.serialization.SerialName("task_id") val id: String,
    @kotlinx.serialization.SerialName("task_type") val type: String = "",
    @kotlinx.serialization.SerialName("target_name") val name: String = "",
    val status: String = "",
    val stage: String = "",
    @kotlinx.serialization.SerialName("progress_percent") val percent: Double = 0.0,
    @kotlinx.serialization.SerialName("current_file") val currentFile: String? = null,
    @kotlinx.serialization.SerialName("processed_files") val processedFiles: Int = 0,
    @kotlinx.serialization.SerialName("total_files") val totalFiles: Int = 0,
    val error: String? = null,
) {
    val active: Boolean get() = status == "queued" || status == "running"
    val verb: String get() = if (type == "extract") "Extracting" else "Compressing"
}

@kotlinx.serialization.Serializable
data class ArchiveTasks(val tasks: List<ArchiveTask> = emptyList())
