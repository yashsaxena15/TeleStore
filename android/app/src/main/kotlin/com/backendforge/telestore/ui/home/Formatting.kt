package com.backendforge.telestore.ui.home

import java.util.Locale

/** 62.4 GB, 8.1 MB, 512 B — the same units as the website. */
fun formatBytes(bytes: Long?): String {
    if (bytes == null || bytes < 0) return ""
    if (bytes < 1000) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1000.0
    var unit = 0
    while (value >= 1000 && unit < units.lastIndex) {
        value /= 1000
        unit++
    }
    return String.format(Locale.US, if (value >= 100) "%.0f %s" else "%.1f %s", value, units[unit])
}
