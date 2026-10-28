package com.backendforge.telestore.core

/** A request the server refused or that never reached it; [message] is fit to show the user. */
open class ApiException(val status: Int, message: String) : Exception(message)

/** The token is missing, expired or signed out: the app goes back to sign-in. */
class UnauthorizedException(message: String = "Please sign in again.") : ApiException(401, message)

/** The server couldn't be reached (no network, wrong address, timeout). */
class NetworkException(message: String, cause: Throwable? = null) : ApiException(0, message) {
    init { cause?.let { initCause(it) } }
}

/** 429: the server is busy with earlier work and asks to try again after [seconds]. */
class RetryLaterException(val seconds: Long, message: String) : ApiException(429, message)

/** 423: the item is protected from deletion (or holds / sits in something protected); the message says which. */
class ProtectedException(message: String) : ApiException(423, message)
