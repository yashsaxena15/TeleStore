package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** GET /vault/status. */
@Serializable
data class VaultStatus(
    @SerialName("is_setup") val isSetup: Boolean = false,
    @SerialName("is_unlocked") val isUnlocked: Boolean = false,
    /** The recovery email, partly hidden (ya***28@gmail.com). */
    val email: String? = null,
    @SerialName("remaining_seconds") val remainingSeconds: Int = 0,
    @SerialName("auto_lock_minutes") val autoLockMinutes: Int = 15,
)

/** Cookies for this app run only (never written to disk). */
class MemoryCookieJar : CookieJar {
    private val cookies = mutableMapOf<String, Cookie>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { c -> if (c.expiresAt < System.currentTimeMillis()) this.cookies.remove(key(c)) else this.cookies[key(c)] = c }
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        this.cookies.values.removeAll { it.expiresAt < now }
        return cookies.values.filter { it.matches(url) }
    }

    @Synchronized
    fun clear() = cookies.clear()

    private fun key(c: Cookie) = "${c.domain}|${c.path}|${c.name}"
}

/** A 4-digit PIN, as the server requires. */
object VaultPin {
    fun isValid(pin: String) = pin.length == 4 && pin.all { it.isDigit() }
}
