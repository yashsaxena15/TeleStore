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

    /** What to do with the screen under the current one while going back to a breadcrumb. */
    enum class CrumbStep {
        /** It is the breadcrumb's folder: go back to it and stop. */
        POP_AND_STOP,
        /** It is a folder inside the breadcrumb's folder: go back to it and look again. */
        POP_AND_CONTINUE,
        /** The breadcrumb's folder isn't in this history (opened from Starred or Search): open it. */
        OPEN,
    }

    /**
     * Breadcrumbs follow the folder's path, but the history may not (a folder opened from Starred
     * or from Search has no parent screens). So go back only through this tab's folders that lie
     * inside [target], stopping at [target]; anything else means opening [target] fresh.
     *
     * [previousPath] is the folder of the screen underneath (null when it isn't a folder of the
     * same tab, or when there is none).
     */
    fun crumbStep(previousPath: String?, target: String): CrumbStep = when {
        previousPath == null -> CrumbStep.OPEN
        previousPath.trimEnd('/') == target.trimEnd('/') -> CrumbStep.POP_AND_STOP
        isInside(previousPath, target) -> CrumbStep.POP_AND_CONTINUE
        else -> CrumbStep.OPEN
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
