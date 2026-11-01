package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PhotosViewTest {
    private fun photo(key: String, bucket: String, bucketId: String = bucket, name: String = "$key.jpg", video: Boolean = false) =
        LocalPhoto(key = key, name = name, size = 1, takenAtMillis = 0, video = video, uri = "content://$key", bucketId = bucketId, bucket = bucket)

    private val camera1 = photo("c1", "Camera")
    private val camera2 = photo("c2", "Camera", video = true)
    private val whatsapp = photo("w1", "WhatsApp Images")
    private val whatsappBacked = photo("w2", "WhatsApp Images")
    private val shot = photo("s1", "Screenshots")
    private val all = listOf(camera1, camera2, whatsapp, whatsappBacked, shot)

    @Test
    fun `pinch moves between the three layouts`() {
        assertEquals(PhotosLayout.COMFORTABLE, PhotosLayout.DAY.bigger())
        assertEquals(PhotosLayout.COMFORTABLE, PhotosLayout.COMFORTABLE.bigger())
        assertEquals(PhotosLayout.DAY, PhotosLayout.MONTH.bigger())
        assertEquals(PhotosLayout.MONTH, PhotosLayout.DAY.smaller())
        assertEquals(PhotosLayout.DAY, PhotosLayout.COMFORTABLE.smaller())
    }

    @Test
    fun `backup albums always show, other apps as allowed`() {
        val backed = setOf("w2", "s1")
        val off = PhotosView(otherApps = false)
        assertEquals(listOf("c1", "c2"), PhotosVisibility.visible(all, emptySet(), true, off, backed).map { it.key })
        assertEquals(listOf("c1"), PhotosVisibility.visible(all, emptySet(), false, off, backed).map { it.key })

        val onlyBacked = PhotosView(otherApps = true, onlyBackedUp = true)
        assertEquals(listOf("c1", "c2", "w2", "s1"), PhotosVisibility.visible(all, emptySet(), true, onlyBacked, backed).map { it.key })

        val everything = PhotosView(otherApps = true, onlyBackedUp = false)
        assertEquals(listOf("c1", "c2", "w1", "w2", "s1"), PhotosVisibility.visible(all, emptySet(), true, everything, backed).map { it.key })

        val noClutter = everything.copy(hideClutter = true)
        assertEquals(listOf("c1", "c2", "w1", "w2"), PhotosVisibility.visible(all, emptySet(), true, noClutter, backed).map { it.key })

        val noWhatsApp = everything.copy(hiddenApps = setOf("WhatsApp Images"))
        assertEquals(listOf("c1", "c2", "s1"), PhotosVisibility.visible(all, emptySet(), true, noWhatsApp, backed).map { it.key })

        // A chosen backup album is never treated as "another app"
        assertEquals(listOf("w1", "w2"), PhotosVisibility.visible(all, setOf("WhatsApp Images"), true, off, backed).map { it.key })
    }

    @Test
    fun `clutter is screenshots, gifs and memes`() {
        assertTrue(PhotosVisibility.isClutter(shot))
        assertTrue(PhotosVisibility.isClutter(photo("g", "Downloads", name = "funny.GIF")))
        assertTrue(PhotosVisibility.isClutter(photo("m", "Memes")))
        assertFalse(PhotosVisibility.isClutter(camera1))
    }

    @Test
    fun `photos a moment apart stack, videos stand alone`() {
        data class P(val id: String, val at: Long?, val video: Boolean = false)
        val items = listOf(P("a", 10_000), P("b", 9_000), P("c", 7_500), P("d", 1_000), P("v", 900, video = true), P("e", 800), P("f", null), P("g", null))
        val stacks = PhotoStacks.group(items, { it.at }, { it.video })
        assertEquals(listOf(listOf("a", "b", "c"), listOf("d"), listOf("v"), listOf("e"), listOf("f"), listOf("g")), stacks.map { s -> s.map { it.id } })
    }

    @Test
    fun `comfortable mixes rows, big tiles and wide photos`() {
        assertEquals(listOf(TileBlock.Hero("a")), PhotoTiles.comfortable(listOf("a")))
        assertEquals(listOf(TileBlock.Row(listOf("a", "b"), 2)), PhotoTiles.comfortable(listOf("a", "b")))
        val blocks = PhotoTiles.comfortable((1..14).map { "$it" })
        assertEquals(
            listOf(
                TileBlock.Row(listOf("1", "2", "3"), 3),
                TileBlock.Feature("4", listOf("5", "6"), bigOnLeft = false),
                TileBlock.Row(listOf("7", "8", "9"), 3),
                TileBlock.Hero("10"),
                TileBlock.Row(listOf("11", "12", "13"), 3),
                TileBlock.Hero("14"),
            ),
            blocks,
        )
        // Every photo is placed once, in order
        val many = (1..50).map { "$it" }
        val placed = PhotoTiles.comfortable(many).flatMap { b ->
            when (b) {
                is TileBlock.Row -> b.items
                is TileBlock.Hero -> listOf(b.item)
                is TileBlock.Feature -> listOf(b.big) + b.small
            }
        }
        assertEquals(many, placed)
    }

    @Test
    fun `day and month grids are even rows`() {
        assertEquals(listOf(TileBlock.Row(listOf(1, 2, 3), 3), TileBlock.Row(listOf(4), 3)), PhotoTiles.grid(listOf(1, 2, 3, 4), 3))
    }
}
