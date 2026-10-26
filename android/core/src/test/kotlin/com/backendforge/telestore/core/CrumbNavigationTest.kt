package com.backendforge.telestore.core

import com.backendforge.telestore.core.FolderPaths.CrumbStep
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * Breadcrumbs follow the folder's path, the history doesn't always. This plays the app's
 * navigateToCrumb loop against a history (bottom first, current screen last; null = a screen
 * that isn't a folder of this tab, like Search or another tab) and returns the history after.
 */
class CrumbNavigationTest {
    private fun tapCrumb(history: List<String?>, target: String): List<String?> {
        val stack = history.toMutableList()
        while (true) {
            val previous = if (stack.size >= 2) stack[stack.size - 2] else null
            when (FolderPaths.crumbStep(previous, target)) {
                CrumbStep.POP_AND_STOP -> { stack.removeAt(stack.lastIndex); return stack }
                CrumbStep.POP_AND_CONTINUE -> stack.removeAt(stack.lastIndex)
                CrumbStep.OPEN -> { stack.add(target); return stack }
            }
        }
    }

    @Test
    fun `walked folder by folder - goes back to the crumb`() {
        val after = tapCrumb(listOf("/Home", "/Home/A", "/Home/A/B", "/Home/A/B/C"), "/Home/A")
        assertEquals(listOf("/Home", "/Home/A"), after) // Back then goes to Home
    }

    @Test
    fun `home crumb from deep inside`() {
        assertEquals(listOf("/Home"), tapCrumb(listOf("/Home", "/Home/A", "/Home/A/B"), "/Home"))
    }

    @Test
    fun `folder opened from Starred - opens the crumb instead of landing on Starred`() {
        val after = tapCrumb(listOf("starred", "/Home/A/B"), "/Home/A")
        assertEquals(listOf("starred", "/Home/A/B", "/Home/A"), after) // Back returns to B, then Starred
    }

    @Test
    fun `starred folder then deeper - goes back within the folders, then opens`() {
        val after = tapCrumb(listOf("starred", "/Home/A/B", "/Home/A/B/C"), "/Home/A")
        assertEquals(listOf("starred", "/Home/A/B", "/Home/A"), after)
    }

    @Test
    fun `folder opened from Search - opens Home on top`() {
        val after = tapCrumb(listOf("/Home", null, "/Home/A/B"), "/Home")
        assertEquals(listOf("/Home", null, "/Home/A/B", "/Home"), after)
    }

    @Test
    fun `a sibling folder underneath is not walked through`() {
        // Home → X → (search) → A/B: tapping A must not land on X
        val after = tapCrumb(listOf("/Home", "/Home/X", "/Home/A/B"), "/Home/A")
        assertEquals(listOf("/Home", "/Home/X", "/Home/A/B", "/Home/A"), after)
    }

    @Test
    fun `names that share a prefix are different folders`() {
        assertEquals(CrumbStep.OPEN, FolderPaths.crumbStep("/Home/Movies 2", "/Home/Movies"))
        assertEquals(CrumbStep.POP_AND_CONTINUE, FolderPaths.crumbStep("/Home/Movies/2", "/Home/Movies"))
        assertEquals(CrumbStep.POP_AND_STOP, FolderPaths.crumbStep("/Home/Movies/", "/Home/Movies"))
        assertEquals(CrumbStep.OPEN, FolderPaths.crumbStep(null, "/Home"))
    }
}
