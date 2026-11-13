# TeleStore for Windows

Uploads files and folders **straight from your PC to Telegram**, at your own connection's speed.
No file data passes through the TeleStore server, so big uploads don't depend on the server's bandwidth.
Everything else (the website, the Android app, cloud transfers, the workers) is unchanged; the files
this app uploads show up there like any other.

## The window

It looks and works like the TeleStore website, in light or dark (like Windows, or chosen in Settings):

- **The sidebar**: **New** (Upload files, Upload folder, New folder); **Library**: Home, Recent, Starred,
  Shared with me, Shared by me, Trash; **Photos**; **Activity**: Transfers (with a count while something
  runs) and Storage; the storage meter (click it for Storage) and your account (Settings, Check for updates,
  the website, Sign out).
- **The top bar**: search (Ctrl+F), **Update to x.y.z** when a new version is out, the **notifications**
  bell (with the unread count) and **Details** (Alt+Enter).
- **The files**: breadcrumbs (Home › Movies › 2024; click one to go back there), search, grid or list.
  Double-click a folder to go in; **Back** (Alt+←, Backspace or the arrow) goes out. F5 refreshes, Ctrl+F searches.
- **Opening files** (double-click): photos in a viewer (← → for the next one), videos and music in a
  player (Space, ← →, F for full screen), anything else is downloaded and opened with its Windows app.
  Right-click › **Download** saves a copy (see Downloads).
- **Straight from Telegram** (Settings › Viewing, on by default): your own files open, play and download
  from your storage channel with your Telegram account, at your home connection's speed, without using
  the TeleStore server's bandwidth. The app runs a small web server on this PC only (127.0.0.1, with a
  random secret in every address) that streams the file from Telegram with byte ranges, so videos start
  at once and seeking works; the server only says which messages hold the file (`GET /direct/locate`).
  Files shared with you and Private Vault files open through the TeleStore server, as on the website.
- **Right-click**, the bar that appears while something is selected, or the keys: Open, Download, Details, Rename (F2), Move to…, Add to / Remove from Starred,
  Share… (people as Viewer or Editor, and a link anyone can open), Move to Trash (Delete). In Trash:
  Restore, Delete forever, and **Empty trash** at the top. Protected items say why they can't be deleted.
- **Uploads go into the folder you're looking at**: drop files or folders on the window, or New › Upload.
  A panel in the bottom corner shows each file's progress, speed and time left, with pause, resume and
  cancel; it hides once everything is done.

## Pages

- **Photos**: as on the website and in the Android app, the phone backup (`/Home/Phone Backup`) newest
  first, grouped by the day it was taken under month titles, loading more as you scroll; the button at the
  top switches between Day and Month (smaller tiles). **Albums** are the folders inside the backup,
  **Favourites** the starred photos and videos, **Archive** what was archived. Videos show their length.
  Click to select (Ctrl / Shift add), double-click to open, right-click to download, star, share or trash.
- **Shared by me**: everything you share, who has it and whether its link is on (and its download count
  or expiry); right-click to open, manage the sharing, copy the link or stop sharing.
- **Transfers**: uploads from this PC, downloads to it, and what the server transfers for you (links,
  torrents, cloud drives; a folder transfer is one row), with filters (Active, Uploads, Downloads, On the
  server, Finished, Failed), pause / resume / cancel / try again, and Clear finished.
- **Storage**: used of your quota, a bar by kind of file (videos, photos, audio, documents, archives), the
  counts, Trash (click to open it) and the largest files.
- **Details** (the ⓘ button): a preview, type, size, location, dates, length; for a folder how many files
  and folders it holds and their total size; and who it's shared with.
- **Notifications**: something shared with you, transfers that finished or failed, a file in the Telegram
  Inbox, storage almost full, a new sign-in. Clicking one opens where it points; new ones also pop up in
  Windows (from the tray icon) when TeleStore isn't the window you're using.

## Downloads

Select files and folders (or right-click) and choose **Download**: everything goes to your Downloads
folder (Settings › Downloads go to), several at a time. A **folder keeps its layout**: its files are saved
in the same folders on this PC. Names never overwrite (`photo (1).jpg`). Your own files come straight
from Telegram; files shared with you come through TeleStore. Pause, resume, cancel and try again from the
corner panel or Transfers; a stopped download continues from where it was (`.part` file).

