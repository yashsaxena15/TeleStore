// A small stand-in for the TeleStore backend, used by the Playwright tests.
// Serves the built app from `dist` plus canned API answers. Every POST/PUT/DELETE is
// recorded and can be read back from GET /__requests (and cleared with DELETE /__requests).
//
// Usage: node e2e/mock-server.mjs <distDir> <port>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.argv[2] || path.join(here, "..", "dist"));
const PORT = Number(process.argv[3] || 4173);

const DATES = ["2026-10-17T10:00:00Z", "2026-10-03T10:00:00Z", "2026-09-12T10:00:00Z", "2026-10-19T09:20:00Z", "2026-10-12T10:00:00Z", "2026-10-13T10:00:00Z", "2026-10-07T10:00:00Z", "2025-12-30T10:00:00Z"];
const file = (i, name, type, size, filePath = "/Home", extra = {}) => ({
    id: `f${i}`, file_unique_id: `u${i}`, file_name: name, file_type: type, file_size: size, file_path: filePath,
    modified_date: DATES[(i - 1) % DATES.length], chat_id: -100, message_id: i, ...extra,
});

const FOLDERS = {
    "/Home": [
        file(1, "Movies", "folder", 0), file(2, "Documents", "folder", 0), file(3, "Music", "folder", 0),
        file(4, "Dune.Part.Two.2024.2160p.HDR.mkv", "video", 62_400_000_000, "/Home", { starred: true }),
        file(5, "Q3-report.pdf", "document", 2_300_000), file(6, "Hans Zimmer - Dune Suite.flac", "audio", 48_200_000),
        file(7, "project-src.zip", "archive", 412_000_000), file(8, "team-offsite.jpg", "photo", 4_800_000),
    ],
    "/Home/Movies": [
        file(11, "Arrival.2016.1080p.mkv", "video", 4_200_000_000, "/Home/Movies"),
        file(12, "Blade.Runner.2049.mkv", "video", 9_800_000_000, "/Home/Movies"),
        file(13, "poster.jpg", "photo", 1_200_000, "/Home/Movies"),
    ],
};
// Trash: a deleted folder and a deleted file
FOLDERS["/trash"] = [
    file(90, "Old stuff", "folder", 0, "/Home", { trashed: true, trashed_at: "2026-10-20T10:00:00+00:00", original_path: "/Home" }),
    file(91, "old-notes.txt", "document", 12_000, "/Home", { trashed: true, trashed_at: "2026-10-21T10:00:00+00:00", original_path: "/Home" }),
];
// A folder of songs, to check that a long audio queue scrolls
FOLDERS["/Home/Music"] = Array.from({ length: 20 }, (_, n) => file(3000 + n, `Song ${String(n + 1).padStart(2, "0")}.mp3`, "audio", 5_000_000, "/Home/Music"));
// A file too big to collect in the page: it goes to the browser's own downloads
FOLDERS["/Home/Music"].push(file(500, "huge-backup.zip", "archive", 300 * 1024 * 1024, "/Home/Music"));
// A big folder, to check that long lists stay quick to render
FOLDERS["/Home/Documents"] = Array.from({ length: 1500 }, (_, n) => file(1000 + n, `scan-${String(n + 1).padStart(4, "0")}.pdf`, "document", 120_000 + n, "/Home/Documents"));

