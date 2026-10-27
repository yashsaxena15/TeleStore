package com.backendforge.telestore.ui.components

import java.util.Locale

/** 62.4 GB, 8.1 MB, 512 B — 1 GB is 1024 MB, the same as the website (and Windows, Google Drive). */
fun formatBytes(bytes: Long?): String {
    if (bytes == null || bytes < 0) return ""
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1024.0
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return String.format(Locale.US, if (value >= 100) "%.0f %s" else "%.1f %s", value, units[unit])
}
