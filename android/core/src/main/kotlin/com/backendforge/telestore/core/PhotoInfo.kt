package com.backendforge.telestore.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * A photo's details, read on the phone (EXIF) or by the server (GET /files/{id}/photo-info).
 * Every field may be missing.
 */
data class PhotoInfo(
    val width: Int? = null,
    val height: Int? = null,
    val megapixels: Double? = null,
    val cameraMake: String? = null,
    val cameraModel: String? = null,
    val lens: String? = null,
    /** The f-number (1.8 for f/1.8). */
    val aperture: Double? = null,
    /** Exposure time in seconds (1/120 s is 0.00833). */
    val exposure: Double? = null,
    val iso: Int? = null,
    /** Focal length in millimetres. */
    val focalLength: Double? = null,
    /** "Flash fired", "No flash"… */
    val flash: String? = null,
    /** ISO-8601 ("2024-05-01T10:20:30", with or without an offset). */
    val takenAt: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val altitude: Double? = null,
    /** "JPEG", "HEIC"… */
    val format: String? = null,
    val fileSize: Long? = null,
    val fileName: String? = null,
    val folder: String? = null,
) {
    val hasLocation: Boolean get() = latitude != null && longitude != null && !(latitude == 0.0 && longitude == 0.0)

    companion object {
        /** The server's reply; numbers may come as numbers or text ("f/1.8", "1/120"). */
        fun fromJson(o: JsonObject): PhotoInfo {
            fun text(key: String): String? = (o[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull?.trim()?.ifBlank { null }
            fun number(key: String): Double? = PhotoDetails.parseNumber(o[key])
            val flash = (o["flash"] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.let { p ->
                if (p.isString) p.content.ifBlank { null }
                else p.booleanOrNull?.let { if (it) "Flash fired" else "No flash" }
                    ?: p.doubleOrNull?.let { PhotoDetails.flashLabel(it.toInt()) }
            }
            return PhotoInfo(
                width = number("width")?.toInt(),
                height = number("height")?.toInt(),
                megapixels = number("megapixels"),
                cameraMake = text("camera_make"),
                cameraModel = text("camera_model"),
                lens = text("lens"),
                aperture = number("aperture"),
                exposure = number("exposure"),
                iso = number("iso")?.toInt(),
                focalLength = number("focal_length"),
                flash = flash,
                takenAt = text("taken_at"),
                latitude = number("latitude"),
                longitude = number("longitude"),
                altitude = number("altitude"),
                format = text("format"),
                fileSize = number("file_size")?.toLong(),
                fileName = text("file_name"),
                folder = text("folder"),
            )
        }
    }
}

/** How the photo details sheet words a [PhotoInfo]. */
object PhotoDetails {
    private val TAKEN = DateTimeFormatter.ofPattern("EEE, MMM d, yyyy · h:mm a", Locale.US)

    /** "12.2 MP · 4032 × 3024" (either half alone when the other is unknown). */
    fun resolution(info: PhotoInfo): String? {
        val w = info.width?.takeIf { it > 0 }
        val h = info.height?.takeIf { it > 0 }
        val size = if (w != null && h != null) "$w × $h" else null
        val mp = info.megapixels?.takeIf { it > 0 }
            ?: if (w != null && h != null) w.toDouble() * h / 1_000_000.0 else null
        val mpLabel = mp?.let { "${decimal(it, 1)} MP" }
        return listOfNotNull(mpLabel, size).joinToString(" · ").ifBlank { null }
    }

    /** "f/1.8" */
    fun aperture(f: Double?): String? = f?.takeIf { it > 0 }?.let { "f/${decimal(it, 1)}" }

    /** "1/120 s" for short exposures, "2 s" / "1.5 s" for long ones. */
    fun exposure(seconds: Double?): String? {
        val s = seconds?.takeIf { it > 0 } ?: return null
        if (s >= 1) return "${decimal(s, 1)} s"
        val denominator = (1 / s).roundToLong()
        return "1/$denominator s"
    }

    fun iso(iso: Int?): String? = iso?.takeIf { it > 0 }?.let { "ISO $it" }

    /** "4.2 mm" */
    fun focalLength(mm: Double?): String? = mm?.takeIf { it > 0 }?.let { "${decimal(it, 1)} mm" }

    /** "f/1.8 · 1/120 s · ISO 100 · 4.2 mm" */
    fun exposureLine(info: PhotoInfo): String? =
        listOfNotNull(aperture(info.aperture), exposure(info.exposure), iso(info.iso), focalLength(info.focalLength))
            .joinToString(" · ").ifBlank { null }

    /** "Apple iPhone 13" — without repeating the maker when the model already names it. */
    fun camera(make: String?, model: String?): String? {
        val m = make?.trim()?.ifBlank { null }
        val mo = model?.trim()?.ifBlank { null }
        return when {
            m == null -> mo
            mo == null -> m
            mo.startsWith(m, ignoreCase = true) -> mo
            else -> "$m $mo"
        }
    }

    /** "15.5527° N, 73.7517° E" */
    fun coordinates(latitude: Double, longitude: Double): String {
        val ns = if (latitude < 0) "S" else "N"
        val ew = if (longitude < 0) "W" else "E"
        return String.format(Locale.US, "%.4f° %s, %.4f° %s", abs(latitude), ns, abs(longitude), ew)
    }

    /** For "Open in Maps": geo:lat,lng?q=lat,lng */
    fun mapsUri(latitude: Double, longitude: Double): String {
        val ll = String.format(Locale.US, "%.6f,%.6f", latitude, longitude)
        return "geo:$ll?q=$ll"
    }

    /** EXIF flash code: bit 0 says whether it fired. */
    fun flashLabel(code: Int): String = if (code and 1 == 1) "Flash fired" else "No flash"

    /** EXIF "2024:05:01 10:20:30" → "2024-05-01T10:20:30" (null when it isn't a date). */
    fun exifDate(raw: String?): String? {
        val t = raw?.trim()?.takeIf { it.length >= 19 } ?: return null
        val iso = t.substring(0, 10).replace(':', '-') + "T" + t.substring(11, 19)
        return runCatching { LocalDateTime.parse(iso) }.getOrNull()?.let { iso }
    }

    /**
     * "Wed, May 1, 2024 · 10:20 AM". A time without an offset is shown as written (cameras store
     * local time); one with an offset is shown in [zone].
     */
    fun takenLabel(raw: String?, zone: ZoneId = ZoneId.systemDefault()): String? {
        val t = raw?.trim()?.ifBlank { null } ?: return null
        if (!hasOffset(t)) {
            val local = runCatching { LocalDateTime.parse(t.replace(' ', 'T')) }.getOrNull()
            if (local != null) return TAKEN.format(local)
        }
        val zoned = DateFormatter.parseIso(t)?.withZoneSameInstant(zone) ?: return t
        return TAKEN.format(zoned)
    }

    private fun hasOffset(t: String): Boolean =
        t.endsWith("Z", ignoreCase = true) || t.contains('+') || (t.length > 10 && t.indexOf('-', startIndex = 10) != -1)

    /** A number from JSON, either as a number or text like "f/1.8", "1/120", "4.2 mm". */
    internal fun parseNumber(e: JsonElement?): Double? {
        val p = e as? JsonPrimitive ?: return null
        if (p is JsonNull) return null
        if (!p.isString) return p.doubleOrNull
        return parseText(p.content)
    }

    /** "1/120" → 0.00833, "f/1.8" → 1.8, "4.2 mm" → 4.2. */
    fun parseText(raw: String): Double? {
        val t = raw.trim().removePrefix("f/").removePrefix("F/").removeSuffix("mm").removeSuffix("s").trim()
        val slash = t.indexOf('/')
        if (slash > 0) {
            val a = t.substring(0, slash).trim().toDoubleOrNull() ?: return null
            val b = t.substring(slash + 1).trim().toDoubleOrNull()?.takeIf { it != 0.0 } ?: return null
            return a / b
        }
        return t.toDoubleOrNull()
    }

    /** One decimal place at most, without a trailing ".0": 1.8, 2, 12.2. */
    private fun decimal(v: Double, places: Int): String {
        val s = String.format(Locale.US, "%.${places}f", v)
        return if (s.contains('.')) s.trimEnd('0').trimEnd('.') else s
    }
}
