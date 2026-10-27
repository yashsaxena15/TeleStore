/**
 * Pure helpers for the file explorer: item meta (type badge, short date),
 * which section the user is in, the selection bar's actions, and Move to… routing.
 */
import { VIDEO_EXTS, PHOTO_EXTS, AUDIO_EXTS, ARCHIVE_EXTS } from "../fileTypes";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "just now", "5m ago", "3h ago", "2d ago", "Sep 12", "Sep 12, 2023"
export function formatShortDate(value, now = new Date()) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    const diff = now.getTime() - d.getTime();
    const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
    if (diff >= 0 && diff < min) return "just now";
    if (diff >= 0 && diff < hour) return `${Math.floor(diff / min)}m ago`;
    if (diff >= 0 && diff < day) return `${Math.floor(diff / hour)}h ago`;
    if (diff >= 0 && diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
    const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    return d.getFullYear() === now.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

// Kind drives the badge colour; label is the extension shown on the badge.
export function getTypeInfo(item) {
    if (!item) return { kind: "other", label: "" };
    if (item.type === "folder") return { kind: "folder", label: "Folder" };
    const name = item.name || "";
    const ext = (item.extension || (name.includes(".") ? name.split(".").pop() : "") || "").toLowerCase();
    const label = ext ? ext.toUpperCase().slice(0, 5) : (item.fileType || "File").toUpperCase().slice(0, 5);
    if (item.fileType === "video" || VIDEO_EXTS.includes(ext)) return { kind: "video", label };
    if (item.fileType === "audio" || item.fileType === "voice" || AUDIO_EXTS.includes(ext)) return { kind: "audio", label };
    if (item.fileType === "photo" || PHOTO_EXTS.includes(ext)) return { kind: "image", label };
    if (ARCHIVE_EXTS.includes(ext)) return { kind: "archive", label };
    if (ext) return { kind: "doc", label };
    return { kind: "other", label };
}

export const TYPE_TONE = {
    video: "bg-cloud/15 text-cloud",
    audio: "bg-primary/15 text-primary",
    image: "bg-success/15 text-success",
    doc: "bg-info/15 text-info",
    archive: "bg-warning/15 text-warning",
    folder: "bg-muted text-muted-foreground",
    other: "bg-muted text-muted-foreground",
};

// Which place the explorer is showing; decides the selection bar and status line.
export function getSection({ isTrash = false, isVault = false, isInbox = false, isStarred = false, isCloud = false } = {}) {
    if (isCloud) return isTrash ? "drive-trash" : "drive";
    if (isTrash) return "trash";
    if (isVault) return "vault";
    if (isInbox) return "inbox";
    if (isStarred) return "starred";
    return "home";
}

/**
 * Selection bar actions for a section, in display order.
 * `primary` actions stay visible on phones; the rest go into the ⋯ menu there.
 */
export function getSelectionActions(section, { count = 0, allStarred = false, playable = false, offline = null } = {}) {
    const star = { id: allStarred ? "unstar" : "star", primary: false };
    // Only music and videos selected: they can go in a playlist
    const playlist = playable ? [{ id: "playlist", primary: false }] : [];
    // offline: "save" (some not saved yet) or "remove" (all saved); null when the browser can't
    const offlineAction = offline === "save" ? [{ id: "offline", primary: false }] : offline === "remove" ? [{ id: "offline-remove", primary: false }] : [];
    const details = count === 1 ? [{ id: "details", primary: false }] : [];
    switch (section) {
        case "trash":
        case "drive-trash":
            return [{ id: "restore", primary: true }, { id: "delete-forever", primary: true }];
        case "inbox":
            return [{ id: "file-to", primary: true }, { id: "download", primary: true }, star, ...details, { id: "delete", primary: true }];
        case "vault":
            return [{ id: "download", primary: true }, { id: "move-to", primary: true }, { id: "to-home", primary: false }, ...details, { id: "delete", primary: true }];
        case "starred":
            return [{ id: "download", primary: true }, { id: "move-to", primary: true }, { id: "unstar", primary: false }, ...playlist, ...offlineAction, { id: "compress", primary: false }, ...details, { id: "delete", primary: true }];
        case "drive":
            return [{ id: "download", primary: true }, { id: "copy", primary: true }, { id: "cut", primary: false }, star, ...details, { id: "delete", primary: true }];
        default:
            return [{ id: "download", primary: true }, { id: "move-to", primary: true }, { id: "copy", primary: false }, { id: "cut", primary: false }, star, ...playlist, ...offlineAction, { id: "compress", primary: false }, { id: "to-vault", primary: false }, ...details, { id: "delete", primary: true }];
    }
}

const isVaultPath = (p) => typeof p === "string" && (p === "/Vault" || p.startsWith("/Vault/"));

// The folder an item currently sits in, normalised ("/Home/Movies").
export function getItemParent(item, fallbackPath = "/Home") {
    const raw = item?.file_path || fallbackPath || "/Home";
    const clean = raw.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
    return clean || "/Home";
}

/**
 * Decide how to move each item into targetPath.
 * Crossing into or out of the vault goes through the vault endpoints (they check the vault is unlocked).
 * Returns { moves: [{ item, via: "move" | "vault-in" | "vault-out" }], skipped: [{ item, reason }] }.
 */
export function planMove(items, targetPath, { fallbackPath = "/Home" } = {}) {
    const target = (targetPath || "/Home").replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
    const moves = [];
    const skipped = [];
    for (const item of items || []) {
        if (!item?.id) {
            skipped.push({ item, reason: "missing-id" });
            continue;
        }
        const parent = getItemParent(item, fallbackPath);
        const self = `${parent === "/" ? "" : parent}/${item.name}`;
        if (parent === target) {
            skipped.push({ item, reason: "same-folder" });
            continue;
        }
        if (item.type === "folder" && (target === self || target.startsWith(`${self}/`))) {
            skipped.push({ item, reason: "into-itself" });
            continue;
        }
        const fromVault = Boolean(item.is_vault) || isVaultPath(parent);
        const toVault = isVaultPath(target);
        moves.push({ item, via: fromVault === toVault ? "move" : toVault ? "vault-in" : "vault-out" });
    }
    return { moves, skipped };
}
