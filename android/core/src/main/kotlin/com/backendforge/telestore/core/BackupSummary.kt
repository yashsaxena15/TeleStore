package com.backendforge.telestore.core

/** The ring around the account picture in Photos: how the phone backup is doing. */
enum class BackupRing { RUNNING, OK, WAITING, PROBLEM, OFF }

/** Turns the backup's status into the Photos ring and its one-line summary (pure, so it is tested here). */
object BackupSummary {
    /** Paused (Wi-Fi or charging went away) or waiting for the connection: it continues by itself. */
    fun isWaiting(message: String?): Boolean =
        message != null && (message.startsWith("Paused") || message.startsWith("Waiting"))

    fun ring(enabled: Boolean, running: Boolean, message: String?): BackupRing = when {
        !enabled -> BackupRing.OFF
        running -> BackupRing.RUNNING
        message == null -> BackupRing.OK
        isWaiting(message) -> BackupRing.WAITING
        else -> BackupRing.PROBLEM
    }

    /** "Backing up 3 of 40", "Backed up · 5 min ago", "Backup is off", or the problem itself. */
    fun line(enabled: Boolean, running: Boolean, done: Int, pending: Int, lastRun: Long, message: String?, now: Long): String = when {
        !enabled -> "Backup is off"
        running -> {
            val total = done + pending
            if (total > 0) "Backing up ${(done + 1).coerceAtMost(total)} of $total" else "Backing up…"
        }
        message != null -> message
        lastRun > 0 -> "Backed up · ${ago(lastRun, now)}"
        else -> "Waiting to start…"
    }

    /** "just now", "5 min ago", "3 h ago", "2 days ago". */
    fun ago(at: Long, now: Long): String {
        val minutes = ((now - at) / 60_000).coerceAtLeast(0)
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            minutes < 24 * 60 -> "${minutes / 60} h ago"
            minutes < 2 * 24 * 60 -> "yesterday"
            else -> "${minutes / (24 * 60)} days ago"
        }
    }
}
