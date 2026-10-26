# TeleStore Android — Phase 2 review fixes (prompt for the implementing agent)

Good work on Phase 2: the API calls match the server, every call is guarded against crashes,
and thank you for catching the root `.gitignore` rule (`test/`) that had kept `:core` tests out
of git. The review found the issues below. Fix them **on the same branch
`feat/android-phase2-browse`** (new commits, no force-push), change only `android/`, keep all the
rules of `PHASE_2_PROMPT.md` (no network on the main thread, catch every API error, no new
libraries).

## Must fix

1. **Opening a folder in Trash shows the wrong thing.** Tapping a trashed folder calls
   `onNavigateFolder(FolderPaths.childPath(item))`, which lists the *live* folder at that path
   (`GET /files?path=/Home/X` only returns non-trashed items). The user sees "This folder is
   empty", or worse, the contents of a newer folder that has the same name.
   Fix: in Trash, tapping any item (folder or file) opens its **Info** sheet. In the Info sheet
   for a trashed folder add the line "Restore it to open it". (`FolderScreen.kt`, the two
   `onClick` handlers around lines 366 and 412, list and grid.)

2. **Back while selecting leaves the folder (or the app).** There is no `BackHandler` for
   selection mode, so the system Back button closes the folder, or exits the app on a tab root,
   instead of ending the selection. Fix: in `FolderScreen`, add
   `BackHandler(enabled = state.isSelectionMode) { vm.clearSelection() }`. It must win over
   `MainScreen`'s root `BackHandler` (an inner, later-composed `BackHandler` does). Same for
   `SearchScreen` if it has selection.

3. **Old replies can overwrite newer ones.**
   - `FolderViewModel.loadPage` starts a new coroutine each time and never cancels the previous
     one. Pull-to-refresh while "load more" is running, or changing sort twice quickly, can mix
     pages or show the older result. Fix: keep `private var loadJob: Job?`; a page-1 load
     (`refresh`, `setSort`, `setPath`, init) cancels `loadJob` before starting; `loadMore` does
     nothing while a page-1 load is running. When a reply arrives, apply it only if
     `state.path`, `sortBy` and `ascending` still equal the values the request was made with.
   - `FolderPickerSheet.loadFolders`: tapping folders quickly can show the subfolders of the
     previous folder. Fix: run the load inside `LaunchedEffect(currentPath)` directly (it is
     cancelled when `currentPath` changes) instead of `scope.launch`, or ignore a reply whose
     path no longer equals `currentPath`.

4. **Bulk Star can't unstar.** The selection bar always calls `starItems(selected, true)`.
   Fix: if every selected item is already starred, the button reads **Unstar** and calls
   `starItems(selected, false)`; otherwise **Star**.

## Verify, and fix if broken (navigation)

These depend on Navigation Compose behaviour that can't be run on the review server. Check
them, and fix any that fail:

5. **Switching tabs keeps each tab's place.** Home, Starred and Recent all use the same route
   pattern `folder?path={path}`, and `navigateToTab` uses `saveState`/`restoreState`. Test: open
   Home → Movies → a subfolder, switch to Starred, then back to Home. You must land back in the
   subfolder, and Starred must show starred items. If it doesn't, give each tab its own nested
   graph (`navigation(route = "home_tab", startDestination = …)` etc.) so their back stacks are
   saved separately.
6. **Breadcrumbs jump to the right folder.** `navigateToFolder` calls
   `navController.popBackStack("folder?path=…", inclusive = false)`. Test: Home → A → B → C, tap
   the "A" crumb. You must land on A, with Back then going to Home. If `popBackStack` with a
   filled-in route doesn't match exactly, pop with
   `navController.popBackStack(entry.destination.id, …)` after finding the back-stack entry
   whose `arguments?.getString("path") == target`, or navigate with
   `popUpTo` on that entry.

## Notes file

Update `android/docs/PHASE_2_NOTES.md`:
- under "Deviations", list the root `.gitignore` fix (re-including `core/src/test` and
  `app/src/test`) and that `PHASE_2_PROMPT.md` was committed;
- add a "Review fixes" section listing items 1–6 and how each was fixed or verified.

## Done when

- `./gradlew :core:test` passes. Add `:core` tests for anything you move into `:core`.
- The **Android** workflow for the branch's last commit is green.
- Reply with the new commit list and the workflow run link.
