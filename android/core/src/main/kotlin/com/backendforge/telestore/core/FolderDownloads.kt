package com.backendforge.telestore.core

/**
 * Downloading a whole folder as it is: every file inside it (and its subfolders), each with the
 * folder on the phone it goes in, so the phone ends up with the same layout ("Trip/Day 1/a.jpg").
 */
data class FolderFile(
    val item: FileItem,
    /** Where it goes under the downloads location: the folder's name, then its subfolders ("Trip/Day 1"). */
    val subPath: String,
)

object FolderDownloads {
    private val BAD = Regex("""[\\/:*?"<>|\x00-\x1f]""")

    /** A name that's safe as a file or folder name on the phone. */
    fun safeName(name: String): String = name.replace(BAD, "_").trim(' ', '.').ifEmpty { "file" }

    /** "Trip" + "Day 1/Raw" -> "Trip/Day 1/Raw", each part made safe. */
    fun join(vararg parts: String): String = parts
        .flatMap { it.split('/') }
        .filter { it.isNotBlank() }
        .joinToString("/") { safeName(it) }

    /** The folder of [file] under [folderPath] ("/Home/Trip" + file in "/Home/Trip/Day 1" -> "Day 1"). */
    fun relative(folderPath: String, file: FileItem): String {
        val base = folderPath.trimEnd('/')
        val path = file.path.trimEnd('/')
        return if (path == base) "" else if (path.startsWith("$base/")) path.removePrefix("$base/") else ""
    }

    /** Every file inside your own folder at [folderPath] (named [folderName] on the phone). */
    suspend fun ownFolder(api: TeleStoreApi, folderPath: String, folderName: String): List<FolderFile> {
        val out = mutableListOf<FolderFile>()
        var page = 1
        while (true) {
            val body = api.listFiles("all", page = page, pageSize = 500, sortBy = SortBy.NAME, ascending = true, under = folderPath)
            body.files.filter { !it.isFolder }.forEach { out += FolderFile(it, join(folderName, relative(folderPath, it))) }
            val pages = body.pagination?.totalPages ?: 1
            if (page >= pages || body.files.isEmpty()) return out
            page++
        }
    }

    /**
     * Every file inside a folder of a share ([path] relative to the shared folder, "" = all of it),
     * walking its subfolders. [folderName] is the folder's name on the phone.
     */
    suspend fun shareFolder(api: TeleStoreApi, shareId: String, path: String, folderName: String): List<FolderFile> {
        val out = mutableListOf<FolderFile>()
        val todo = ArrayDeque(listOf(path.trim('/') to ""))
        while (todo.isNotEmpty()) {
            val (at, rel) = todo.removeFirst()
            for (item in api.browseShare(shareId, at).items) {
                if (item.isFolder) {
                    todo += "${at}/${item.name}".trim('/') to "$rel/${item.name}".trim('/')
                } else {
                    out += FolderFile(item.toFileItem(shareId), join(folderName, rel))
                }
            }
        }
        return out
    }
}
