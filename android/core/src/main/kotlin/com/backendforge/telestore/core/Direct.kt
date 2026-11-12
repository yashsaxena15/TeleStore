package com.backendforge.telestore.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Straight from Telegram (November 2026): with the person's own Telegram account signed in on the
 * phone (TDLib), uploads, backup, playback and downloads of their own files go between the phone and
 * their storage channel, without passing through the TeleStore server. The server only says where a
 * file goes (/direct/prepare), saves it once its messages are there (/direct/complete), and says
 * which messages hold a file (/direct/locate). The same endpoints as the Windows app.
 */

/** The Telegram app ID the phone signs in to Telegram with. */
@Serializable
data class DirectConfig(
    @SerialName("api_id") val apiId: Int,
    @SerialName("api_hash") val apiHash: String,
    @SerialName("part_size") val partSize: Long = DirectRules.PART_SIZE,
)

/** One message a file becomes: the whole file, or one 1.95 GB part of a big one. */
@Serializable
data class DirectPart(
    @SerialName("part_index") val index: Int,
    val start: Long,
    val length: Long,
    @SerialName("file_name") val fileName: String,
    val caption: String,
)

/** Where a new file goes and how it is cut. */
@Serializable
data class DirectPlan(
    @SerialName("chat_id") val chatId: Long,
    val path: String,
    @SerialName("file_name") val fileName: String,
    @SerialName("file_size") val fileSize: Long,
    @SerialName("total_parts") val totalParts: Int = 1,
    val parts: List<DirectPart>,
)

/** One message holding (part of) an existing file. */
@Serializable
data class DirectPlace(
    @SerialName("chat_id") val chatId: Long,
    @SerialName("message_id") val messageId: Long,
    val size: Long,
    val start: Long = 0,
)

/** What /direct/complete answers: the saved file (its id, to open it later). */
@Serializable
data class DirectSaved(val message: String? = null, val file: SavedFile? = null) {
    @Serializable
    data class SavedFile(val id: String, @SerialName("file_name") val name: String = "")
}

/** Which messages hold one of the person's own files. */
@Serializable
data class DirectLocation(
    val id: String,
    val name: String,
    val size: Long,
    val parts: List<DirectPlace>,
) {
    /** The parts (and where in each) that hold bytes [from, from + length) of the file. */
    fun spans(from: Long, length: Long): List<Span> {
        val end = if (length < 0) size else minOf(size, from + length)
        return parts.filter { it.start < end && it.start + it.size > from }.map { p ->
            val lo = maxOf(from, p.start) - p.start
            val hi = minOf(end, p.start + p.size) - p.start
            Span(p, lo, hi - lo)
        }
    }

    data class Span(val place: DirectPlace, val offset: Long, val length: Long)
}

object DirectRules {
    const val PART_SIZE = 1950L * 1024 * 1024

    /** Whether a file can come straight from Telegram (else it goes through TeleStore, as before). */
    fun canOpenDirect(item: FileItem, signedIn: Boolean, enabled: Boolean): Boolean =
        signedIn && enabled && !item.isFolder && item.shareId == null && !item.isVault &&
            !item.path.equals(TeleStoreApi.VAULT, ignoreCase = true) && !item.path.startsWith(TeleStoreApi.VAULT + "/", ignoreCase = true)

    /** Whether an upload into [folder] can go straight to Telegram. */
    fun canUploadDirect(folder: String, signedIn: Boolean, enabled: Boolean, size: Long): Boolean =
        signedIn && enabled && size > 0 && !folder.equals(TeleStoreApi.VAULT, ignoreCase = true) &&
            !folder.startsWith(TeleStoreApi.VAULT + "/", ignoreCase = true)
}


/** Sends bytes to the storage channel with the phone's own Telegram account (TDLib on Android). */
interface TelegramSender {
    /**
     * Sends [length] bytes at [start] of [source] to [chatId] as a document called [fileName] with
     * [caption], and returns its message id as the server knows it. [onProgress] gets the bytes sent so far.
     */
    suspend fun send(chatId: Long, source: ChunkSource, start: Long, length: Long, fileName: String, caption: String,
                     onProgress: (Long) -> Unit): Long
}

/**
 * Uploads a file straight to the storage channel: asks the server where it goes, sends its parts
 * one at a time (each remembered with [onPartSent], so a later run sends only what's missing), then
 * asks the server to save it. The same steps as the Windows app.
 */
class DirectUploader(
    private val api: TeleStoreApi,
    private val sender: TelegramSender,
    private val source: ChunkSource,
    private val name: String,
    private val size: Long,
    private val folder: String,
    private val takenAt: String? = null,
    private val sentBefore: Map<Int, Long> = emptyMap(),
    private val onPartSent: (index: Int, messageId: Long) -> Unit = { _, _ -> },
    private val onProgress: (sentBytes: Long) -> Unit = {},
    private val onSaving: () -> Unit = {},
) {
    suspend fun upload(): String? {
        require(size > 0) { "Empty files can't be uploaded." }
        val plan = api.directPrepare(folder, name, size)
        val messages = sentBefore.filterKeys { index -> plan.parts.any { it.index == index } }.toMutableMap()
        var base = plan.parts.filter { it.index in messages }.sumOf { it.length }
        onProgress(base)
        for (part in plan.parts.sortedBy { it.index }) {
            if (part.index in messages) continue
            val id = sender.send(plan.chatId, source, part.start, part.length, part.fileName, part.caption) { onProgress(base + it) }
            messages[part.index] = id
            onPartSent(part.index, id)
            base += part.length
            onProgress(base)
        }
        onSaving()
        return try {
            api.directComplete(plan.path, plan.fileName, size, messages, takenAt).file?.id
        } catch (e: ApiException) {
            if (e.status == 409) null else throw e // 409: saved already (the app stopped right after saving it)
        }
    }
}
