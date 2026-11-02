package com.backendforge.telestore.core

import kotlinx.serialization.Serializable

/** Google Photos' three ways to lay out the timeline. */
enum class PhotosLayout(val label: String) {
    /** Big and small tiles mixed, day by day. */
    COMFORTABLE("Comfortable"),
    /** Even rows of 3, day by day. */
    DAY("Day"),
    /** Small rows of 5, month by month. */
    MONTH("Month"),
    ;

    /** Pinching out shows bigger photos: Month → Day → Comfortable (and back pinching in). */
    fun bigger(): PhotosLayout = when (this) { MONTH -> DAY; DAY, COMFORTABLE -> COMFORTABLE }
    fun smaller(): PhotosLayout = when (this) { COMFORTABLE -> DAY; DAY, MONTH -> MONTH }
}

/** The "Photos view" page's choices. */
@Serializable
data class PhotosView(
    val layout: PhotosLayout = PhotosLayout.DAY,
    /** Photos taken a moment apart show as one tile with a count. */
    val stackSimilar: Boolean = false,
    /** Phone albums besides the backed-up ones (WhatsApp, Screenshots…) show too. */
    val otherApps: Boolean = true,
    /** …but only their photos that are backed up (or waiting to be). */
    val onlyBackedUp: Boolean = true,
    /** Screenshots, GIFs and memes from other apps go once they're backed up. */
    val hideClutter: Boolean = false,
    /** Phone albums (bucket ids) turned off in "Customize by app". */
    val hiddenApps: Set<String> = emptySet(),
)

/** Which of the phone's photos Photos shows (pure, so it is tested here). */
object PhotosVisibility {
    private val CLUTTER = listOf("screenshot", "screen recording", "screenrecord", "gif", "meme", "sticker")

    /** A screenshot, GIF or meme (by album or file name). */
    fun isClutter(photo: LocalPhoto): Boolean {
        val bucket = photo.bucket.lowercase()
        val name = photo.name.lowercase()
        return CLUTTER.any { it in bucket } || name.endsWith(".gif") || name.startsWith("screenshot")
    }

    /**
     * The backup albums always show. Other apps' albums show when [view] allows: not turned off one
     * by one, only their backed-up items if asked, and clutter hidden once it's backed up.
     */
    fun visible(local: List<LocalPhoto>, backupAlbums: Set<String>, includeVideos: Boolean, view: PhotosView, backedUp: Set<String>): List<LocalPhoto> {
        val chosen = backupAlbums.ifEmpty { setOfNotNull(PhotoMerge.defaultAlbum(local)) }
        val own = local.filter { it.bucketId in chosen && (includeVideos || !it.video) }
        if (!view.otherApps) return own
        val others = local.filter { p ->
            p.bucketId !in chosen && p.bucketId !in view.hiddenApps &&
                (!view.onlyBackedUp || p.key in backedUp) &&
                !(view.hideClutter && p.key in backedUp && isClutter(p))
        }
        return own + others
    }
}

/** Similar photos taken a moment apart, shown as one tile (pure, so it is tested here). */
object PhotoStacks {
    /**
     * Groups neighbours (the list is newest first) taken within [gapMillis] of each other into
     * stacks. Videos and undated items always stand alone.
     */
    fun <T> group(items: List<T>, takenAt: (T) -> Long?, isVideo: (T) -> Boolean, gapMillis: Long = 2_000): List<List<T>> {
        val out = mutableListOf<MutableList<T>>()
        var lastTime: Long? = null
        for (item in items) {
            val time = takenAt(item)
            val current = out.lastOrNull()
            val joins = current != null && time != null && lastTime != null && !isVideo(item) && !isVideo(current.last()) &&
                kotlin.math.abs(lastTime - time) <= gapMillis
            if (joins) current!!.add(item) else out.add(mutableListOf(item))
            lastTime = time
        }
        return out
    }
}

/** One row of the timeline's tiles. */
sealed interface TileBlock<T> {
    /** Squares side by side; [columns] slots (a short last row leaves the rest empty). */
    data class Row<T>(val items: List<T>, val columns: Int) : TileBlock<T>
    /** One photo across the whole width. */
    data class Hero<T>(val item: T) : TileBlock<T>
    /** A big square (2 × 2) beside two small ones stacked; the big one on the left or right. */
    data class Feature<T>(val big: T, val small: List<T>, val bigOnLeft: Boolean) : TileBlock<T>
}

/** Arranges a day's (or month's) tiles into rows for each layout (pure, so it is tested here). */
object PhotoTiles {
    fun <T> grid(items: List<T>, columns: Int): List<TileBlock<T>> =
        items.chunked(columns).map { TileBlock.Row(it, columns) }

    /**
     * Comfortable: rows of 3, a big tile beside two small ones, a wide photo, in turn, so a long
     * day reads like Google Photos. One photo is shown wide, two side by side.
     */
    fun <T> comfortable(items: List<T>): List<TileBlock<T>> {
        val out = mutableListOf<TileBlock<T>>()
        var i = 0
        var step = 0
        while (i < items.size) {
            val left = items.size - i
            when {
                left == 1 -> { out += TileBlock.Hero(items[i]); i += 1 }
                left == 2 -> { out += TileBlock.Row(items.subList(i, i + 2), 2); i += 2 }
                else -> {
                    when (step % 6) {
                        1 -> { out += TileBlock.Feature(items[i], items.subList(i + 1, i + 3), bigOnLeft = false); i += 3 }
                        3 -> if (left >= 4) { out += TileBlock.Hero(items[i]); i += 1 } else { out += TileBlock.Row(items.subList(i, i + 3), 3); i += 3 }
                        5 -> { out += TileBlock.Feature(items[i], items.subList(i + 1, i + 3), bigOnLeft = true); i += 3 }
                        else -> { out += TileBlock.Row(items.subList(i, i + 3), 3); i += 3 }
                    }
                    step++
                }
            }
        }
        return out
    }
}
