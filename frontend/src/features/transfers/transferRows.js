/**
 * Pure helpers for the Transfers page: one list of uploads, downloads and cloud leeches,
 * the filter chips with their counts, and how each row describes its status.
 */
import { groupRemoteTransfers } from "./transferGrouping";

export const ACTIVE_STATUSES = ["uploading", "downloading", "uploading_tg", "queued", "paused", "paused_quota", "discovering"];
export const TRANSFERRING_STATUSES = ["uploading", "downloading", "uploading_tg"];

export const isActiveStatus = (status) => ACTIVE_STATUSES.includes(status);

// Uploads, downloads and remote tasks (folders grouped) as one list: active first, then newest.
// `groups` are the server's folder summaries by id.
export function buildTransferItems(uploads = [], downloads = [], remoteTransfers = [], groups = {}) {
    const { groupedRemoteItems, singleRemoteItems } = groupRemoteTransfers(remoteTransfers, groups);
    const items = [
        ...groupedRemoteItems,
        ...singleRemoteItems,
        ...uploads.map((u) => ({ ...u, type: "upload" })),
        ...downloads.map((d) => ({ ...d, type: "download", filesize: d.size || 0, bytesUploaded: d.downloaded || 0, file: null })),
    ];
    const time = (i) => (i.startTime ? new Date(i.startTime).getTime() || 0 : 0);
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const aActive = isActiveStatus(a.item.status);
            const bActive = isActiveStatus(b.item.status);
            if (aActive !== bActive) return aActive ? -1 : 1;
            return time(b.item) - time(a.item) || a.index - b.index;
        })
        .map(({ item }) => item);
}

export const TRANSFER_FILTERS = [
    { id: "all", label: "All" },
    { id: "remote", label: "Cloud leech" },
    { id: "uploads", label: "Uploads" },
    { id: "downloads", label: "Downloads" },
    { id: "completed", label: "Completed" },
    { id: "failed", label: "Failed" },
];

export function matchesFilter(item, filter) {
    switch (filter) {
        case "remote": return item.type === "remote";
        case "uploads": return item.type === "upload";
        case "downloads": return item.type === "download";
        case "completed": return item.status === "completed";
        // A folder counts as failed when any of its files failed
        case "failed": return item.status === "failed" || Boolean(item.isGroup && item.items?.some((i) => i.status === "failed"));
        default: return true;
    }
}

export function countByFilter(items) {
    return Object.fromEntries(TRANSFER_FILTERS.map((f) => [f.id, items.filter((i) => matchesFilter(i, f.id)).length]));
}

export function formatEta(seconds) {
    if (!seconds || !isFinite(seconds) || seconds <= 0) return "";
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.round(seconds)}s`;
}

// Kind label shown under the name ("Magnet", "Folder leech", "Upload"…)
export function kindLabel(item) {
    if (item.isGroup) return item.group_type === "torrent" ? "Torrent" : item.group_type === "file" ? "Multi-part leech" : item.group_type === "instagram" ? "Instagram" : item.group_type === "media" ? "Playlist" : "Folder leech";
    if (item.type === "remote") return { magnet: "Magnet", torrent_file: "Torrent", instagram: "Instagram", media: "Video download" }[item.source_type] || "Cloud leech";
    return item.type === "upload" ? "Upload" : "Download";
}

/** Short status text and its colour tone (a theme token name). */
export function statusInfo(item) {
    const s = item.status;
    if ((s === "paused_quota" || item.isPausedQuota) && (item.source_type === "media" || item.group_type === "media")) return { label: "Waiting", tone: "warning" };
    if (s === "paused_quota" || item.isPausedQuota) return { label: "Google limit", tone: "warning" };
    if (s === "discovering" || item.isDiscovering) return { label: "Scanning", tone: "info" };
    if (s === "completed" && item.handedToBrowser) return { label: "In browser downloads", tone: "info" };
    if (s === "completed") return { label: "Done", tone: "success" };
    if (s === "failed") return { label: "Failed", tone: "destructive" };
    if (s === "cancelled") return { label: "Cancelled", tone: "muted" };
    if (s === "paused") return { label: "Paused", tone: "warning" };
    if (s === "queued") return { label: "Queued", tone: "muted" };
    if (s === "uploading_tg") return { label: "To Telegram", tone: "primary" };
    if (s === "uploading") return { label: "Uploading", tone: "primary" };
    if (s === "downloading") return { label: "Downloading", tone: "primary" };
    return { label: s ? s.charAt(0).toUpperCase() + s.slice(1) : "", tone: "muted" };
}

/** Which buttons a row offers. */
export function rowActions(item) {
    const s = item.status;
    const isRemote = item.type === "remote";
    const isGroup = Boolean(item.isGroup);
    const media = item.source_type === "media" || item.group_type === "media";
    const waitingForGoogle = isGroup ? (item.pausedCount ?? item.items?.filter((i) => i.status === "paused_quota").length ?? 0) > 0 : s === "paused_quota";
    const failedFiles = isGroup ? (item.failedCount ?? item.items?.filter((i) => i.status === "failed").length ?? 0) : 0;
    return {
        pause: !isRemote && TRANSFERRING_STATUSES.includes(s),
        resume: !isRemote && s === "paused",
        // Try Google again right away (files paused by its daily limit); a video site's wait too
        resumeNow: isRemote && (waitingForGoogle || (media && s === "paused_quota")),
        // A folder re-queues only its failed files
        retryFailed: isGroup && failedFiles > 0,
        retry: s === "failed" && !isGroup,
        cancel: TRANSFERRING_STATUSES.includes(s) || ["paused", "queued", "paused_quota", "discovering"].includes(s),
        showInFolder: s === "completed" && item.type === "download" && Boolean(item.savePath),
    };
}

// "2 running · 5 waiting · 2,641 paused by Google's limit" (empty when nothing is left to do)
export const activitySummary = ({ running = 0, waiting = 0, paused = 0 }) => [
    running > 0 && `${running.toLocaleString("en")} running`,
    waiting > 0 && `${waiting.toLocaleString("en")} waiting`,
    paused > 0 && `${paused.toLocaleString("en")} paused by Google's limit`,
].filter(Boolean).join(" · ");

