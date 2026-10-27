// Pure helpers for the notification bell: times, where a notification leads, which ones are new
// since the last check, and which of those get a browser pop-up. No API or DOM here.
import { serverTime } from "@/features/explorer/fileTypes";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", "Oct 12", "Oct 12, 2025". */
export function relativeTime(value, now = new Date()) {
    if (!value) return "";
    const d = new Date(serverTime(value));
    if (isNaN(d.getTime())) return "";
    const diff = now.getTime() - d.getTime();
    const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
    if (diff < min) return "just now";
    if (diff < hour) return `${Math.floor(diff / min)} min ago`;
    if (diff < day) return `${Math.floor(diff / hour)} h ago`;
    if (diff < 2 * day) return "yesterday";
    if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
    const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    return d.getFullYear() === now.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

/**
 * Where a notification leads: { view } for a page, { folderPath } for a folder in Files, or null.
 * A file's notification opens the folder it is in (its target path is that folder).
 */
export function targetRoute(target) {
    if (!target || typeof target !== "object") return null;
    switch (target.type) {
        case "transfers": return { view: "transfers" };
        case "playlists": return { view: "playlists" };
        case "settings": return { view: "settings" };
        case "folder":
        case "file": return target.path ? { folderPath: target.path } : { view: "files" };
        default: return null;
    }
}

/**
 * The unread notifications that arrived after [lastSeenId] (items are newest first).
 * Without a last seen id (the first check) nothing counts as new.
 */
export function freshItems(items, lastSeenId) {
    if (!lastSeenId || !Array.isArray(items)) return [];
    const at = items.findIndex((n) => n.id === lastSeenId);
    return (at === -1 ? items : items.slice(0, at)).filter((n) => !n.read);
}

/** Browser pop-ups for [fresh]: up to [max] one by one, then a single "N more" summary. */
export function popupPlan(fresh, max = 3) {
    const list = fresh || [];
    const single = list.slice(0, max).map((n) => ({ id: n.id, title: n.title, body: n.body || "", target: n.target || null }));
    const rest = list.length - single.length;
    if (rest > 0) single.push({ id: "summary", title: `${rest} more notification${rest === 1 ? "" : "s"}`, body: "Open TeleStore to see them all.", target: null });
    return single;
}

/** The cached listing after marking [ids] (or everything) as read, before the server answers. */
export function markReadLocally(data, ids, all = false) {
    if (!data) return data;
    const wanted = new Set(ids || []);
    let cleared = 0;
    const items = (data.items || []).map((n) => {
        if (n.read || (!all && !wanted.has(n.id))) return n;
        cleared++;
        return { ...n, read: true };
    });
    return { ...data, items, unread: all ? 0 : Math.max(0, (data.unread || 0) - cleared) };
}

/** The badge text: "" for none, "99+" past 99. */
export const badgeText = (count) => (!count || count < 1 ? "" : count > 99 ? "99+" : String(count));
