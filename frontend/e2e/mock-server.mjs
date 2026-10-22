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
    "/cloud/acc1/files": { files: [{ id: "fold9", name: "Instagram saves", is_folder: true }, { id: "doc1", name: "notes.txt", is_folder: false }] },
    "/files/analytics": {
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
    ] },
};

const requests = [];

const send = (res, code, body, type = "application/json") => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    res.writeHead(code, { "Content-Type": type, "Content-Length": data.length });
    res.end(data);
};

const listFiles = (url) => {
    const p = (url.searchParams.get("path") || "/Home").replace(/\/+$/, "") || "/Home";
    const all = FOLDERS[p] || [];
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
            if (req.method === "DELETE") requests.length = 0;
            return send(res, 200, requests);
        }
        if (req.method !== "GET" && req.method !== "HEAD") return mutation(req, res, url, body);
        if (ROUTES[url.pathname]) return send(res, 200, ROUTES[url.pathname]);
        if (url.pathname === "/files") return send(res, 200, listFiles(url));
        const ext = path.extname(url.pathname).toLowerCase();
        if (MEDIA[ext] && !url.pathname.startsWith("/assets/")) return serveMedia(req, res, url.pathname);
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
