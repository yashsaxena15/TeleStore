package com.backendforge.telestore.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class DocumentsTest {
    private fun zip(vararg files: Pair<String, String>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z ->
            for ((name, text) in files) {
                z.putNextEntry(ZipEntry(name))
                z.write(text.toByteArray())
                z.closeEntry()
            }
        }
        return out.toByteArray()
    }

    @Test
    fun `document kinds come from the extension`() {
        assertEquals(DocumentKind.PDF, DocumentKind.of("Report.PDF"))
        assertEquals(DocumentKind.WORD, DocumentKind.of("cv.docx"))
        assertEquals(DocumentKind.SHEET, DocumentKind.of("budget.xlsx"))
        assertEquals(DocumentKind.SLIDES, DocumentKind.of("talk.pptx"))
        assertEquals(DocumentKind.TEXT, DocumentKind.of("notes.md"))
        assertEquals(DocumentKind.OTHER, DocumentKind.of("old.doc"))
    }

    @Test
    fun `word headings, lists, paragraphs and tables`() {
        val doc = """<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
            <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Plan &amp; goals</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>
            <w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>world</w:t><w:br/><w:t>again</w:t></w:r></w:p>
            <w:p></w:p>
            <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            </w:body></w:document>"""
        val blocks = OfficeReader.word(zip("word/document.xml" to doc))
        assertEquals(
            listOf(
                DocBlock.Heading(1, "Plan & goals"),
                DocBlock.Paragraph("First", bullet = true),
                DocBlock.Paragraph("Hello world\nagain"),
                DocBlock.Table(listOf(listOf("A1", "B1"))),
            ),
            blocks,
        )
    }

    @Test
    fun `sheets place cells by reference and read shared strings`() {
        val workbook = """<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>"""
        val rels = """<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>"""
        val strings = """<sst><si><t>Item</t></si><si><r><t>Co</t></r><r><t>st</t></r></si></sst>"""
        val sheet = """<worksheet><sheetData>
            <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
            <row r="3"><c r="A3" t="inlineStr"><is><t>Rent</t></is></c><c r="C3"><v>1200.0</v></c><c r="D3"><v>0.25</v></c></row>
            </sheetData></worksheet>"""
        val sheets = OfficeReader.sheets(zip("xl/workbook.xml" to workbook, "xl/_rels/workbook.xml.rels" to rels, "xl/sharedStrings.xml" to strings, "xl/worksheets/sheet1.xml" to sheet))
        val s = sheets.single()
        assertEquals("Budget", s.name)
        assertEquals(listOf("Item", "", "Cost", ""), s.rows[0])
        assertEquals(listOf("", "", "", ""), s.rows[1])
        assertEquals(listOf("Rent", "", "1200", "0.25"), s.rows[2])
        assertEquals(27, OfficeReader.columnIndex("AB12"))
    }

    @Test
    fun `slides come in order with their titles`() {
        fun slide(title: String, body: String) = """<p:sld><p:cSld><p:spTree>
            <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>$title</a:t></a:r></a:p></p:txBody></p:sp>
            <p:sp><p:txBody><a:p><a:r><a:t>$body</a:t></a:r></a:p></p:txBody></p:sp>
            </p:spTree></p:cSld></p:sld>"""
        val slides = OfficeReader.slides(zip("ppt/slides/slide10.xml" to slide("Ten", "last"), "ppt/slides/slide2.xml" to slide("Two", "middle"), "ppt/slides/slide1.xml" to slide("One", "first")))
        assertEquals(listOf("One", "Two", "Ten"), slides.map { it.title })
        assertEquals(listOf("first"), slides[0].lines)
        assertEquals(3, slides[2].number)
    }

    @Test
    fun `a doctype trick is skipped, never followed`() {
        val evil = """<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd"> <!ENTITY y "boom">]>
            <w:document><w:body><w:p><w:r><w:t>safe &x; &y; &#65;&#x42;</w:t></w:r></w:p></w:body></w:document>"""
        val blocks = OfficeReader.word(zip("word/document.xml" to evil))
        assertEquals(listOf(DocBlock.Paragraph("safe &x; &y; AB")), blocks)
    }

    @Test
    fun `attributes with a greater-than sign and comments`() {
        val root = Xml.parse("""<a><!-- <b> --><b v="1>2" w='x'/><c><![CDATA[<raw>]]></c></a>""")
        val b = root.first("b")!!
        assertEquals("1>2", b.attr("v"))
        assertEquals("x", b.attr("w"))
        assertEquals("<raw>", root.first("c")!!.text())
        assertEquals(1, root.all("b").size)
    }

    @Test
    fun `damaged files and zip bombs are refused politely`() {
        assertThrows<DocumentException> { OfficeReader.word("not a zip".toByteArray()) }
        assertThrows<DocumentException> { OfficeReader.sheets(zip("other.txt" to "x")) }
        val bomb = ByteArrayOutputStream()
        ZipOutputStream(bomb).use { z ->
            z.putNextEntry(ZipEntry("word/document.xml"))
            val zeros = ByteArray(1024 * 1024)
            repeat(41) { z.write(zeros) }
            z.closeEntry()
        }
        val e = assertThrows<DocumentException> { OfficeReader.word(bomb.toByteArray()) }
        assertTrue("too big" in e.message!!)
    }

    @Test
    fun `archive calls send ids and folders`() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = TeleStoreApi(server.url("/"), { "t" })
        server.enqueue(MockResponse().setBody("""{"is_valid":true,"total_files":2,"total_uncompressed_size":30,"files":[{"name":"a/","is_dir":true,"size":0},{"name":"a/b.txt","is_dir":false,"size":30}]}"""))
        val contents = api.inspectArchive(FileItem(id = "f1", name = "x.zip"))
        assertEquals("/archive/inspect/f1", server.takeRequest().path)
        assertEquals(30, contents.totalSize)
        assertTrue(contents.files[0].isDir)
        server.enqueue(MockResponse().setBody("""{"success":true,"task_id":"t1","message":"queued"}"""))
        api.compress(listOf(FileItem(id = "f1", name = "a"), FileItem(id = "f2", name = "b")), "/Home/Docs", " pack.zip ")
        val body = server.takeRequest().body.readUtf8()
        assertTrue("\"item_ids\":[\"f1\",\"f2\"]" in body && "\"zip_name\":\"pack.zip\"" in body && "\"destination_path\":\"/Home/Docs\"" in body)
        server.enqueue(MockResponse().setBody("""{"tasks":[{"task_id":"t1","task_type":"compress","target_name":"pack.zip","status":"running","progress_percent":40.5}]}"""))
        val task = api.archiveTasks().tasks.single()
        assertTrue(task.active)
        assertEquals("Compressing", task.verb)
        assertFalse(task.copy(status = "completed").active)
        server.shutdown()
    }
}
