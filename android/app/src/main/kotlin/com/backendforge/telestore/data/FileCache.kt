package com.backendforge.telestore.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKinds
import com.backendforge.telestore.core.NetworkException
import com.backendforge.telestore.core.TeleStoreApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.IOException

/** A file on the phone, ready to read or hand to another app. */
data class LocalFile(val uri: Uri, val file: File?, val mime: String)

/**
 * Brings a file to the phone to show it, share it or open it in another app. A downloaded copy
 * (Transfers) is used as is; otherwise it goes to the app's cache, which keeps at most [MAX_BYTES]
 * (oldest removed first) and is only readable by other apps through a share or open.
 */
class FileCache(private val context: Context, private val api: () -> TeleStoreApi, private val offlineCopy: (String) -> Uri?) {
    private val dir get() = File(context.cacheDir, "open")

    suspend fun fetch(item: FileItem, onProgress: (Float) -> Unit = {}): LocalFile = withContext(Dispatchers.IO) {
        val mime = mimeOf(item.name)
        offlineCopy(item.id)?.let { return@withContext LocalFile(it, null, mime) }
        // The id keeps two files of the same name apart; the name stays readable in other apps.
        // Vault files go in their own folder, wiped whenever the vault locks.
        val parent = if (isVault(item)) File(dir, VAULT_DIR) else dir
        val target = File(File(parent, item.id.filter { it.isLetterOrDigit() }), safeName(item.name))
        val size = item.size ?: -1
        if (!(target.exists() && (size < 0 || target.length() == size))) download(item, target, onProgress)
        target.setLastModified(System.currentTimeMillis())
        trim(keep = target)
        LocalFile(FileProvider.getUriForFile(context, "${context.packageName}.files", target), target, mime)
    }

    private suspend fun download(item: FileItem, target: File, onProgress: (Float) -> Unit) {
        target.parentFile?.mkdirs()
        val part = File(target.parentFile, target.name + ".part")
        val request = Request.Builder().url(api().media.file(item, inline = false)).build()
        try {
            api().http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("The server answered ${response.code}.")
                val body = response.body ?: throw IOException("The server sent nothing.")
                val total = body.contentLength().takeIf { it > 0 } ?: item.size ?: -1
                body.byteStream().use { input ->
                    part.outputStream().use { out ->
                        val buffer = ByteArray(256 * 1024)
                        var done = 0L
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = input.read(buffer)
                            if (n < 0) break
                            out.write(buffer, 0, n)
                            done += n
                            if (total > 0) onProgress((done.toFloat() / total).coerceIn(0f, 1f))
                        }
                    }
                }
            }
            if (!part.renameTo(target)) throw IOException("Couldn't save the file on the phone.")
        } catch (e: IOException) {
            part.delete()
            throw NetworkException("Couldn't get ${item.name}: ${e.message ?: "connection lost"}", e)
        } finally {
            if (part.exists() && !target.exists()) part.delete()
        }
    }

    /** Removes everything fetched (signing out). */
    fun clear() {
        dir.deleteRecursively()
    }

    /** Removes every vault file fetched to the phone (the vault locked, or the app started). */
    fun forgetVault() {
        File(dir, VAULT_DIR).deleteRecursively()
    }

    private fun isVault(item: FileItem): Boolean {
        val path = item.path.trim('/')
        return path == "Vault" || path.startsWith("Vault/")
    }

    /** Keeps the cache under [MAX_BYTES], removing the files used longest ago. */
    private fun trim(keep: File) {
        val files = dir.walkTopDown().filter { it.isFile }.sortedByDescending { it.lastModified() }.toList()
        var total = 0L
        for (f in files) {
            total += f.length()
            if (total > MAX_BYTES && f != keep) {
                f.delete()
                f.parentFile?.takeIf { it.list()?.isEmpty() == true }?.delete()
            }
        }
    }

    companion object {
        const val MAX_BYTES = 1024L * 1024 * 1024
        private const val VAULT_DIR = "vault"

        fun mimeOf(name: String): String =
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(FileKinds.extension(name)) ?: "application/octet-stream"

        private fun safeName(name: String) = name.replace(Regex("""[\\/:*?"<>|\u0000]"""), "_").take(120).ifBlank { "file" }

        /** The phone's "Share" sheet for [file]. */
        fun shareIntent(file: LocalFile, title: String): Intent = Intent.createChooser(
            Intent(Intent.ACTION_SEND).setType(file.mime).putExtra(Intent.EXTRA_STREAM, file.uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            title,
        )

        /** "Open with" another app. */
        fun viewIntent(file: LocalFile, title: String): Intent = Intent.createChooser(
            Intent(Intent.ACTION_VIEW).setDataAndType(file.uri, file.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            title,
        )
    }
}
