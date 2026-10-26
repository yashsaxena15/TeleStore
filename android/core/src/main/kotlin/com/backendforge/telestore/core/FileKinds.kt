package com.backendforge.telestore.core

enum class FileKind(val wire: String? = null) {
    FOLDER, VIDEO("video"), AUDIO("audio"), PHOTO("photo"), DOCUMENT("document"), ARCHIVE, OTHER
}

/** File type from the server's type or the extension (mirrors the website's fileTypes.js). */
object FileKinds {
    private val video = setOf("mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "3gp", "ts")
    private val photo = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic")
    private val audio = setOf("mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus")
    private val archive = setOf("zip", "rar", "7z", "tar", "gz", "bz2", "xz")
    private val document = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "json")

    fun extension(name: String): String =
        name.substringAfterLast('.', "").lowercase().takeIf { it != name.lowercase() } ?: ""

    fun of(item: FileItem): FileKind = when {
        item.isFolder -> FileKind.FOLDER
        else -> of(item.name, item.type)
    }

    fun of(name: String, serverType: String? = null): FileKind {
        val ext = extension(name)
        return when {
            ext in video || serverType == "video" -> FileKind.VIDEO
            ext in audio || serverType == "audio" || serverType == "voice" -> FileKind.AUDIO
            ext in photo || serverType == "photo" -> FileKind.PHOTO
            ext in archive -> FileKind.ARCHIVE
            ext in document || serverType == "document" -> FileKind.DOCUMENT
            else -> FileKind.OTHER
        }
    }
}
