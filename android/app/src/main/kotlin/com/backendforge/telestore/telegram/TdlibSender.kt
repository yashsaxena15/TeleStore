package com.backendforge.telestore.telegram

import com.backendforge.telestore.core.ChunkSource
import com.backendforge.telestore.core.TelegramSender
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.drinkless.tdlib.TdApi
import java.io.File
import java.io.RandomAccessFile

/**
 * Sends a file or one part of it to the storage channel with the phone's own Telegram account.
 * TDLib sends files from a path: a whole gallery photo or video goes from its own file; otherwise
 * (one part of a big file, or a file the app can't read directly) the bytes are first copied into
 * the app's cache, at most one part at a time, and that copy is deleted afterwards.
 */
class TdlibSender(private val tg: TelegramAccount, private val cacheDir: File) : TelegramSender {
    override suspend fun send(chatId: Long, source: ChunkSource, start: Long, length: Long, fileName: String, caption: String,
                              onProgress: (Long) -> Unit): Long = withContext(Dispatchers.IO) {
        tg.ensureChat(chatId)
        val own = source.localPath?.takeIf { start == 0L && File(it).length() == length }
        val copy = if (own == null) copyPart(source, start, length, fileName) else null
        try {
            val content = TdApi.InputMessageDocument(
                TdApi.InputDocument(TdApi.InputFileLocal(own ?: copy!!.path), null, true),
                TdApi.FormattedText(caption, arrayOf()),
            )
            val pending = tg.send(TdApi.SendMessage(chatId, null, null, null, null, content))
            val fileId = (pending.content as? TdApi.MessageDocument)?.document?.document?.id
            val done = try {
                tg.awaitSent(pending, fileId, onProgress)
            } catch (e: kotlinx.coroutines.CancellationException) {
                // Stopped: take the half-sent message back so it doesn't stay in the channel
                withContext(NonCancellable) { runCatching { tg.send(TdApi.DeleteMessages(chatId, longArrayOf(pending.id), true)) } }
                throw e
            }
            TgIds.toServer(done.id)
        } finally {
            copy?.delete()
        }
    }

    private fun copyPart(source: ChunkSource, start: Long, length: Long, fileName: String): File {
        val dir = File(cacheDir, "telegram-upload").apply { mkdirs() }
        if (dir.usableSpace < length + RESERVE) {
            throw TgException(0, "Not enough free space on the phone to send this straight to Telegram.")
        }
        val out = File(dir, "${System.nanoTime()}-${fileName.replace('/', '_')}")
        val buffer = ByteArray(BUFFER)
        RandomAccessFile(out, "rw").use { file ->
            var done = 0L
            while (done < length) {
                val n = minOf(BUFFER.toLong(), length - done).toInt()
                source.read(start + done, n, buffer)
                file.write(buffer, 0, n)
                done += n
            }
        }
        return out
    }

    private companion object {
        const val BUFFER = 4 * 1024 * 1024
        const val RESERVE = 300L * 1024 * 1024
    }
}