## Installing and updates

Each build publishes **`TeleStore-Setup-<version>.exe`** (installs for your Windows user, no administrator
needed, into `%LOCALAPPDATA%\Programs\TeleStore`, with a Start menu entry, an optional desktop icon and an
uninstaller) and **`TeleStore-<version>-portable.exe`** (runs without installing).

The app looks for a new version at start and every 6 hours (Settings › Updates; Beta follows every merge
to main, the rolling `windows-latest` release; Stable only tagged `windows-vX.Y.Z` releases). When one is
out, **Update to x.y.z** appears in the top bar: it shows what's new, downloads the installer and runs it;
TeleStore closes, updates and opens again. Uploads that were running continue afterwards. Sign-ins,
settings and unfinished uploads are in `%APPDATA%\TeleStore`, so updating or uninstalling keeps them.

## How uploads work

1. **Sign in to TeleStore** with the same username and password as the website.
2. **Sign in to Telegram once** (phone number, code, and the two-step password if you have one) with
   the account that owns your TeleStore storage channel. The session is saved only on this PC,
   encrypted for your Windows account (DPAPI). The app has no bot token and no database password.
3. For each file the app:
   - asks the server where it goes (`POST /direct/prepare`): your storage channel, and its parts;
   - sends it to the channel with your Telegram account. A file over 1.95 GB is sent in 1.95 GB parts,
     each **read by position from the original file** (no copies on disk), several at once;
   - asks the server to save it (`POST /direct/complete`). The server's bot checks the messages are in
     your channel with the right sizes, then saves the file in the usual format.

A folder keeps its layout: its sub-folders are made in TeleStore first. Empty files are skipped
(Telegram can't store them). The Private Vault isn't supported yet.

## Uploads continue where they stopped

Each part's Telegram message is saved in the upload list (`%APPDATA%\TeleStore\uploads.json`) as soon
as it's sent. After a pause, a failure, Wi-Fi dropping or closing the app, **Resume / Retry** (or the
next start) sends only the parts still missing. A file that changed since it was added isn't sent.

## Speed

Telegram's own client library sends one file over one connection, 4 pieces of 512 KB at a time,
about 5 MB/s whatever the line. The app sends a file over a few connections at once (about 12
pieces in flight, `fast_upload.py`), so one file can use most of a fast home connection, and two
files or parts go at the same time. Each piece is sent again if it fails; anything unexpected makes
that file go the library's usual way. When Telegram asks to slow down, the app waits and continues.
*Settings → Limit upload speed* caps the total.

## Files on this PC (`%APPDATA%\TeleStore`)

| File | What |
|---|---|
| `settings.json` | server, username, speed limit, theme, grid or list, last folder |
| `thumbs\` | thumbnails already seen |
| `opened\` | files downloaded to open them |
| `telestore.auth` | TeleStore sign-in (encrypted) |
| `telegram.session` | Telegram sign-in (encrypted) |
| `uploads.json` | the upload list and the parts already sent |
| `app.log` | the app's log |

*Settings → Sign out of Telegram / TeleStore* removes the sign-ins.

## Building and testing

The GitHub workflow `.github/workflows/windows.yml` tests and builds `TeleStore-<version>.exe` on
Windows with PyInstaller. Every merge to `main` publishes the **windows-latest** pre-release; a tag
like `windows-v1.0.0` makes a versioned release.

To run it from source (Python 3.12):

```
cd windows
pip install -r requirements.txt
python -m telestore_desktop
python -m pytest tests          # QT_QPA_PLATFORM=offscreen is set by the tests
```

The server side is `telestore/api/routes/direct.py` (tests: `tests/test_direct_upload.py`). By
default the app signs in to Telegram with the server's own Telegram app ID (`API_ID` / `API_HASH`);
set `DESKTOP_API_ID` / `DESKTOP_API_HASH` in the server's `.env` to give the desktop app one of its own
(made at my.telegram.org).
