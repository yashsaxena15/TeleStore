package com.backendforge.telestore.transfers

import android.content.Context
import android.net.Uri
import android.os.StatFs
import androidx.core.content.FileProvider
import java.io.File

/** Where files kept offline live: inside the app (filesDir/offline), never in Downloads. */
object OfflineFiles {
    private const val DIR = "offline"

    fun dir(context: Context) = File(context.filesDir, DIR)

    /** A new empty file for [fileId]; its folder keeps two files of the same name apart. */
    fun create(context: Context, fileId: String, name: String): Uri {
        val folder = File(dir(context), fileId.filter { it.isLetterOrDigit() }).apply { mkdirs() }
        val file = File(folder, safeName(name))
        if (!file.exists()) file.createNewFile()
        return Uri.fromFile(file)
    }

    /** The content:// address other parts of the app (and other apps) can read, or null if gone. */
    fun shareable(context: Context, uri: Uri): Uri? {
        val file = uri.path?.let(::File)?.takeIf { uri.scheme == "file" && it.exists() } ?: return null
        return runCatching { FileProvider.getUriForFile(context, "${context.packageName}.files", file) }.getOrNull()
    }

    fun delete(uri: Uri) {
        uri.path?.let(::File)?.takeIf { uri.scheme == "file" }?.let { file ->
            file.delete()
            file.parentFile?.takeIf { it.list().isNullOrEmpty() }?.delete()
        }
    }

    fun usedBytes(context: Context): Long = dir(context).walkBottomUp().filter { it.isFile }.sumOf { it.length() }

    /** Free space on the phone where offline files go. */
    fun freeBytes(context: Context): Long = runCatching { StatFs(context.filesDir.path).availableBytes }.getOrDefault(0L)

    fun clear(context: Context) {
        dir(context).deleteRecursively()
    }

    private fun safeName(name: String) = name.replace(Regex("""[\\/:*?"<>|\u0000]"""), "_").take(120).ifBlank { "file" }
}
