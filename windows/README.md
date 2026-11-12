# TeleStore for Windows

Uploads files and folders **straight from your PC to Telegram**, at your own connection's speed.
No file data passes through the TeleStore server, so big uploads don't depend on the server's bandwidth.
Everything else (the website, the Android app, cloud transfers, the workers) is unchanged; the files
this app uploads show up there like any other.

## The window

It looks and works like the TeleStore website, in light or dark (like Windows, or chosen in Settings):

- **The sidebar**: **New** (Upload files, Upload folder, New folder), then **Home, Recent, Starred,
  Shared with me, Photos, Trash**, your storage used, and your account (Settings, the website, Sign out).
- **The files**: breadcrumbs (Home › Movies › 2024; click one to go back there), search, grid or list.
  Double-click a folder to go in; **Back** (Alt+←, Backspace or the arrow) goes out. F5 refreshes, Ctrl+F searches.
- **Opening files** (double-click): photos in a viewer (← → for the next one), videos and music in a
  player (Space, ← →, F for full screen), anything else is downloaded and opened with its Windows app.
  Right-click › **Download…** saves a copy. In this version these come through the TeleStore server, as on
  the website.
- **Right-click** (or the keys): Open, Download…, Rename (F2), Move to…, Add to / Remove from Starred,
  Share… (people as Viewer or Editor, and a link anyone can open), Move to Trash (Delete). In Trash:
  Restore, Delete forever, and **Empty trash** at the top. Protected items say why they can't be deleted.
- **Uploads go into the folder you're looking at**: drop files or folders on the window, or New › Upload.
  A panel in the bottom corner shows each file's progress, speed and time left, with pause, resume and
  cancel; it hides once everything is done.

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