const ROUTES = {
    "/auth/check": { authenticated: true, username: "admin" },
    "/user/profile": { username: "admin", email: "owner@example.com", telegram_first_name: "Yash" },
    "/user/is-owner": { is_owner: true },
    "/user": { users: [
        { id: "1", username: "admin", email: "owner@example.com", active: true, can_upload: true, is_owner: true, has_telegram: true, has_index_chat: true, user_type: "local" },
        { id: "u2", username: "family", email: "family@example.com", active: true, can_upload: true, has_telegram: false, has_index_chat: false, user_type: "local" },
    ] },
    "/user/index-chat": { index_chat_id: -1004314578828 },
    "/cloud/accounts": { accounts: [{ id: "acc1", account_name: "My Drive", account_email: "me@gmail.com" }] },
    "/cloud/acc1/storage": { usageInDrive: 10_200_000_000, limit: 15_000_000_000 },
    "/vault/status": { is_setup: true, is_unlocked: false, email: "ow***er@example.com", remaining_seconds: 0, auto_lock_minutes: 15 },
    "/api/health": { status: "healthy" },
    "/auth/google/config": { client_id: null },
    "/transfers/remote/instagram/session": { connected: false, username: null },
    "/transfers/remote/media/settings": { version: "2026.10.21", builtin_version: "2026.10.21", updated: false, has_cookies: false, cookie_sites: [], cookies_updated_at: null, youtube_sign_in: null, pot_helper: true },
    "/transfers/remote/media/syncs": { every_hours: 6, syncs: [
        { id: "sync_1", title: "Daily mix", url: "https://www.youtube.com/playlist?list=PLmix", is_channel: false, choice: { mode: "audio", audio_format: "mp3" }, destination_label: "/Home/Music", enabled: true, known_count: 40, last_checked: "2026-10-22T08:00:00Z", last_new_count: 2, last_error: null },
    ] },
    "/cloud/acc1/files": { files: [{ id: "fold9", name: "Instagram saves", is_folder: true }, { id: "doc1", name: "notes.txt", is_folder: false }] },
    "/files/analytics": {
        quota_bytes: 100 * 1024 ** 4, free_bytes: 100 * 1024 ** 4 - 214_000_000_000,
        total_bytes: 214_000_000_000, total_files: 1843, total_folders: 96, starred_count: 12, trash_count: 7, trash_bytes: 3_400_000_000,
        by_category: { video: { count: 312, bytes: 168_000_000_000 }, audio: { count: 640, bytes: 9_800_000_000 }, photo: { count: 702, bytes: 6_100_000_000 }, document: { count: 151, bytes: 1_900_000_000 }, archive: { count: 31, bytes: 26_000_000_000 }, other: { count: 7, bytes: 2_200_000_000 } },
        largest_files: [
            { id: "f4", file_name: "Dune.Part.Two.2024.2160p.HDR.mkv", file_size: 62_400_000_000, file_type: "video", file_path: "/Home" },
            { id: "f7", file_name: "project-src.zip", file_size: 412_000_000, file_type: "archive", file_path: "/Home" },
        ],
    },
    "/media/cache/stats": { chunk_count: 1820, header_count: 44, total_size_formatted: "18.2 GB", max_size_formatted: "25 GB", usage_percent: 45.5, free_disk_space_formatted: "112 GB" },
    "/transfers/remote/tasks": { tasks: [
        { task_id: "t1", filename: "ubuntu-24.04.1-desktop-amd64.iso", filesize: 5_700_000_000, transferred_bytes: 3_600_000_000, speed_bps: 12_400_000, status: "downloading", progress: 63, source_type: "magnet", peer_count: 48 },
        { task_id: "t5", filename: "old-backup.tar.gz", filesize: 1_200_000_000, transferred_bytes: 0, status: "failed", progress: 0, source_type: "url", error_message: "HTTP 403 from source", created_at: "2026-10-18T20:00:00Z" },
        // A Google Drive folder copy whose files failed (the summary says why)
        { task_id: "g1", filename: "IMG_001.jpg", filesize: 2_000_000, transferred_bytes: 0, status: "failed", progress: 0, source_type: "direct_url", group_id: "drive1", group_name: "Goa trip", group_type: "folder", error_message: "Google Drive refused the download (its sign-in had expired). Tap Retry.", created_at: "2026-10-27T20:00:00Z" },
    ], groups: {
        drive1: { total: 3, counts: { completed: 1, failed: 2 }, filesize: 6_000_000, transferred_bytes: 2_000_000, speed_bps: 0, error: "Google Drive refused the download (its sign-in had expired). Tap Retry." },
    } },
};

// Notifications for the bell: one unread (a finished transfer), two already read
const NOTIFICATIONS = [];
const resetNotifications = () => {
    NOTIFICATIONS.length = 0;
    const ago = (min) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d+Z$/, "");
    NOTIFICATIONS.push(
        { id: "n3", kind: "transfer", title: "Transfer finished", body: "ubuntu-24.04.1-desktop-amd64.iso is saved.", target: { type: "transfers" }, created_at: ago(5), read: false },
        { id: "n2", kind: "inbox", title: "New file in Telegram Inbox", body: "scan.pdf", target: { type: "folder", path: "/Telegram Inbox" }, created_at: ago(90), read: true },
        { id: "n1", kind: "sign_in", title: "New sign-in", body: "Chrome on Windows", target: { type: "settings" }, created_at: ago(60 * 30), read: true },
    );
};
resetNotifications();
const notificationsJson = () => ({ items: NOTIFICATIONS, unread: NOTIFICATIONS.filter((n) => !n.read).length, latest: NOTIFICATIONS[0]?.id || null });

