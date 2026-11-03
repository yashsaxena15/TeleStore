package com.backendforge.telestore.core

import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** What the small cards on Home say under their picture. */
object HomeCards {
    private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    private val MONTH_DAY = DateTimeFormatter.ofPattern("MMM d", Locale.US)
    private val MONTH_DAY_YEAR = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)

    /**
     * Names a camera or the phone makes up ("IMG_20261029_174512.jpg", "PXL_20261029…",
     * "Screenshot_20261029-…"): they say nothing a person can read, so the card shows when it was taken.
     */
    private val CAMERA_NAME = Regex(
        "^(IMG|VID|PXL|DSC|DSCN|MVIMG|PANO|BURST|Screenshot|Screen_Recording)[ _-]?.*\\d{6,}.*",
        RegexOption.IGNORE_CASE,
    )

    /** True for "IMG_20261029_174512.jpg" and the like; false for names a person chose. */
    fun isCameraName(name: String): Boolean = CAMERA_NAME.matches(name.substringBeforeLast('.'))

    /**
     * The line under a recent item on Home: photos (and anything with a camera-made name) show
     * when they were taken ("Today, 5:12 PM", "Yesterday, 9:03 AM", "Oct 29"); other files show
     * their name. Empty when there's nothing worth saying, so the card shows just the picture.
     */
    fun recentLabel(
        item: FileItem,
        now: ZonedDateTime = ZonedDateTime.now(),
        zoneId: ZoneId = now.zone,
    ): String {
        val byDate = item.kind == FileKind.PHOTO || isCameraName(item.name)
        if (!byDate) return item.name
        val taken = DateFormatter.parseIso(item.timelineDate)?.withZoneSameInstant(zoneId) ?: return ""
        val today = now.withZoneSameInstant(zoneId).toLocalDate()
        val day = taken.toLocalDate()
        return when {
            day == today -> "Today, ${TIME.format(taken)}"
            day == today.minusDays(1) -> "Yesterday, ${TIME.format(taken)}"
            day.year == today.year -> MONTH_DAY.format(taken)
            else -> MONTH_DAY_YEAR.format(taken)
        }
    }
}
