package com.backendforge.telestore.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** A photo or video on this phone, as the Photos timeline needs it (kept free of Android types). */
data class LocalPhoto(
    /** The backup's key for it (MediaStore id, size, modified time). */
    val key: String,
    val name: String,
    val size: Long,
    /** When it was taken, in epoch milliseconds (0 when unknown). */
    val takenAtMillis: Long,
    val video: Boolean,
    /** Its content:// address. */
    val uri: String,
    val bucketId: String = "",
    val bucket: String = "",
)

/** One tile of the Photos timeline: the backed-up copy, the copy on this phone, or both. */
data class PhotoEntry(
    val server: FileItem?,
    val local: LocalPhoto?,
    val backedUp: Boolean,
    /** When it was taken (the server's date first), for ordering; null when undated. Worked out once: sorting asks often. */
    val takenAtMillis: Long? = server?.let { PhotoMerge.millisOf(it) } ?: local?.takenAtMillis?.takeIf { it > 0 },
) {
    /** The server id when there is a server copy (so selection and server actions keep working), else the phone's key. */
    val id: String get() = server?.id ?: "$LOCAL_PREFIX${local?.key}"
    val name: String get() = local?.name ?: server?.name.orEmpty()
    val video: Boolean get() = local?.video ?: (server?.kind == FileKind.VIDEO)
    val starred: Boolean get() = server?.starred == true
    /** Only on this phone, not (yet) in TeleStore. */
    val phoneOnly: Boolean get() = server == null

    fun date(zone: ZoneId = ZoneId.systemDefault()): LocalDate? =
        takenAtMillis?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() }

    companion object {
        const val LOCAL_PREFIX = "local:"
    }
}

/** A day of the merged timeline. */
data class PhotoDay(val date: LocalDate?, val label: String, val entries: List<PhotoEntry>)

/**
 * Puts the phone's photos and videos together with the backed-up ones, like Google Photos (pure,
 * so it is tested here). A phone item and a server file are the same photo when name and size
 * match, the rule the backup itself uses to skip what is already there.
 */
object PhotoMerge {
    fun millisOf(item: FileItem): Long? = DateFormatter.parseIso(item.timelineDate)?.toInstant()?.toEpochMilli()

    /**
     * Newest first. [server] arrives a page at a time while the phone's items are all known at
     * once: while [serverHasMore], phone-only items older than the oldest loaded server item wait
     * for the next page, so a photo never jumps up when later pages arrive. With no server page
     * yet (and more to come) only the phone items matching nothing wait: none are shown.
     */
    fun merge(server: List<FileItem>, local: List<LocalPhoto>, backedUpKeys: Set<String>, serverHasMore: Boolean): List<PhotoEntry> {
        // name|size -> the phone items with it (the same name and size twice is rare, each matches once)
        val byNameSize = HashMap<String, ArrayDeque<LocalPhoto>>()
        local.forEach { byNameSize.getOrPut("${it.name}|${it.size}") { ArrayDeque() }.addLast(it) }
        val matched = HashSet<String>()
        val out = ArrayList<PhotoEntry>(server.size + local.size)
        server.forEach { item ->
            val twin = byNameSize["${item.name}|${item.size ?: -1}"]?.removeFirstOrNull()
            if (twin != null) matched += twin.key
            out += PhotoEntry(item, twin, backedUp = true)
        }
        val cutoff: Long? = when {
            !serverHasMore -> null
            server.isEmpty() -> Long.MAX_VALUE
            else -> out.mapNotNull { it.takenAtMillis }.minOrNull()
        }
        local.forEach { photo ->
            if (photo.key in matched) return@forEach
            if (cutoff != null && photo.takenAtMillis < cutoff) return@forEach
            out += PhotoEntry(null, photo, backedUp = photo.key in backedUpKeys)
        }
        // Undated last; ties keep the server's order, then the phone's
        return out.sortedWith(compareByDescending<PhotoEntry, Long?>(nullsFirst()) { it.takenAtMillis })
    }

    /** Newest day first, labelled like the server-only timeline ("Today", "Sat, 24 Oct"). */
    fun days(entries: List<PhotoEntry>, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): List<PhotoDay> {
        val groups = LinkedHashMap<LocalDate?, MutableList<PhotoEntry>>()
        entries.forEach { groups.getOrPut(it.date(zone)) { mutableListOf() } += it }
        return groups.map { (date, list) -> PhotoDay(date, Timeline.label(date, today), list) }
    }
}