// Your devices (Settings › Account): this browser, the phone app and an old sign-in
const DEVICES = [];
const resetDevices = () => {
    DEVICES.length = 0;
    const ago = (min) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d+Z$/, "");
    DEVICES.push(
        { id: "d1", name: "Chrome on Linux", kind: "browser", method: "password", signed_in_at: ago(60 * 24), last_seen: ago(0), current: true },
        { id: "d2", name: "Android app", kind: "app", method: "password", signed_in_at: ago(60 * 48), last_seen: ago(12), current: false },
        { id: "d3", name: "Unknown device (signed in before this update)", kind: "browser", method: "google", signed_in_at: ago(60 * 24 * 9), last_seen: ago(60 * 24 * 3), current: false },
    );
};
resetDevices();

const requests = [];
const uploadState = { sentOne: false };

const send = (res, code, body, type = "application/json") => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    res.writeHead(code, { "Content-Type": type, "Content-Length": data.length });
    res.end(data);
};

// Photos: the phone backup, newest taken first (one with a Telegram thumbnail, two without)
const PHOTOS = [
    { id: "ph1", file_name: "IMG_0003.HEIC", file_type: "document", file_size: 3_100_000, file_path: "/Home/Phone Backup/Camera", taken_at: new Date().toISOString(), modified_date: new Date().toISOString() },
    { id: "ph2", file_name: "VID_0002.mp4", file_type: "document", file_size: 9_400_000, file_path: "/Home/Phone Backup/Camera", taken_at: new Date().toISOString(), modified_date: new Date().toISOString() },
    { id: "ph3", file_name: "IMG_0001.jpg", file_type: "photo", thumbnail: "THUMB1", file_size: 2_000_000, file_path: "/Home/Phone Backup/Camera", taken_at: "2025-01-03T10:00:00", modified_date: "2026-10-01T10:00:00" },
];
// Playlists: Liked music plus one of the user's, holding songs from /Home/Music
const songById = (id) => FOLDERS["/Home/Music"].find((f) => String(f.id) === String(id));
const PLAYLISTS = [];
const resetPlaylists = () => {
    PLAYLISTS.length = 0;
    PLAYLISTS.push({ id: "liked", name: "Liked music", kind: "liked", items: ["f3001"] }, { id: "pl1", name: "Road trip", kind: "user", items: ["f3000", "f3002", "f3003"] });
};
resetPlaylists();
const playlistJson = (p, withItems = false) => {
    const files = p.items.map(songById).filter(Boolean);
    return { id: p.id, name: p.name, kind: p.kind, count: p.items.length, file_ids: [...p.items], cover: files[0] || null, ...(withItems ? { items: files } : {}) };
};
const playlistRoute = (req, res, url, body) => {
    const parts = url.pathname.split("/").slice(3); // after /files/playlists
    const data = body ? JSON.parse(body) : {};
    if (!parts.length) {
        if (req.method === "GET") return send(res, 200, { playlists: PLAYLISTS.map((p) => playlistJson(p)) });
        const made = { id: `pl${PLAYLISTS.length + 1}`, name: data.name, kind: "user", items: [...(data.file_ids || [])] };
        PLAYLISTS.push(made);
        return send(res, 200, { ...playlistJson(made), added: made.items.length });
    }
    if (parts[0] === "like") {
        const liked = PLAYLISTS[0];
        liked.items = data.liked ? [data.file_id, ...liked.items.filter((i) => i !== data.file_id)] : liked.items.filter((i) => i !== data.file_id);
        return send(res, 200, { liked: Boolean(data.liked) });
    }
    const p = PLAYLISTS.find((x) => x.id === parts[0]);
    if (!p) return send(res, 404, { detail: "Playlist not found" });
    if (parts.length === 1) {
        if (req.method === "GET") return send(res, 200, playlistJson(p, true));
        if (req.method === "DELETE") {
            if (p.kind === "liked") return send(res, 400, { detail: "“Liked music” can't be deleted" });
            PLAYLISTS.splice(PLAYLISTS.indexOf(p), 1);
            return send(res, 200, { deleted: true });
        }
        p.name = data.name;
        return send(res, 200, playlistJson(p));
    }
    if (parts[1] === "items" && parts[2] === "remove") p.items = p.items.filter((i) => !data.file_ids.includes(i));
    else if (parts[1] === "items") {
        const fresh = data.file_ids.filter((i) => !p.items.includes(i));
        p.items.push(...fresh);
        return send(res, 200, { ...playlistJson(p), added: fresh.length });
    }
    else if (parts[1] === "order") p.items = [...data.file_ids];
    return send(res, 200, playlistJson(p));
};

