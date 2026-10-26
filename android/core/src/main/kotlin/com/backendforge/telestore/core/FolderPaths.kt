package com.backendforge.telestore.core

/**
 * Pure path helpers for folder navigation, breadcrumbs, child paths and hierarchy checks.
 */
object FolderPaths {
    /** The child path of a folder [folder] (item.path is its parent folder). */
    fun childPath(folder: FileItem): String {
        val parent = folder.path.trimEnd('/')
        return if (parent.isEmpty()) "/${folder.name}" else "$parent/${folder.name}"
    }

    /** The child path of a folder given its [parentPath] and folder [name]. */
    fun childPath(parentPath: String, name: String): String {
        val parent = parentPath.trimEnd('/')
        return if (parent.isEmpty()) "/$name" else "$parent/$name"
    }

    /** Parent folder path, or null at "/Home" (or non-hierarchical places). */
    fun parent(path: String): String? {
        val normalized = path.trimEnd('/')
        if (normalized == TeleStoreApi.HOME || !normalized.startsWith(TeleStoreApi.HOME)) {
            return null
        }
        val lastSlash = normalized.lastIndexOf('/')
        if (lastSlash <= 0) return null
        return normalized.substring(0, lastSlash)
    }

    /**
     * Breadcrumb pairs of (label, path) from root to [path].
     * E.g. "/Home/Movies/2024" -> [("Home", "/Home"), ("Movies", "/Home/Movies"), ("2024", "/Home/Movies/2024")]
     */
    fun crumbs(path: String): List<Pair<String, String>> {
        val normalized = path.trimEnd('/')
        if (!normalized.startsWith(TeleStoreApi.HOME)) {
            val place = Places.fromPath(path)
            val label = place?.title ?: path
            return listOf(label to path)
        }
        val segments = normalized.split('/').filter { it.isNotEmpty() }
        val result = mutableListOf<Pair<String, String>>()
        var currentPath = ""
        for (segment in segments) {
            currentPath += "/$segment"
            result.add(segment to currentPath)
        }
        return result
    }

    /**
     * Returns true if [path] is inside [folderPath] or is [folderPath] itself.
     * Used to prevent moving a folder into itself or its own subfolder.
     */
    fun isInside(path: String, folderPath: String): Boolean {
        val cleanPath = path.trimEnd('/')
        val cleanFolder = folderPath.trimEnd('/')
        return cleanPath == cleanFolder || cleanPath.startsWith("$cleanFolder/")
    }
}
