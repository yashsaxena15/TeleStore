// Bookkeeping for offline files, kept apart from the browser storage so it can be tested:
// which files are saved, which folders are kept in step, what a folder sync adds and drops,
// and whether a file fits. Every function returns a new index and never changes the one given.
//
// Index: { files: { [id]: entry }, folders: { [path]: folder } }
//   entry:  { id, name, size, type, fileType, file_path, saved_at, folder, pinned }
//           folder = the saved folder it came with (or null); pinned = saved on its own too
//   folder: { path, name, saved_at, synced_at }

export const emptyIndex = () => ({ files: {}, folders: {} });

/** A stored index, or an empty one when it is missing or damaged. */
export function parseIndex(text) {
    try {
        const data = typeof text === "string" ? JSON.parse(text) : text;
        if (data && typeof data.files === "object" && data.files && typeof data.folders === "object" && data.folders)
            return { files: { ...data.files }, folders: { ...data.folders } };
    }
    catch {
        // damaged: start again
    }
    return emptyIndex();
}

const cleanPath = (p) => {
    const s = String(p || "").replace(/\/+/g, "/");
    return s.length > 1 ? s.replace(/\/$/, "") : s;
};

/** True when [filePath] (a file's folder) is [folderPath] or inside it. */
export function isUnder(filePath, folderPath) {
    const f = cleanPath(filePath), d = cleanPath(folderPath);
    return Boolean(d) && (f === d || f.startsWith(`${d}/`));
}

/** The address of a folder item ("/Home" + "Movies" → "/Home/Movies"). */
export const folderPathOf = (item) => cleanPath(`${cleanPath(item?.file_path || "/Home")}/${item?.name || ""}`);

/** Adds (or refreshes) a saved file. [folder] is the saved folder it came with; null = saved on its own. */
export function addFile(index, item, { folder = null, size, type = "", now = new Date().toISOString() } = {}) {
    const old = index.files[item.id];
    const entry = {
        id: item.id,
        name: item.name,
        size: size ?? item.size ?? 0,
        type: type || old?.type || "",
        fileType: item.fileType || old?.fileType || "",
        file_path: item.file_path || old?.file_path || "/Home",
        saved_at: now,
        folder: folder ?? old?.folder ?? null,
        pinned: Boolean(old?.pinned) || !folder,
    };
    return { ...index, files: { ...index.files, [item.id]: entry } };
}

/** Removes saved files by id. Returns { index, removed: [ids] }. */
export function removeFiles(index, ids) {
    const files = { ...index.files };
    const removed = [];
    for (const id of ids) {
        if (files[id]) {
            delete files[id];
            removed.push(id);
        }
    }
    return { index: { ...index, files }, removed };
}

/** Remembers a folder so later syncs keep it in step. */
export function addFolder(index, path, name, now = new Date().toISOString()) {
    const key = cleanPath(path);
    const old = index.folders[key];
    return { ...index, folders: { ...index.folders, [key]: { path: key, name: name || key.split("/").pop() || key, saved_at: old?.saved_at || now, synced_at: now } } };
}

/**
 * Forgets a saved folder and the files that came only with it. Files saved on their own stay,
 * and so do files inside another saved folder (they move to that folder).
 * Returns { index, removed: [ids] } — the ids whose saved copies should be deleted.
 */
export function removeFolder(index, path) {
    const key = cleanPath(path);
    const folders = { ...index.folders };
    delete folders[key];
    const others = Object.keys(folders);
    const files = {};
    const removed = [];
    for (const [id, f] of Object.entries(index.files)) {
        if (f.folder !== key) {
            files[id] = f;
            continue;
        }
        const keeper = others.find((p) => isUnder(f.file_path, p));
        if (keeper)
            files[id] = { ...f, folder: keeper };
        else if (f.pinned)
            files[id] = { ...f, folder: null };
        else
            removed.push(id);
    }
    return { index: { files, folders }, removed };
}

/**
 * Removes the offline copy of one file. A file that is part of a saved folder can't be dropped
 * on its own (the next sync would bring it back), so it only stops being "pinned".
 * Returns { index, removed: [ids] }.
 */
export function unpinFile(index, id) {
    const f = index.files[id];
    if (!f) return { index, removed: [] };
    if (f.folder && index.folders[f.folder]) {
        return { index: { ...index, files: { ...index.files, [id]: { ...f, pinned: false } } }, removed: [] };
    }
    return removeFiles(index, [id]);
}

/**
 * What a folder sync must do, given every file now inside the folder on the server
 * (any depth): { add: [items not saved yet], remove: [ids that came with this folder and are gone] }.
 */
export function folderSyncDiff(index, path, serverFiles) {
    const key = cleanPath(path);
    const onServer = new Set((serverFiles || []).map((f) => f.id));
    const add = (serverFiles || []).filter((f) => f.id && !index.files[f.id]);
    const remove = Object.values(index.files)
        .filter((f) => f.folder === key && !f.pinned && !onServer.has(f.id))
        .map((f) => f.id);
    return { add, remove };
}

/** The saved files that came with folder [path]. */
export const filesOfFolder = (index, path) => Object.values(index.files).filter((f) => f.folder === cleanPath(path));

/** Bytes used by all saved copies. */
export const totalBytes = (index) => Object.values(index.files).reduce((sum, f) => sum + (Number(f.size) || 0), 0);

/**
 * null when [needed] bytes fit in the browser's storage (navigator.storage.estimate()),
 * else the free bytes left. An unknown estimate never blocks.
 */
export function spaceShortfall(needed, estimate) {
    if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return null;
    const free = Math.max(0, estimate.quota - estimate.usage);
    return needed > free ? free : null;
}
