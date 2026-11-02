package com.backendforge.telestore.core

import kotlin.math.max
import kotlin.math.min

/** A crop, in parts of the photo's width and height (0 to 1). */
data class CropRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top

    companion object {
        val FULL = CropRect(0f, 0f, 1f, 1f)
    }
}

/** The crop shapes offered: the photo's own, square, 4:3, 16:9 (width over height). */
enum class CropAspect(val label: String, val ratio: Float?) {
    FREE("Free", null),
    SQUARE("Square", 1f),
    FOUR_THREE("4:3", 4f / 3f),
    SIXTEEN_NINE("16:9", 16f / 9f),
}

/** The basic editor's sums: crop shapes and the colour matrix (pure, so it is tested here). */
object PhotoEdits {
    /** The biggest crop of [aspect] centred on a [width] × [height] photo (all of it for Free). */
    fun centredCrop(aspect: CropAspect, width: Int, height: Int): CropRect {
        val ratio = aspect.ratio ?: return CropRect.FULL
        // A landscape shape on a portrait photo (and the other way) is turned to fit better
        val wanted = if ((ratio > 1f) != (width > height) && ratio != 1f) 1f / ratio else ratio
        val photo = width.toFloat() / height
        return if (photo > wanted) {
            val w = wanted / photo
            CropRect((1 - w) / 2, 0f, (1 + w) / 2, 1f)
        } else {
            val h = photo / wanted
            CropRect(0f, (1 - h) / 2, 1f, (1 + h) / 2)
        }
    }

    /**
     * Moves one corner ([corner]: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) by a
     * drag, keeping the crop at least [minSize] across and, with a [ratio] (width over height in
     * pixels of a [photoAspect] photo), its shape.
     */
    fun dragCorner(rect: CropRect, corner: Int, dx: Float, dy: Float, ratio: Float? = null, photoAspect: Float = 1f, minSize: Float = 0.08f): CropRect {
        var l = rect.left
        var t = rect.top
        var r = rect.right
        var b = rect.bottom
        when (corner) {
            0 -> { l = (l + dx).coerceIn(0f, r - minSize); t = (t + dy).coerceIn(0f, b - minSize) }
            1 -> { r = (r + dx).coerceIn(l + minSize, 1f); t = (t + dy).coerceIn(0f, b - minSize) }
            2 -> { r = (r + dx).coerceIn(l + minSize, 1f); b = (b + dy).coerceIn(t + minSize, 1f) }
            else -> { l = (l + dx).coerceIn(0f, r - minSize); b = (b + dy).coerceIn(t + minSize, 1f) }
        }
        if (ratio != null) {
            // Height follows width: (w × photoAspect) / h = ratio
            val h = ((r - l) * photoAspect / ratio).coerceAtMost(1f)
            if (corner == 0 || corner == 1) t = (b - h).coerceAtLeast(0f) else b = (t + h).coerceAtMost(1f)
            val w = (b - t) * ratio / photoAspect
            if (corner == 0 || corner == 3) l = r - w else r = l + w
        }
        return CropRect(l, t, r, b)
    }

    /** Moves the whole crop by a drag, staying inside the photo. */
    fun move(rect: CropRect, dx: Float, dy: Float): CropRect {
        val x = dx.coerceIn(-rect.left, 1f - rect.right)
        val y = dy.coerceIn(-rect.top, 1f - rect.bottom)
        return CropRect(rect.left + x, rect.top + y, rect.right + x, rect.bottom + y)
    }

    /** The crop in pixels of a [width] × [height] photo: left, top, width, height (at least 1 px). */
    fun pixels(rect: CropRect, width: Int, height: Int): IntArray {
        val left = (rect.left * width).toInt().coerceIn(0, width - 1)
        val top = (rect.top * height).toInt().coerceIn(0, height - 1)
        val w = max(1, min(width - left, (rect.width * width).toInt()))
        val h = max(1, min(height - top, (rect.height * height).toInt()))
        return intArrayOf(left, top, w, h)
    }

    /**
     * The 4 × 5 colour matrix (Android's layout) for brightness, contrast and saturation, each
     * from -1 to 1 (0 changes nothing).
     */
    fun colorMatrix(brightness: Float, contrast: Float, saturation: Float): FloatArray {
        val s = 1f + saturation.coerceIn(-1f, 1f)
        // Saturation (luminance weights as Android's ColorMatrix.setSaturation)
        val lr = 0.213f * (1 - s)
        val lg = 0.715f * (1 - s)
        val lb = 0.072f * (1 - s)
        val sat = floatArrayOf(
            lr + s, lg, lb, 0f, 0f,
            lr, lg + s, lb, 0f, 0f,
            lr, lg, lb + s, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        )
        val c = 1f + contrast.coerceIn(-1f, 1f) * 0.6f
        val offset = 128f * (1 - c) + 100f * brightness.coerceIn(-1f, 1f)
        // Contrast and brightness after saturation
        return FloatArray(20) { i ->
            val row = i / 5
            val col = i % 5
            when {
                row == 3 -> sat[i]
                col < 4 -> sat[i] * c
                else -> sat[i] * c + offset
            }
        }
    }
}
