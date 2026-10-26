# TeleStore Android — Phase 2: Browse (prompt for the implementing agent)

You are adding the **Browse** phase to an existing native Android app. Read this whole document
before writing code, and follow it exactly. Where it says MUST, it is a hard requirement that the
reviewer will check.

## 0. Ground rules

- Work on a new git branch **`feat/android-phase2-browse`** created from the latest `main`.
  Commit in small steps. Push the branch when done. **Do not merge, do not push to `main`.**
- Change **only** files under `android/` (plus nothing else). MUST NOT touch the Python server
  (`telestore/`), the website (`frontend/`), `.github/`, signing files, or `docker-compose.yml`.
  Every server endpoint you need already exists (listed in section 3).
- Language: **Kotlin only**, Jetpack Compose + Material 3. No XML layouts, no Java.
- **No new libraries except** those listed in section 2. No Hilt/Dagger, no Retrofit, no Room
  (later phases add what they need). Keep using the existing manual DI (`AppContainer`).
- MUST NOT do any network work on the main thread. All server calls go through `TeleStoreApi`
  (in `:core`), which already moves network work to its IO dispatcher. Never call OkHttp directly
  from `:app` except via `api.http` for image loading (Coil).
- Every place that calls the API MUST catch errors so the app never crashes:
  ```kotlin
  try { ... } catch (e: CancellationException) { throw e } catch (e: Exception) {
      // show (e as? ApiException)?.message ?: "Something went wrong: ${e.message}"
  }
  ```
  Show errors in a Snackbar or an inline message, never a crash. A 401 already signs the user
  out automatically (the `onUnauthorized` callback in `AppContainer`) — don't handle it again.
- Keep the code readable: small composables, one ViewModel per screen, state as immutable data
  classes in `StateFlow`, no business logic in composables.

## 1. What already exists (Phase 1) — read these files first

```
android/
  settings.gradle.kts        :app is only included when an Android SDK exists (CI); :core always
  gradle/libs.versions.toml  version catalog — add new libraries HERE
  core/  (plain Kotlin/JVM, tested on a server WITHOUT the Android SDK)
    src/main/kotlin/com/backendforge/telestore/core/
      TeleStoreApi.kt   API client: login, googleLogin, check, logout, listFiles(path,page,pageSize,sortBy,ascending,query)
      Models.kt         FileItem, FilePage, Pagination, SortBy, LoginResponse, AuthCheck, GoogleConfig
      MediaUrls.kt      file(), converted(), info(), thumbnail(item) -> HttpUrl? (token in the URL)
      FileKinds.kt      FileKind (FOLDER, VIDEO, AUDIO, PHOTO, DOCUMENT, ARCHIVE, OTHER)
      ApiException.kt   ApiException(status, message), UnauthorizedException, NetworkException
      ServerAddress.kt
    src/test/kotlin/...  JUnit 5 + MockWebServer tests (TeleStoreApiTest, ThreadingTest, CoreHelpersTest)
  app/  (Android, built only in CI)
    src/main/kotlin/com/backendforge/telestore/
      MainActivity.kt          shows SignInScreen when signed out, otherwise HomeScreen
      TeleStoreApplication.kt, data/AppContainer.kt (api(), session), data/SessionStore.kt
      ui/signin/*              sign-in (do not change behaviour)
      ui/home/HomeScreen.kt, HomeViewModel.kt, Formatting.kt (formatBytes)   <- Phase 1 placeholder, REPLACE in this phase
      ui/theme/Theme.kt        TeleStore colours (use MaterialTheme.colorScheme.*, no hard-coded colours except file-kind accents)
```

How to test `:core` locally: `cd android && ./gradlew :core:test`. `:app` cannot be compiled on a
machine without the Android SDK; it is compiled by GitHub Actions on every push (workflow
**Android**). Your branch MUST end with a green **Android** workflow run.

## 2. Libraries you may add (version catalog + `app/build.gradle.kts`)

| Purpose | Coordinates | Version |
|---|---|---|
| Navigation | `androidx.navigation:navigation-compose` | `2.8.5` |
| Images | `io.coil-kt.coil3:coil-compose` | `3.0.4` |
| Images over our OkHttp | `io.coil-kt.coil3:coil-network-okhttp` | `3.0.4` |

Coil MUST use the app's OkHttp client so it shares connections (create the `ImageLoader` once,
e.g. in `AppContainer`, with `OkHttpNetworkFetcherFactory(callFactory = { api.http })`). Thumbnail
URLs already carry the token (`api.media.thumbnail(item)`). A missing thumbnail returns 404: show
the file-kind icon instead (no error message).