// A 1×1 PNG for thumbnails and previews
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const listFiles = (url) => {
    const p = (url.searchParams.get("path") || "/Home").replace(/\/+$/, "") || "/Home";
    const under = url.searchParams.get("under");
    // Photos: the backup, or one album (a folder in it); the backup folder itself lists its albums
    const all = p === "all" && under?.startsWith("/Home/Phone Backup") ? PHOTOS.filter((f) => `${f.file_path}/`.startsWith(`${under}/`))
        : p === "/Home/Phone Backup" ? [{ id: "alb1", file_name: "Camera", file_type: "folder", file_path: "/Home/Phone Backup" }, { id: "alb2", file_name: "WhatsApp Images", file_type: "folder", file_path: "/Home/Phone Backup" }]
            : (FOLDERS[p] || []);
    const page = Number(url.searchParams.get("page") || 1);
    // No page size means "All" in the pagination menu
    const size = url.searchParams.has("page_size") ? Number(url.searchParams.get("page_size")) : all.length || 1;
    const items = all.slice((page - 1) * size, page * size);
    const totalPages = Math.max(1, Math.ceil(all.length / size));
    return { files: items, pagination: { page, page_size: size, total_items: all.length, total_pages: totalPages, start_index: (page - 1) * size + 1, end_index: (page - 1) * size + items.length, has_next: page < totalPages, has_prev: page > 1 } };
};

const MEDIA = { ".mkv": ["sample.webm", "video/webm"], ".mp4": ["sample.webm", "video/webm"], ".webm": ["sample.webm", "video/webm"], ".flac": ["sample.ogg", "audio/ogg"], ".mp3": ["sample.ogg", "audio/ogg"], ".ogg": ["sample.ogg", "audio/ogg"] };

const serveMedia = (req, res, name) => {
    const [fixture, type] = MEDIA[path.extname(name).toLowerCase()];
    const data = fs.readFileSync(path.join(here, "fixtures", fixture));
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (!range) {
        res.writeHead(200, { "Content-Type": type, "Content-Length": data.length, "Accept-Ranges": "bytes" });
        return res.end(data);
    }
    const start = Number(range[1] || 0);
    const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Accept-Ranges": "bytes" });
    res.end(data.subarray(start, end + 1));
};

