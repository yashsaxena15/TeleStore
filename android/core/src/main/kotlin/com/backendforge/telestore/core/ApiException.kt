package com.backendforge.telestore.core

/** A request the server refused or that never reached it; [message] is fit to show the user. */
open class ApiException(val status: Int, message: String) : Exception(message)

/** The token is missing, expired or signed out: the app goes back to sign-in. */
class UnauthorizedException(message: String = "Please sign in again.") : ApiException(401, message)

/** The server couldn't be reached (no network, wrong address, timeout). */
class NetworkException(message: String, cause: Throwable? = null) : ApiException(0, message) {
    init { cause?.let { initCause(it) } }
}
