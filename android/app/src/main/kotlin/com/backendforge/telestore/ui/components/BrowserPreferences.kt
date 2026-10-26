package com.backendforge.telestore.ui.components

import android.content.Context
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

    var isGrid: Boolean
        get() = prefs.getBoolean(KEY_IS_GRID, false)
        set(value) = prefs.edit().putBoolean(KEY_IS_GRID, value).apply()

    companion object {
        private const val KEY_SORT_BY = "sort_by"
        private const val KEY_ASCENDING = "ascending"
        private const val KEY_IS_GRID = "is_grid"
    }
}