const mutation = (req, res, url, body) => {
    requests.push({ method: req.method, path: url.pathname, body });
    if (url.pathname === "/user/notifications/read") {
        const data = JSON.parse(body || "{}");
        NOTIFICATIONS.forEach((n) => { if (data.all || (data.ids || []).includes(n.id)) n.read = true; });
        return send(res, 200, { unread: notificationsJson().unread });
    }
    if (url.pathname === "/auth/devices/sign-out-others") {
        const count = DEVICES.filter((d) => !d.current).length;
        DEVICES.splice(0, DEVICES.length, ...DEVICES.filter((d) => d.current));
        return send(res, 200, { signed_out: count });
    }
    if (url.pathname.startsWith("/auth/devices/") && req.method === "DELETE") {
        const at = DEVICES.findIndex((d) => d.id === decodeURIComponent(url.pathname.split("/").pop()));
        if (at < 0) return send(res, 404, { detail: "That device is already signed out." });
        DEVICES.splice(at, 1);
        return send(res, 200, { message: "Signed out." });
    }
    if (url.pathname === "/auth/login") {
        return body.includes('"password":"wrong"') ? send(res, 401, { detail: "Incorrect username or password" }) : send(res, 200, { message: "Login successful", username: "admin", auth_token: "test-token" });
    }
    if (url.pathname === "/auth/forgot-password/request") {
        return send(res, 200, { message: "If that account has an email address, we've sent a 6-digit code to it." });
    }
    if (url.pathname === "/transfers/remote/instagram/preview") {
        return body.includes("/p/MISSING")
            ? send(res, 400, { detail: "This post is private or was removed." })
            : send(res, 200, { shortcode: "ABCdef12345", owner: "nasa", caption: "Earth from orbit", thumbnail: null, items: [{ index: 1, is_video: false }, { index: 2, is_video: true }] });
    }
    // Chunked uploads: 2-byte chunks sent as raw PUT bodies. The first time chunk 1 arrives the
    // server says "disk buffer full, try again in a second" (429). Continuing an upload after a
    // reload: init with resume_upload_id "up-old" says chunk 0 is already there.
    if (url.pathname === "/files/upload/init") {
        uploadState.sentOne = false;
        const resumed = body.includes('"resume_upload_id":"up-old"');
        return send(res, 200, { upload_id: resumed ? "up-old" : "up1", chunk_size: 2, part_max_size: 1950 * 1024 * 1024, received: resumed ? [0] : [], resumed });
    }
    const chunkPut = /^\/files\/upload\/chunk\/([^/]+)\/(\d+)$/.exec(url.pathname);
    if (chunkPut) {
        const index = Number(chunkPut[2]);
        if (index === 1 && !uploadState.sentOne) {
            uploadState.sentOne = true;
            res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" });
            return res.end(JSON.stringify({ detail: "Waiting for earlier parts", retry_after: 1 }));
        }
        return send(res, 200, { status: "ok", chunk_index: index });
    }
    if (url.pathname === "/files/upload/complete") {
        return send(res, 200, { status: "completed", file: { id: "new1", file_name: "notes.txt" } });
    }
    if (url.pathname === "/transfers/remote/media/preview") {
        if (body.includes("127.0.0.1"))
            return send(res, 400, { detail: "Links to private or local network addresses can't be downloaded." });
        if (body.includes("playlist"))
            return send(res, 200, { kind: "playlist", title: "Road trip", uploader: "Yash", site: "YoutubeTab", count: 3, thumbnail: null,
                entries: [{ index: 1, title: "Song one", duration: 201 }, { index: 2, title: "Song two", duration: 185 }, { index: 3, title: "Song three", duration: 3725 }] });
        if (body.includes("facebook.com"))
            return send(res, 200, { kind: "video", title: "How to Share With Just Friends", uploader: "Facebook", site: "Facebook", duration: 47, count: 1, thumbnail: null,
                options: { video: [{ value: "fmt:hd", label: "HD", size: 0 }, { value: "fmt:sd", label: "SD", size: 0 }], audio: [] },
                entries: [{ index: 1, title: "How to Share With Just Friends", duration: 47 }] });
        return send(res, 200, { kind: "video", title: "Never Gonna Give You Up", uploader: "Rick Astley", site: "Youtube", duration: 213, count: 1, thumbnail: null,
            options: {
                video: [2160, 1440, 1080, 720, 480, 360, 240, 144].map((h) => ({ value: String(h), height: h, fps: 25, hdr: false, size: h * 110_000 })),
                audio: [{ id: "140", codec: "AAC", abr: 130, size: 3_449_447 }, { id: "251", codec: "Opus", abr: 129, size: 3_433_755 }, { id: "249", codec: "Opus", abr: 46, size: 1_231_355 }],
            },
            entries: [{ index: 1, title: "Never Gonna Give You Up", duration: 213 }] });
    }
    if (url.pathname === "/transfers/remote/media/cookies" && req.method === "POST") {
        return send(res, 200, { version: "2026.10.21", builtin_version: "2026.10.21", updated: false, has_cookies: true, cookie_sites: ["youtube.com"], cookies_updated_at: "2026-10-22T10:00:00Z", youtube_sign_in: "signed_in", pot_helper: true });
    }
    if (url.pathname === "/transfers/remote/media/update") {
        return send(res, 200, { version: "2026.11.03", builtin_version: "2026.10.21", updated: true, has_cookies: false, cookie_sites: [], youtube_sign_in: null, pot_helper: true });
    }
    if (url.pathname === "/transfers/remote/media/syncs/sync_1/check") {
        return send(res, 200, { new: 3, sync: {} });
    }
    if (url.pathname === "/transfers/remote/media") {
        return send(res, 200, { success: true, message: "Downloading 2 video files.", count: 2, tasks: [] });
    }
    if (url.pathname === "/transfers/remote/instagram/session/browser") {
        return send(res, 200, { connected: true, username: "spare.account" });
    }
    if (url.pathname === "/transfers/remote/instagram") {
        return send(res, 200, { success: true, message: "Importing 2 items from @nasa.", count: 2, tasks: [] });
    }
    if (url.pathname === "/vault/unlock") {
        return send(res, 429, { detail: "Too many wrong attempts. Try again in 1 minute." }, "application/json");
    }
    if (url.pathname === "/user" && req.method === "POST") {
        const data = JSON.parse(body || "{}");
        return send(res, 200, { id: "u9", username: data.username, email: data.email, active: true, can_upload: data.can_upload !== false, has_telegram: false, has_index_chat: false, user_type: "local", created_at: "2026-10-21" });
    }
    send(res, 200, { success: true });
};

