package com.backendforge.telestore.core

/**
 * Standard places in TeleStore mapping to path and sort rules.
 */
enum class Place(
    val path: String,
    val title: String,
    val defaultSortBy: SortBy,
    val defaultAscending: Boolean,
) {
    HOME(TeleStoreApi.HOME, "Home", SortBy.NAME, true),
    STARRED("starred", "Starred", SortBy.NAME, true),
    RECENT("all", "Recent", SortBy.DATE, false),
    TRASH("trash", "Trash", SortBy.NAME, true),
    INBOX("inbox", "Telegram Inbox", SortBy.NAME, true);

    val isTrash: Boolean get() = this == TRASH
    val isInbox: Boolean get() = this == INBOX
    val isRecent: Boolean get() = this == RECENT
    val isStarred: Boolean get() = this == STARRED
    val isHome: Boolean get() = this == HOME
}

object Places {
    fun fromPath(path: String): Place? = when (path.trimEnd('/')) {
        TeleStoreApi.HOME -> Place.HOME
        "starred" -> Place.STARRED
        "all" -> Place.RECENT
        "trash" -> Place.TRASH
        "inbox" -> Place.INBOX
        else -> null
    }

    fun isSpecial(path: String): Boolean = fromPath(path)?.let { it != Place.HOME } ?: false
}
