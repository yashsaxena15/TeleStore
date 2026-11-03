package com.backendforge.telestore.core

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** What someone a share is shared with can do there. */
enum class ShareAction { OPEN, DOWNLOAD, UPLOAD, NEW_FOLDER, RENAME, MOVE, TRASH }

/** How long a link works, as offered in the Share sheet. */
enum class ExpiryPreset(val label: String, val days: Long?) {
    NEVER("Never", null),
    DAY("1 day", 1),
    WEEK("7 days", 7),
    MONTH("30 days", 30),
}

/** The sharing rules the app's screens follow (the server checks them too). */
object ShareRules {
    private val viewerActions = setOf(ShareAction.OPEN, ShareAction.DOWNLOAD)
    private val editorFolderActions = setOf(ShareAction.UPLOAD, ShareAction.NEW_FOLDER)
    private val editorItemActions = setOf(ShareAction.RENAME, ShareAction.MOVE, ShareAction.TRASH)

    /**
     * What [role] may do in a share. Viewers open and download; editors also change things.
     * Upload and new folder need [isFolderShare]; the shared item itself ([isRoot]) can be renamed
     * but not moved or trashed.
     */
    fun actions(role: ShareRole, isFolderShare: Boolean = true, isRoot: Boolean = false): Set<ShareAction> {
        if (role != ShareRole.EDITOR) return viewerActions
        val out = viewerActions.toMutableSet()
        if (isFolderShare) out += editorFolderActions
        out += if (isRoot) setOf(ShareAction.RENAME) else editorItemActions
        return out
    }

    fun can(role: ShareRole, action: ShareAction, isFolderShare: Boolean = true, isRoot: Boolean = false): Boolean =
        action in actions(role, isFolderShare, isRoot)

    /** Vault and trashed items can't be shared, so Share is hidden for them. */
    fun canShare(item: FileItem): Boolean = !item.inVault && !item.trashed && !item.fromShare

    /** The public page for a link: {server}/s/{token}. */
    fun linkUrl(serverBase: String, token: String): String = serverBase.trimEnd('/') + "/s/" + token

    /** When a link made now with [preset] stops working (ISO, UTC), or null for never. */
    fun expiresAt(preset: ExpiryPreset, now: Instant = Instant.now()): String? =
        preset.days?.let { now.plus(it, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS).toString() }

    /** The link settings for choosing [preset] (Never clears the expiry). */
    fun expirySettings(preset: ExpiryPreset, now: Instant = Instant.now()): LinkSettings =
        expiresAt(preset, now)?.let { LinkSettings(enabled = true, expiresAt = it) } ?: LinkSettings(enabled = true, clearExpiry = true)

    /** The download limit as link settings; null or 0 removes the limit. */
    fun limitSettings(max: Int?): LinkSettings =
        if (max == null || max <= 0) LinkSettings(enabled = true, clearLimit = true) else LinkSettings(enabled = true, maxDownloads = max)

    /** Whether the link is on (in any state but off). */
    fun linkOn(link: ShareLink?): Boolean = link != null && link.enabled

    /** One line about the link: "Anyone with the link can view", "Link expired"… */
    fun linkStateText(link: ShareLink?): String = when {
        link == null || !link.enabled || link.state == "off" -> "Only people added can open"
        link.state == "expired" -> "Link expired"
        link.state == "used_up" -> "Link download limit reached"
        else -> "Anyone with the link can view"
    }

    /** Short state for lists: "Link on", "Link off", "Link expired", "Limit reached". */
    fun linkShortText(link: ShareLink?): String = when {
        link == null || !link.enabled || link.state == "off" -> "Link off"
        link.state == "expired" -> "Link expired"
        link.state == "used_up" -> "Limit reached"
        else -> "Link on"
    }

    /** Shared by me's second line: "2 people · Link on". */
    fun accessSummary(people: Int, link: ShareLink?): String {
        val who = when (people) {
            0 -> "No people"
            1 -> "1 person"
            else -> "$people people"
        }
        return "$who · ${linkShortText(link)}"
    }

    /** "Never expires" or "Expires Nov 12". */
    fun expiryText(expiresAt: String?, zone: ZoneId = ZoneId.systemDefault()): String =
        if (expiresAt.isNullOrBlank()) "Never expires" else "Expires " + DateFormatter.formatShort(expiresAt, zone)

    /** "2 of 5 downloads used", "3 downloads", or "No downloads yet". */
    fun downloadsText(link: ShareLink): String = when {
        link.maxDownloads != null && link.maxDownloads > 0 -> "${link.downloads} of ${link.maxDownloads} downloads used"
        link.downloads == 0 -> "No downloads yet"
        link.downloads == 1 -> "1 download"
        else -> "${link.downloads} downloads"
    }

    // ── Folders inside a share (paths relative to the shared folder) ─────────────
    /** A folder inside [path]: "" + "Day 1" → "/Day 1". */
    fun childPath(path: String, name: String): String = path.trimEnd('/') + "/" + name

    /** The folder above [path] ("" for the shared folder itself). */
    fun parentPath(path: String): String = path.trimEnd('/').substringBeforeLast('/', "")

    /** The breadcrumb: the shared folder's name, then each folder in [path], each with where it goes. */
    fun crumbs(rootName: String, path: String): List<Pair<String, String>> {
        val out = mutableListOf(rootName to "")
        var at = ""
        path.split('/').filter { it.isNotEmpty() }.forEach {
            at = "$at/$it"
            out += it to at
        }
        return out
    }

    /** Where an item in a share is, for "Move": its own folder's path. A folder can't move into itself or below it. */
    fun canMoveTo(item: ShareItem, targetPath: String): Boolean {
        if (targetPath == item.path) return false
        if (!item.isFolder) return true
        val own = childPath(item.path, item.name)
        return targetPath != own && !targetPath.startsWith("$own/")
    }
}
