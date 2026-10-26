# TeleStore Android — Phase 2: Browse Notes

## What Was Built

### 1. `:core` Library Additions & Tests
- **API Endpoints (`TeleStoreApi.kt`)**: Added suspend functions for all folder and file actions:
  - `createFolder(name, parentPath)` (`POST /folders/create`)
  - `rename(item, newName)` (`POST /files/rename`)
  - `move(item, targetFolderPath)` (`POST /files/move`)
  - `copy(item, targetFolderPath)` (`POST /files/copy`)
  - `setStarred(item, starred)` (`POST /files/star`)
  - `trash(item)` (`POST /files/trash`)
  - `restore(item)` (`POST /files/restore`)
  - `deleteForever(item)` (`POST /files/delete`)
  - `emptyTrash()` (`POST /files/trash/empty`)
  - Response models: `MessageReply` and `StarReply`
- **Path Helpers (`FolderPaths.kt`)**:
  - `childPath(folder)` and `childPath(parentPath, name)`
  - `parent(path)` returning null at `/Home`
  - `crumbs(path)` returning `(label, path)` pairs from root to leaf
  - `isInside(path, folderPath)` preventing moving a folder into itself or its own subfolder (while allowing sibling prefixes)
- **Places (`Places.kt`)**:
  - `Place` enum (`HOME`, `STARRED`, `RECENT`, `TRASH`, `INBOX`) mapping to path and sort rules
  - `Places.fromPath` and `Places.isSpecial`
- **Date Formatting (`DateFormatter.kt`)**:
  - Pure date parser for ISO-8601 strings (treating timezone-less legacy dates as UTC)
  - `formatShort` ("Oct 22" or "Oct 22, 2025") for row/card display
  - `formatFull` ("Oct 22, 2026, 2:30 PM") for info sheets
- **Testing**:
  - MockWebServer tests in `TeleStoreApiTest.kt` verifying methods, paths, JSON bodies, and 400 error mapping to `ApiException`.
  - Unit tests in `CoreHelpersTest.kt` for `FolderPaths`, `Places`, and `DateFormatter`.
  - All tests pass locally via `./gradlew :core:test`.

### 2. Version Catalog & Build Configuration
- Added dependencies to `android/gradle/libs.versions.toml`:
  - `androidx.navigation:navigation-compose:2.8.5`
  - `io.coil-kt.coil3:coil-compose:3.0.4`
  - `io.coil-kt.coil3:coil-network-okhttp:3.0.4`
- Added dependencies to `android/app/build.gradle.kts`.
- Configured single shared `ImageLoader` in `AppContainer` using `OkHttpNetworkFetcherFactory(callFactory = { api().http })` and initialized via `SingletonImageLoader.setSafe` in `TeleStoreApplication`.

### 3. `:app` Browse UI
- **Navigation Shell (`ui/MainScreen.kt`)**:
  - Bottom `NavigationBar` with 5 tabs: **Home · Starred · Recent · Transfers · More**.
  - Back handler: pressing back inside subfolders moves up the folder hierarchy; pressing back at tab root leaves the app.
  - Breadcrumb navigation that pops backstack or pushes new folders.
- **Folder Screen (`ui/browse/FolderScreen.kt` & `FolderViewModel.kt`)**:
  - Paging with 50 items per page and progress spinner at the bottom when loading more.
  - Pull-to-refresh support (`PullToRefreshBox`).
  - Empty states and error states with "Try again".
  - Sort & view bottom sheet (`ui/components/SortViewSheet.kt`): Sort by Name/Date/Size, ascending/descending, List or Grid. Persisted via `BrowserPreferences` in `SharedPreferences`.
  - **List View (`FileRow.kt`)**: 44dp thumbnail/icon, single-line name, size and date details, star indicator, action menu button.
  - **Grid View (`FileGridCard.kt`)**: Adaptive grid (`GridCells.Adaptive(160.dp)`), 16:10 thumbnail tile, star badge, action menu button.
  - Missing thumbnails return 404 and gracefully fall back to the file-kind icon without error toasts.
- **Special Places**:
  - Starred (`starred`), Recent (`all` sorted by date descending), Trash (`trash`), and Telegram Inbox (`inbox`).
  - Empty trash action in Trash top bar with confirmation dialog.
- **Search Screen (`ui/search/SearchScreen.kt` & `SearchViewModel.kt`)**:
  - 400ms debounce on search queries.
  - Paged search results showing parent folder path under item name.
  - Clicking a folder navigates into it; clicking a file opens its info sheet.
