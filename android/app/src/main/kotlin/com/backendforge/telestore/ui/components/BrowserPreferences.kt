package com.backendforge.telestore.ui.components

import android.content.Context
import com.backendforge.telestore.core.FilesView
import com.backendforge.telestore.core.SortBy

class BrowserPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("telestore_browser_prefs", Context.MODE_PRIVATE)

    var sortBy: SortBy
        get() = when (prefs.getString(KEY_SORT_BY, "name")) {
            "date" -> SortBy.DATE
            "size" -> SortBy.SIZE
            else -> SortBy.NAME
        }
        set(value) = prefs.edit().putString(KEY_SORT_BY, value.wire).apply()

    var ascending: Boolean
        get() = prefs.getBoolean(KEY_ASCENDING, true)
        set(value) = prefs.edit().putBoolean(KEY_ASCENDING, value).apply()

    /**
     * List or grid, chosen with the button in a folder's top bar. Saved under a new name so
     * everyone starts on the compact list once (the old grid choice made folders huge cards).
     */
    var isGrid: Boolean
        get() = FilesView.parse(prefs.getString(KEY_FILES_VIEW, null)) == FilesView.GRID
        set(value) = prefs.edit().putString(KEY_FILES_VIEW, (if (value) FilesView.GRID else FilesView.LIST).wire).apply()

    companion object {
        private const val KEY_SORT_BY = "sort_by"
        private const val KEY_ASCENDING = "ascending"
        private const val KEY_FILES_VIEW = "files_view"
    }
}
