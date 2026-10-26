package com.backendforge.telestore.core

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Pure date parser and formatter for server ISO-8601 timestamps.
 * Older dates without timezone offsets are treated as UTC.
 */
object DateFormatter {
    private val MONTH_DAY = DateTimeFormatter.ofPattern("MMM d", Locale.US)
    private val MONTH_DAY_YEAR = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
    private val FULL_DATETIME = DateTimeFormatter.ofPattern("MMM d, yyyy, h:mm a", Locale.US)

    fun parseIso(raw: String?): ZonedDateTime? {
        if (raw.isNullOrBlank()) return null
        val trimmed = raw.trim()
        return try {
            Instant.parse(trimmed).atZone(ZoneOffset.UTC)
        } catch (_: Exception) {
            try {
                val normalized = trimmed.replace(' ', 'T')
                val hasTz = normalized.endsWith("Z", ignoreCase = true) ||
                    normalized.contains('+') ||
                    (normalized.length > 10 && normalized.indexOf('-', startIndex = 10) != -1)
                if (hasTz) {
                    ZonedDateTime.parse(normalized)
                } else if (normalized.contains('T')) {
                    LocalDateTime.parse(normalized).atZone(ZoneOffset.UTC)
                } else {
                    java.time.LocalDate.parse(normalized).atStartOfDay(ZoneOffset.UTC)
                }
            } catch (_: Exception) {
                null
            }
        }
    }

    /**
     * Formats date for row/card display: "Oct 22" (this year) or "Oct 22, 2025" (different year).
     */
    fun formatShort(
        raw: String?,
        zoneId: ZoneId = ZoneId.systemDefault(),
        currentYear: Int = ZonedDateTime.now(zoneId).year,
    ): String {
        val dt = parseIso(raw)?.withZoneSameInstant(zoneId) ?: return raw?.take(10).orEmpty()
        val formatter = if (dt.year == currentYear) MONTH_DAY else MONTH_DAY_YEAR
        return formatter.format(dt)
    }

    /**
     * Formats date-time for file info / details sheet: "Oct 22, 2026, 2:30 PM".
     */
    fun formatFull(
        raw: String?,
        zoneId: ZoneId = ZoneId.systemDefault(),
    ): String {
        val dt = parseIso(raw)?.withZoneSameInstant(zoneId) ?: return raw.orEmpty()
        return FULL_DATETIME.format(dt)
    }
}
