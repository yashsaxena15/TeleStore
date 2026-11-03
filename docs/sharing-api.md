# Sharing API

Sharing works like Google Drive. A file or folder can be shared with other TeleStore accounts as
**viewer** or **editor**, and by a view-only **link**. The server code is in
`telestore/api/routes/shares.py` and `telestore/services/share_service.py`.

Every route also answers under `/api/…`. Signed-in routes take the usual `X-Auth-Token` header
or `?token=`.

## Common shapes

`ShareItem`, a file or folder as shown in sharing views:
```json
{"id": "<file _id>", "name": "beach.jpg", "type": "photo|video|audio|document|voice|folder",
 "size": 1234, "modified_date": "…", "taken_at": "…|null", "duration": 12.5,
 "has_thumb": true, "path": "/Day 1"}
```
- `path` is the folder the item sits in, relative to the shared folder. `""` means directly inside it.
- Paths sent to share routes are relative the same way: `""` is the shared folder itself, and
  `"/Day 1"` is a folder inside it. `..` is refused.

`ShareView`, what the Share dialog shows:
```json
{"share_id": "sh_…|null", "item": ShareItem,
 "link": null | {"enabled": true, "token": "…", "allow_download": true,
                 "expires_at": "ISO|null", "max_downloads": 5|null, "downloads": 2,
                 "state": "active|off|expired|used_up"},
 "members": [{"user_id": "222", "username": "alice", "name": "Alice",
              "email": "…|null", "role": "viewer|editor"}]}
```
- The link's public page is `{site}/s/{token}`.

Errors come back as `{"detail": "<message to show>"}`:
- 404 means not found, or not shared with you.
- 410 means the link is off, expired or used up, or the item is in Trash. `detail` says which.
- 403 means you're a viewer, or downloads are off for the link.
- 400 means the request was invalid, for example a Vault item.
- 429 comes with `Retry-After`.

## The owner (Share dialog)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/shares/item/{item_id}` | | ShareView |
| PUT | `/shares/item/{item_id}/link` | `{enabled, allow_download?, expires_at?, clear_expiry?, max_downloads?, clear_limit?}` | ShareView |
| POST | `/shares/item/{item_id}/link/reset` | | ShareView (new token) |
| POST | `/shares/item/{item_id}/members` | `{who: username or email, role}` | ShareView |
| PATCH | `/shares/item/{item_id}/members/{user_id}` | `{role}` | ShareView |
| DELETE | `/shares/item/{item_id}/members/{user_id}` | | ShareView |
| DELETE | `/shares/item/{item_id}` | | ShareView (no longer shared) |
| GET | `/shares/mine` | | `{shares: [{share_id, item, location: "/Home/…" (its folder in your files), trashed, link, members: <count>, created_at}]}` |

How the link settings work:
- `enabled: true` creates the link if there isn't one yet. Turning it off keeps its address, so
  turning it back on revives the same link.
- Setting `max_downloads` restarts the download count.

What owners see in their own listings:
- Thumbnails of your own items: `GET /files/preview/{id}` (works for photos and videos by item id).
- `GET /files` items now carry `shared: true|false`, used for the "Shared" marker.
- Vault items can't be shared, so clients hide Share for them.

## Shared with me (members)

| Method | Path | Returns |
|---|---|---|
| GET | `/shares/with-me` | `{shares: [{share_id, role, owner: {username, name}, item: ShareItem, shared_at}]}` |
| GET | `/shares/{share_id}/browse?path=` | `{share_id, role, owner: {name}, root: ShareItem, path, items: [ShareItem]}` |
| GET | `/shares/{share_id}/dl/{file_id}?inline=1` | the file (ranges work); `inline=1` to play or view |
| GET | `/shares/{share_id}/thumb/{file_id}` | JPEG thumbnail |
| GET | `/shares/{share_id}/zip-info?path=` | `{folder_name, total_files, total_size, total_parts, parts: [{part_index, name, size, files_count, download_url}]}` |
| GET | `/shares/{share_id}/zip?path=&part=` | a zip part |

Editors only. A viewer gets 403. Changes stay inside the shared folder and are made as its owner:

| Method | Path | Body |
|---|---|---|
| POST | `/shares/{share_id}/folders` | `{path, name}` |
| POST | `/shares/{share_id}/rename` | `{file_id, new_name}` |
| POST | `/shares/{share_id}/move` | `{file_id, target_path}` |
| POST | `/shares/{share_id}/trash` | `{file_id}` (goes to the owner's Trash) |

Rules for editors:
- **Upload:** use the normal chunked upload with `share_id` added to `POST /files/upload/init`:
  `{filename, filesize, path: "<relative>", share_id}`. The chunk, complete and status calls are
  unchanged. The file belongs to the folder's owner.
- **The shared folder itself** can be renamed, but not moved or trashed.

Notifications:
- A new member gets a notification of kind `"share"` with target `{"type": "shared", "share_id"}`.
- Members with an email address also get an email linking to `{site}/shared-with-me`.

## Anyone with the link (no sign-in)

| Method | Path | Returns |
|---|---|---|
| GET | `/share-links/{token}/info` | `{item: ShareItem, owner_name, allow_download, expires_at, downloads_left}` |
| GET | `/share-links/{token}/list?path=` | `{path, items: [ShareItem]}`; for a file link, the file itself |
| GET | `/share-links/{token}/dl/{file_id}?inline=1` | the file; without `inline` it's a download: 403 when downloads are off, and counts toward the limit |
| GET | `/share-links/{token}/thumb/{file_id}` | JPEG |
| GET | `/share-links/{token}/zip-info?path=` / `zip?path=&part=` | as above (each part counts as one download; 403 when downloads are off) |

How downloads are counted:
- Only a download from the start of the file counts. Seeks and later chunks of the same download
  don't.
- Viewing with `inline=1` doesn't count.
