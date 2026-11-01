package com.backendforge.telestore.core

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.abs

class PhotoEditsTest {
    private fun near(a: Float, b: Float) = abs(a - b) < 0.001f

    @Test
    fun `centred crops fit the photo`() {
        assertEquals(CropRect.FULL, PhotoEdits.centredCrop(CropAspect.FREE, 4000, 3000))
        // Square on a 4:3 landscape photo: 3/4 of the width, in the middle
        val square = PhotoEdits.centredCrop(CropAspect.SQUARE, 4000, 3000)
        assertTrue(near(square.left, 0.125f) && near(square.right, 0.875f) && square.top == 0f && square.bottom == 1f)
        // 16:9 on a landscape 4:3 photo keeps the full width
        val wide = PhotoEdits.centredCrop(CropAspect.SIXTEEN_NINE, 4000, 3000)
        assertTrue(wide.left == 0f && wide.right == 1f && near(wide.height, 0.75f))
        // 16:9 on a portrait photo turns to 9:16
        val tall = PhotoEdits.centredCrop(CropAspect.SIXTEEN_NINE, 2304, 4096)
        assertTrue(tall.top == 0f && tall.bottom == 1f && near(tall.width * 2304 / (tall.height * 4096), 9f / 16f))
    }

    @Test
    fun `corners move within the photo and keep a minimum size`() {
        val moved = PhotoEdits.dragCorner(CropRect.FULL, 0, 0.2f, 0.1f)
        assertEquals(CropRect(0.2f, 0.1f, 1f, 1f), moved)
        val tooFar = PhotoEdits.dragCorner(CropRect.FULL, 2, -2f, -2f)
        assertTrue(near(tooFar.width, 0.08f) && near(tooFar.height, 0.08f))
        val square = PhotoEdits.dragCorner(CropRect(0f, 0f, 0.5f, 0.5f), 2, -0.1f, 0f, ratio = 1f, photoAspect = 1f)
        assertTrue(near(square.width, square.height))
    }

    @Test
    fun `moving the crop stays inside`() {
        val r = CropRect(0.2f, 0.2f, 0.6f, 0.6f)
        assertEquals(CropRect(0.6f, 0f, 1f, 0.4f), PhotoEdits.move(r, 0.9f, -0.5f).let { CropRect(it.left, it.top, it.right, it.bottom) }.let { m ->
            CropRect(Math.round(m.left * 10) / 10f, Math.round(m.top * 10) / 10f, Math.round(m.right * 10) / 10f, Math.round(m.bottom * 10) / 10f)
        })
    }

    @Test
    fun `pixels of a crop`() {
        assertArrayEquals(intArrayOf(500, 0, 3000, 3000), PhotoEdits.pixels(CropRect(0.125f, 0f, 0.875f, 1f), 4000, 3000))
        assertArrayEquals(intArrayOf(3999, 2999, 1, 1), PhotoEdits.pixels(CropRect(1f, 1f, 1f, 1f), 4000, 3000))
    }

    @Test
    fun `no adjustment leaves colours alone`() {
        val identity = floatArrayOf(1f, 0f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 1f, 0f)
        PhotoEdits.colorMatrix(0f, 0f, 0f).forEachIndexed { i, v -> assertTrue(near(v, identity[i]), "at $i: $v") }
        // Brighter adds to every colour; grey (no saturation) gives equal rows
        assertTrue(PhotoEdits.colorMatrix(0.5f, 0f, 0f)[4] > 0f)
        val grey = PhotoEdits.colorMatrix(0f, 0f, -1f)
        assertTrue(near(grey[0], grey[5]) && near(grey[1], grey[6]))
    }
}
