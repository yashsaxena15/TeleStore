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
- None. All requirements and contracts from the prompt were strictly implemented.

## Left Unfinished
- Nothing. All Phase 2 Browse requirements are complete.
