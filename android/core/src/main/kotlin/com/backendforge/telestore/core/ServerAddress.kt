package com.backendforge.telestore.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** The TeleStore server the app talks to, e.g. https://telegram.backendforge.qd.je */
object ServerAddress {
    const val DEFAULT = "https://telegram.backendforge.qd.je"

    /**
     * Turns what the user typed into a base URL: adds https:// when missing, drops a trailing
     * slash, path, query and fragment. Returns null when it isn't a usable http(s) address.
     */
    fun normalize(input: String): HttpUrl? {
        val text = input.trim().trimEnd('/')
        if (text.isEmpty() || text.any { it.isWhitespace() }) return null
        val withScheme = if ("://" in text) text else "https://$text"
        val url = withScheme.toHttpUrlOrNull() ?: return null
        if (url.scheme != "https" && url.scheme != "http") return null
        return url.newBuilder().encodedPath("/").query(null).fragment(null).build()
    }
}