## 3. Server API (exact contract — already deployed)

All requests carry `X-Auth-Token` automatically (TeleStoreApi interceptor). Errors are
`{"detail": "message"}`; TeleStoreApi turns them into `ApiException(status, message)`.

### Listing — `GET /files` (already in TeleStoreApi.listFiles)
Query: `path`, `page` (1-based), `page_size` (1–500), `sort_by` = `name|date|size`,
`sort_order` = `asc|desc`, optional `q`.
Reply: `{"files":[FileItem...], "pagination":{"page","page_size","total_items","total_pages","has_next","has_prev"}}`.
Folders come first. Special `path` values:

| path | Shows |
|---|---|
| `/Home` | top of Home |
| `/Home/Movies/2024` | a folder (path = parent folder path + `/` + folder name) |
| `starred` | starred items |
| `trash` | items in Trash (have `trashed_at`, `original_path`) |
| `inbox` | Telegram Inbox |
| `all` | every file (no folders) — use with `sort_by=date`, `sort_order=desc` for **Recent** |
| any + `q=text` | search by name in all of the user's folders (path ignored; Trash and Vault excluded) |

A folder `FileItem` has `file_type == "folder"`; its own path for listing is
`item.path.trimEnd('/') + "/" + item.name` (the item's `path` is its PARENT folder).

### Actions — all `POST`, JSON body, reply `{"message": ...}` unless noted

| Action | Path | Body | Notes |
|---|---|---|---|
| New folder | `/folders/create` | `{"folderName": "x", "currentPath": "/Home/Movies"}` | 400 if it exists |
| Rename | `/files/rename` | `{"file_id": id, "new_name": "x"}` | files and folders |
| Move | `/files/move` | `{"file_id": id, "target_path": "/Home/Archive"}` | target is a FOLDER path. 400 for items in Trash or into a trashed folder |
| Copy | `/files/copy` | `{"file_id": id, "target_path": "/Home/Archive"}` | |
| Star / unstar | `/files/star` | `{"file_id": id, "starred": true}` | reply `{"starred": bool}` |
| Move to Trash | `/files/trash` | `{"file_id": id}` | |
| Restore | `/files/restore` | `{"file_id": id}` | only for Trash items |
| Delete forever | `/files/delete` | `{"file_id": id}` | only offer it in Trash |
| Empty Trash | `/files/trash/empty` | (no body / `{}`) | |

## 4. `:core` work (with tests — MUST pass `./gradlew :core:test`)

1. Add to `TeleStoreApi` (suspend funs, same style as existing ones, all through the existing
   private `call(...)` helper so replies are read on the IO dispatcher):
   `createFolder(name, parentPath)`, `rename(item, newName)`, `move(item, targetFolderPath)`,
   `copy(item, targetFolderPath)`, `setStarred(item, starred): Boolean`, `trash(item)`,
   `restore(item)`, `deleteForever(item)`, `emptyTrash()`.
   Use a small `@Serializable data class MessageReply(val message: String? = null)` for replies.
2. Add `FolderPaths` (pure Kotlin) with: `childPath(folder: FileItem): String`,
   `parent(path: String): String?` (null at `/Home`), `crumbs(path: String): List<Pair<String,String>>`
   (label, path) e.g. `/Home/Movies/2024` → `[("Home","/Home"),("Movies","/Home/Movies"),("2024","/Home/Movies/2024")]`,
   and `isInside(path, folderPath)` (for "can't move a folder into itself").
3. Add `Places` enum or sealed class: `Home`, `Starred`, `Recent`, `Trash`, `Inbox` mapping to the
   path/sort rules in section 3.
4. Tests (MockWebServer): each new API call sends the right method, path and JSON body and maps a
   `{"detail":..}` 400 to `ApiException` with that message; `FolderPaths` unit tests including
   names with spaces and brackets; `isInside` true for the folder itself and its children.

## 5. `:app` work — the Browse UI

Replace the Phase 1 placeholder (`ui/home/*`). Suggested packages: `ui/browse`, `ui/search`,
`ui/more`, `ui/components`. Match the look of the website: dark near-black background, indigo
accent (already in `Theme.kt`), rounded 10–14 dp corners, compact rows.

1. **Navigation shell** (Navigation Compose) with a bottom `NavigationBar`:
   **Home · Starred · Recent · Transfers · More**.
   - Transfers is a placeholder screen: "Uploads and downloads arrive in Phase 4".
   - Back from a sub-folder goes up one folder; back on a tab's root leaves the app.
2. **Folder screen** (used by Home and by folders opened from anywhere):
   - Top bar: title = folder name; breadcrumbs row (tap a crumb to jump); actions: Search,
     Sort & view.
   - **Sort & view** bottom sheet: Name / Date / Size, ascending/descending, List or Grid.
     Remember the choice (DataStore not needed — `SharedPreferences` is fine, NOT the encrypted
     session store).
   - **List**: icon or thumbnail (44 dp), name (1 line, ellipsis), details line
     (`size · date`, folders show date only). **Grid**: 2 columns on phones, adaptive on tablets,
     16:10 thumbnail tile + name.
   - **Paging**: load 50 at a time; load the next page when the user scrolls near the end
     (`pagination.has_next`). Show a small progress row while loading more.
   - **Pull to refresh**; empty state "This folder is empty"; error state with **Try again**.
   - Tap a folder → open it. Tap a file → for now show its **Info** sheet (playback is Phase 3).
3. **Starred**, **Recent**, **Trash**, **Telegram Inbox**: same list component, using the
   special paths from section 3. Recent is `all` sorted by date, newest first, no folders.
4. **Search** screen: text field with a 400 ms debounce, results from `listFiles(query=...)`
   with paging; each result shows its folder (`item.path`) under the name; tap a folder result
   opens that folder.
5. **Item actions**: a ⋮ button on each row and long-press, opening a bottom sheet:
   - Normal places: Open (folders), Info, Rename, Move…, Copy…, Star/Unstar, Move to Trash.
   - Trash: Restore, Delete forever (confirm dialog), Info.
   - Inbox: Info, Move…, Star, Move to Trash.
6. **Multi-select**: long-press enters selection mode (checkboxes, top bar shows "N selected",
   select all, close). Bulk actions: Move…, Copy…, Star, Move to Trash (Trash: Restore,
   Delete forever). Run bulk actions one by one, then show "Moved 3 items" or
   "2 moved, 1 failed: <message>". Refresh the list afterwards.
7. **Folder picker** (for Move/Copy): a dialog/sheet that browses folders only, starting at
   `/Home`, with breadcrumbs, **New folder**, and **Move here / Copy here**. MUST refuse moving
   a folder into itself or its own sub-folder (`FolderPaths.isInside`) with a clear message.
8. **New folder**: from the Folder screen's top bar or a FAB; dialog with a name field.
9. **Rename** dialog pre-filled with the current name (select the part before the extension).
10. **Empty Trash**: action in the Trash top bar, confirm dialog ("This can't be undone"),
    disabled when Trash is empty.
11. **Info** sheet: name, kind, size (`formatBytes`), folder, modified date, starred; in Trash
    also "Deleted on" and "Was in".
12. **More** tab: signed-in username, server address, links to **Trash** and **Telegram
    Inbox**, and **Sign out** (calls `api.logout()` then `session.signedOut()`).

Dates from the server are ISO strings; some older ones have no time-zone (they are UTC). Show
them in local time as e.g. "Oct 22" (this year) or "Oct 22, 2025"; a helper in `:core` with a
unit test is welcome.

## 6. Definition of done (the reviewer checks each item)

- [ ] Branch `feat/android-phase2-browse`, pushed, only `android/` changed.
- [ ] `./gradlew :core:test` passes, with the new tests from section 4.
- [ ] The **Android** GitHub Actions run for the branch is green (lint + build + `:core` tests).
- [ ] No network call outside `TeleStoreApi`/Coil; no `runBlocking` in `:app`; every API call
      wrapped as in section 0.
- [ ] Everything in section 5 works: tabs, folders, breadcrumbs, sort/view, paging, refresh,
      search, Starred, Recent, Trash (restore, delete forever, empty), Inbox, item sheet,
      multi-select with bulk actions, folder picker (refuses into-itself), new folder, rename,
      info, More with sign out.
- [ ] No hard-coded server address other than `ServerAddress.DEFAULT`; no secrets in code.
- [ ] A short `android/docs/PHASE_2_NOTES.md`: what was built, any deviations from this prompt
      and why, and anything left unfinished.

## 7. Out of scope (do NOT build now)

Video/audio/photo playback (Phase 3), uploads/downloads/Transfers (Phase 4), Private Vault,
Google Drive, leech/Instagram/YouTube, user admin, settings beyond More, tablet-specific layouts
beyond the adaptive grid.

When finished, reply with: the branch name, the commit list, the test results, and the link to
the green Android workflow run.