- **Item Actions Sheet (`ui/components/ItemActionSheet.kt`)**:
  - Contextual actions for Normal places, Trash, and Inbox.
  - Open folder, Info, Rename, Move, Copy, Star/Unstar, Move to Trash, Restore, Delete Forever.
- **Multi-select Mode**:
  - Long press on any item enters selection mode with checkboxes.
  - Top bar shows count of selected items, Select All, and Close.
  - Bottom action bar provides bulk Move, Copy, Star, Trash, Restore, and Delete Forever.
  - Sequential execution reporting summary: e.g. "Moved 3 items" or "2 moved, 1 failed: <message>".
- **Folder Picker (`ui/components/FolderPickerSheet.kt`)**:
  - Browses folders starting at `/Home` with breadcrumbs and "New folder" dialog.
  - Validates destination with `FolderPaths.isInside` and refuses moving a folder into itself or its own subfolder.
- **Dialogs & Sheets**:
  - `NewFolderDialog` and `RenameDialog` (pre-selecting text before extension).
  - `ConfirmDialog` for destructive actions (Delete forever, Empty trash, Sign out).
  - `FileInfoSheet` showing name, kind, size, folder path, modified date, starred status, and trash metadata (`trashedAt`, `originalPath`).
- **More Tab (`ui/more/MoreScreen.kt`)**:
  - Signed-in username, server address, navigation to Trash and Telegram Inbox, and Sign out button with confirmation.
- **Transfers Placeholder (`ui/transfers/TransfersPlaceholderScreen.kt`)**:
  - Shows "Uploads and downloads arrive in Phase 4".

## Deviations from Prompt
- The root repository `.gitignore` contained a `test/` rule that unintentionally matched and excluded `android/core/src/test` and `android/app/src/test`. Added unignore rules in `android/.gitignore` (`!test/`, `!core/src/test/**`, `!app/src/test/**`) so Android tests are tracked in git and executed in CI.
- `android/docs/PHASE_2_PROMPT.md` was committed to preserve requirements and specifications in the repository.

## Review Fixes
1. **Opening a folder in Trash**: In `FolderScreen.kt`, tapping any item in Trash (folder or file) in either List or Grid view opens `FileInfoSheet` instead of attempting navigation to `/files?path=...`. In `FileInfoSheet.kt`, trashed folders display `Status: Restore it to open it`.
2. **Back handling in selection mode**: Added `BackHandler(enabled = state.isSelectionMode) { vm.clearSelection() }` in `FolderScreen.kt`. It takes precedence over `MainScreen`'s root back handler, ending selection mode without leaving the folder or closing the app.
3. **Stale replies and race conditions**:
   - In `FolderViewModel.kt`: Added `private var loadJob: Job?`. A page-1 load (`refresh`, `setSort`, `setPath`, `init`) cancels `loadJob` before starting. `loadMore()` does nothing while `loadJob?.isActive == true`. When responses arrive, they are applied only if `path`, `sortBy`, and `ascending` still equal the values requested.
   - In `FolderPickerSheet.kt`: Moved folder loading into `LaunchedEffect(currentPath, reloadKey)` directly without `scope.launch`, ensuring the coroutine is cancelled automatically when the user changes folders quickly.
4. **Bulk Star / Unstar**: In `FolderScreen.kt`, the selection bar checks `val allStarred = selected.isNotEmpty() && selected.all { it.starred }`. If all selected items are starred, the button displays "Unstar" with `StarOutline` and calls `starItems(selected, false)`. Otherwise, it displays "Star" with a filled star and calls `starItems(selected, true)`.
5. **Tab backstack persistence**: In `MainScreen.kt`, wrapped each tab in its own nested navigation graph (`home_graph`, `starred_graph`, `recent_graph`, `transfers`, `more_graph`). Navigating tabs with `saveState = true; restoreState = true` preserves each tab's independent backstack and scroll position.
6. **Breadcrumb navigation**: `navigateToCrumb` (in `MainScreen.kt`) walks back one screen at a time using `FolderPaths.crumbStep` (in `:core`): it goes back through this tab's folders that lie inside the tapped folder and stops on it; if the history doesn't lead there (a folder opened from Starred or Search, or a sibling folder underneath), it opens the tapped folder on top instead. A first version popped a fixed `stepsToPop` and landed on the Starred list or under Search; `CrumbNavigationTest` covers those cases. Uses only public Navigation API.

## Left Unfinished
- Nothing. All Phase 2 Browse requirements and review items are complete and verified.