http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
        if (url.pathname === "/__requests") {
            if (req.method === "DELETE") {
                requests.length = 0;
                resetPlaylists();
                resetNotifications();
                resetDevices();
            }
            return send(res, 200, requests);
        }
        if (url.pathname.startsWith("/files/playlists")) {
            if (req.method !== "GET") requests.push({ method: req.method, path: url.pathname, body });
            return playlistRoute(req, res, url, body);
        }
        if (req.method !== "GET" && req.method !== "HEAD") return mutation(req, res, url, body);
        if (ROUTES[url.pathname]) return send(res, 200, ROUTES[url.pathname]);
        if (url.pathname === "/files") return send(res, 200, listFiles(url));
        if (url.pathname === "/user/notifications") return send(res, 200, notificationsJson());
        if (url.pathname === "/auth/devices") return send(res, 200, { devices: DEVICES });
        if (/^\/files\/(preview|thumbnail)\//.test(url.pathname)) {
            requests.push({ method: req.method, path: url.pathname, body: "" });
            return send(res, 200, PIXEL, "image/png");
        }
        // A 300 MB file: HEAD reports its size; the browser download gets a small stand-in body
        if (decodeURIComponent(url.pathname) === "/dl/huge-backup.zip") {
            requests.push({ method: req.method, path: url.pathname, body: url.search });
            if (req.method === "HEAD") {
                res.writeHead(200, { "Content-Length": 300 * 1024 * 1024, "Content-Type": "application/zip", "ETag": '"u9-300"' });
                return res.end();
            }
            return send(res, 200, Buffer.from("stand-in"), "application/zip");
        }
        const ext = path.extname(url.pathname).toLowerCase();
        if (MEDIA[ext] && !url.pathname.startsWith("/assets/")) return serveMedia(req, res, url.pathname);
        // Documents and archives: a small stand-in body (saving offline reads it)
        if (url.pathname.startsWith("/dl/") && /\.(pdf|txt|zip)$/i.test(decodeURIComponent(url.pathname))) {
            requests.push({ method: req.method, path: url.pathname, body: url.search });
            return send(res, 200, Buffer.from("TeleStore stand-in file\n".repeat(64)), "application/pdf");
        }
        const filePath = path.join(DIST, decodeURIComponent(url.pathname));
        if (filePath.startsWith(DIST) && url.pathname !== "/" && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".woff2": "font/woff2", ".mjs": "text/javascript" };
            return send(res, 200, fs.readFileSync(filePath), types[ext] || "application/octet-stream");
        }
        if (url.pathname.startsWith("/assets/") || path.basename(url.pathname).includes(".")) return send(res, 404, { detail: "not found" });
        if ((req.headers.accept || "").includes("text/html") || url.pathname === "/") return send(res, 200, fs.readFileSync(path.join(DIST, "index.html")), "text/html");
        send(res, 200, {});
    });
}).listen(PORT, "127.0.0.1", () => console.log(`mock backend on http://127.0.0.1:${PORT}`));
