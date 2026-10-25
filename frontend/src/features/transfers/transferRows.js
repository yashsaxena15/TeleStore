/**
 * Pure helpers for the Transfers page: one list of uploads, downloads and cloud leeches,
 * the filter chips with their counts, and how each row describes its status.
 */
import { groupRemoteTransfers } from "./transferGrouping";

export const ACTIVE_STATUSES = ["uploading", "downloading", "uploading_tg", "queued", "paused", "paused_quota", "discovering"];
export const TRANSFERRING_STATUSES = ["uploading", "downloading", "uploading_tg"];

export const isActiveStatus = (status) => ACTIVE_STATUSES.includes(status);

// Uploads, downloads and remote tasks (folders grouped) as one list: active first, then newest.
export function buildTransferItems(uploads = [], downloads = [], remoteTransfers = []) {
    const { groupedRemoteItems, singleRemoteItems } = groupRemoteTransfers(remoteTransfers);
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
    if (s === "paused_quota" || item.isPausedQuota) return { label: "Quota pause", tone: "warning" };
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
    const quota = s === "paused_quota" || Boolean(item.isPausedQuota);
    const someFilesStuck = isGroup && (item.items?.some((i) => i.status === "paused_quota" || i.status === "failed") || (s === "queued" && item.completedCount > 0));
    return {
        pause: !isRemote && TRANSFERRING_STATUSES.includes(s),
        resume: !isRemote && s === "paused",
        resumeRemaining: quota || someFilesStuck,
        retry: s === "failed",
        cancel: TRANSFERRING_STATUSES.includes(s) || ["paused", "queued", "paused_quota", "discovering"].includes(s),
        showInFolder: s === "completed" && item.type === "download" && Boolean(item.savePath),
    };
}