// ── Speeds, Google's limit, machines, details ─────────────────────────────────────

const MOVING_REMOTE = ["downloading", "uploading_tg", "discovering"];

// 1 GB is 1024 MB, like the rest of the site
const defaultBytes = (bytes) => {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** i;
    return `${i === 0 ? value : value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
};
const defaultTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * Download and upload speed of one row. Server transfers send both (smoothed over a few seconds);
 * older servers send one speed, counted as the download. Uploads go up, downloads come down.
 */
export function itemSpeeds(item) {
    if (item.type === "remote") {
        if (!MOVING_REMOTE.includes(item.status)) return { down: 0, up: 0 };
        return { down: item.download_bps ?? item.speed_bps ?? item.speed ?? 0, up: item.upload_bps ?? 0 };
    }
    const speed = TRANSFERRING_STATUSES.includes(item.status) ? item.speed || 0 : 0;
    return item.type === "upload" ? { down: 0, up: speed } : { down: speed, up: 0 };
}

export function totalSpeeds(items) {
    return items.reduce((sum, item) => {
        const { down, up } = itemSpeeds(item);
        return { down: sum.down + down, up: sum.up + up };
    }, { down: 0, up: 0 });
}

// "↓ 5.7 MB/s ↑ 1.2 MB/s" (only the directions that move)
export const speedText = ({ down = 0, up = 0 }, bytes = defaultBytes) => [
    down > 0 && `↓ ${bytes(down)}/s`,
    up > 0 && `↑ ${bytes(up)}/s`,
].filter(Boolean).join(" ");

// The page's subtitle: "3 running · ↓ 11.2 MB/s ↑ 6.1 MB/s"
export const headerLine = (activity, speeds, bytes = defaultBytes) => [activity, speedText(speeds, bytes)].filter(Boolean).join(" · ");

/**
 * Files waiting for Google Drive's daily download limit, and when the first tries again:
 * "3 files wait for Google's limit · next resumes at 4:08 PM". Empty when none wait.
 */
export function googleNote(item, formatTime = defaultTime) {
    if (item.source_type === "media" || item.group_type === "media") return "";
    const count = item.isGroup ? item.pausedCount || 0 : item.status === "paused_quota" ? 1 : 0;
    if (!count) return "";
    let time = "";
    try {
        time = item.cooldown_until ? formatTime(item.cooldown_until) : "";
    }
    catch {
        time = "";
    }
    const when = time ? `${item.isGroup && count > 1 ? "next " : ""}resumes at ${time}` : "resumes by itself";
    if (!item.isGroup) return `Waits for Google's download limit · ${when}`;
    return `${count === 1 ? "1 file waits" : `${count.toLocaleString("en")} files wait`} for Google's limit · ${when}`;
}

// The machine working on a transfer: "main" is the main server, a worker keeps its own name
export const workerLabel = (worker) => (!worker ? "" : worker === "main" ? "Main server" : worker);

// The filter inside a folder; the id is what the server expects
export const FOLDER_FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "waiting", label: "Waiting" },
    { id: "failed", label: "Failed" },
    { id: "done", label: "Done" },
];

// Buttons for one file of a folder
export function fileActions(task) {
    const s = task.status;
    return {
        retry: s === "failed",
        cancel: ["queued", "downloading", "uploading_tg", "discovering", "paused_quota"].includes(s),
        resumeNow: s === "paused_quota",
        copyLink: Boolean(task.source_url),
    };
}

/** What a transfer's details show, in order: [{ label, value, kind }] (kind: link or error). */
export function detailFacts(item, { bytes = defaultBytes, formatDate = (iso) => new Date(iso).toLocaleString() } = {}) {
    const facts = [];
    const total = item.filesize || item.size || 0;
    const done = item.bytesUploaded || item.downloaded || item.transferred_bytes || 0;
    if (item.source_url) facts.push({ label: "Source link", value: item.source_url, kind: "link" });
    if (item.type !== "download" && item.destination_path) facts.push({ label: "Destination folder", value: item.destination_path });
    if (item.type === "download" && item.savePath) facts.push({ label: "Saved to", value: item.savePath });
    if (item.isGroup) facts.push({ label: "Files", value: `${(item.completedCount || 0).toLocaleString("en")} of ${(item.totalCount || 0).toLocaleString("en")} done` });
    if (total > 0) facts.push({ label: "Size", value: done > 0 && done < total ? `${bytes(done)} of ${bytes(total)}` : bytes(total) });
    const started = item.created_at || item.startTime;
    if (started && !isNaN(new Date(started).getTime())) facts.push({ label: "Started", value: formatDate(started) });
    if (item.worker) facts.push({ label: "Machine", value: workerLabel(item.worker) });
    const error = item.error || item.error_message || (item.isGroup && item.status === "failed" ? item.phase : "");
    if (error) facts.push({ label: "Error", value: typeof error === "string" ? error : String(error), kind: "error" });
    return facts;
}
