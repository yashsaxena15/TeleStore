// Offline files ("available offline", like Google Drive): saved copies in this browser's private
// file storage (the Origin Private File System), one file per TeleStore file id, written as the
// download streams in so even very large files never sit in memory. The list of what is saved
// (see offlineIndex.js) is a JSON file next to them. Saved folders are kept in step: new files
// in them are saved and removed ones dropped whenever the app opens or the Offline page is shown.
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, fetchWithTimeout, getApiBaseUrl } from "@/lib/api";
import { apiFileToFileItem } from "@/features/explorer/fileTypes";
import logger from "@/lib/logger";
import { addFile, addFolder, emptyIndex, folderPathOf, folderSyncDiff, parseIndex, removeFiles, removeFolder, spaceShortfall, unpinFile } from "./offlineIndex";

const ROOT_DIR = "telestore-offline";
const FILES_DIR = "files";
const INDEX_FILE = "index.json";

/** OPFS is missing in old browsers and some private windows. */
export const offlineSupported = () => typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";

/** Telegram files (not Google Drive, not the vault, not Trash) can be saved offline. */
export const canSaveOffline = (item) => Boolean(item?.id && !item.is_cloud && !item.is_vault && !item.trashed && !item.is_virtual && !String(item.file_path || "").startsWith("/Vault"));

let index = emptyIndex();
let loading = null;
const listeners = new Set();
// Blob addresses of saved copies, made once per file and reused (they stay valid until the copy changes)
const urls = new Map();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
};
const getSnapshot = () => index;

const storageName = (id) => encodeURIComponent(String(id));

async function dirs() {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle(ROOT_DIR, { create: true });
    const files = await base.getDirectoryHandle(FILES_DIR, { create: true });
    return { base, files };
}

/** Reads the saved list once; later calls get the same promise. */
export function loadOffline() {
    if (!offlineSupported()) return Promise.resolve(index);
    if (!loading) {
        loading = (async () => {
            try {
                const { base } = await dirs();
                const handle = await base.getFileHandle(INDEX_FILE, { create: true });
                const text = await (await handle.getFile()).text();
                index = parseIndex(text || null);
            }
            catch (error) {
                logger.warn("Couldn't read the offline files list", error?.message);
            }
            emit();
            return index;
        })();
    }
    return loading;
}

// Index writes go one after another, each writing the newest list
let writing = Promise.resolve();
function commit(next) {
    index = next;
    emit();
    writing = writing.then(async () => {
        const { base } = await dirs();
        const handle = await base.getFileHandle(INDEX_FILE, { create: true });
        const out = await handle.createWritable();
        await out.write(JSON.stringify(index));
        await out.close();
    }).catch((error) => logger.warn("Couldn't save the offline files list", error?.message));
    return writing;
}

function forgetUrl(id) {
    const url = urls.get(id);
    if (url) {
        URL.revokeObjectURL(url);
        urls.delete(id);
    }
}

async function deleteCopies(ids) {
    if (!ids.length) return;
    const { files } = await dirs();
    for (const id of ids) {
        forgetUrl(id);
        await files.removeEntry(storageName(id)).catch(() => { });
    }
}

/** The saved list, kept up to date (for marks on items and the Offline page). */
export function useOfflineIndex() {
    useEffect(() => {
        loadOffline();
    }, []);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const isSavedOffline = (id) => Boolean(id && index.files[id]);

/** The saved copy of file [id] as a File, with its name and type. */
export async function getOfflineFile(id) {
    const entry = index.files[id];
    if (!entry) throw new Error("This file isn't saved offline");
    const { files } = await dirs();
    const file = await (await files.getFileHandle(storageName(id))).getFile();
    return new File([file], entry.name, { type: entry.type || file.type || "" });
}

/** A blob: address for the saved copy (seeking works in the player), or null. */
export const offlineUrlSync = (id) => urls.get(id) || null;

/** Makes blob: addresses for every saved one of [items] (missing copies are skipped). */
export async function prepareOfflineUrls(items) {
    await loadOffline();
    for (const it of items) {
        if (!isSavedOffline(it?.id) || urls.has(it.id)) continue;
        try {
            urls.set(it.id, URL.createObjectURL(await getOfflineFile(it.id)));
        }
        catch (error) {
            logger.warn("Saved copy missing", { id: it.id, message: error?.message });
        }
    }
}

const fmt = (bytes) => {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

/** How much this site may still store: { usage, quota, free } or null when the browser won't say. */
export async function storageEstimate() {
    try {
        const est = await navigator.storage?.estimate?.();
        if (!est) return null;
        return { usage: est.usage || 0, quota: est.quota || 0, free: Math.max(0, (est.quota || 0) - (est.usage || 0)) };
    }
    catch {
        return null;
    }
}

async function ensureSpace(needed) {
    const free = spaceShortfall(needed, await storageEstimate());
    if (free !== null) throw new Error(`Not enough space in this browser: needs ${fmt(needed)}, ${fmt(free)} free`);
}

// Streams one file from the server into its saved copy. onBytes(done, total) reports progress.
async function downloadInto(item, onBytes) {
    const url = `${getApiBaseUrl() || ""}/dl/${encodeURIComponent(item.name)}?file_id=${encodeURIComponent(item.id)}`;
    const response = await fetchWithTimeout(url, { credentials: "include" }, 60000);
    if (!response.ok || !response.body) throw new Error(`The server answered ${response.status}`);
    const total = Number(response.headers.get("content-length")) || item.size || 0;
    const { files } = await dirs();
    const name = storageName(item.id);
    const existed = isSavedOffline(item.id);
    const handle = await files.getFileHandle(name, { create: true });
    // The new copy only replaces the old one when it is complete
    const out = await handle.createWritable();
    let done = 0;
    const counter = new TransformStream({
        transform(chunk, controller) {
            done += chunk.byteLength;
            onBytes?.(done, total);
            controller.enqueue(chunk);
        },
    });
    try {
        await response.body.pipeThrough(counter).pipeTo(out);
    }
    catch (error) {
        if (!existed) await files.removeEntry(name).catch(() => { });
        throw error;
    }
    forgetUrl(item.id);
    return { size: done, type: (response.headers.get("content-type") || "").split(";")[0] };
}

// Every file inside a folder, at any depth, as file items
async function listFolderFiles(path) {
    const data = await api.fetchWholeFolder(path);
    const out = [];
    for (const raw of data?.files || []) {
        const item = apiFileToFileItem(raw);
        if (item.type === "folder") out.push(...await listFolderFiles(folderPathOf(item)));
        else if (item.id) out.push(item);
    }
    return out;
}

// Saves [jobs] ({ item, folder }) one by one under a single progress toast
async function saveAll(jobs, { quiet = false } = {}) {
    const fresh = jobs.filter((j) => !isSavedOffline(j.item.id));
    const needed = fresh.reduce((sum, j) => sum + (Number(j.item.size) || 0), 0);
    await ensureSpace(needed);
    if (!Object.keys(index.files).length) {
        // Ask once that the browser keeps these files when space runs low
        navigator.storage?.persist?.().catch(() => { });
    }
    const toastId = quiet ? null : toast.loading(jobs.length === 1 ? `Saving “${jobs[0].item.name}” offline…` : `Saving ${jobs.length} files offline…`);
    let failed = 0;
    let lastShown = 0;
    for (const [n, job] of jobs.entries()) {
        const { item, folder } = job;
        if (isSavedOffline(item.id)) {
            commit(addFile(index, item, { folder, size: index.files[item.id].size, type: index.files[item.id].type }));
            continue;
        }
        try {
            const { size, type } = await downloadInto(item, (done, total) => {
                const now = Date.now();
                if (!toastId || now - lastShown < 250) return;
                lastShown = now;
                const pct = total ? Math.min(100, Math.round((done / total) * 100)) : null;
                const what = jobs.length === 1 ? `“${item.name}”` : `${n + 1} of ${jobs.length}`;
                toast.loading(`Saving ${what} offline…${pct === null ? "" : ` ${pct}%`}`, { id: toastId });
            });
            await commit(addFile(index, item, { folder, size, type }));
        }
        catch (error) {
            failed++;
            logger.warn("Couldn't save a file offline", { id: item.id, message: error?.message });
            if (jobs.length === 1) {
                if (toastId) toast.error(`Couldn't save “${item.name}” offline: ${error?.message || "download failed"}`, { id: toastId });
                return;
            }
        }
    }
    if (!toastId) return;
    if (failed) toast.error(`${jobs.length - failed} of ${jobs.length} files saved offline. ${failed} couldn't be downloaded.`, { id: toastId });
    else toast.success(jobs.length === 1 ? `“${jobs[0].item.name}” is available offline` : `${jobs.length} files are available offline`, { id: toastId });
}

// One save or sync at a time, so two never fight over the same files
let queue = Promise.resolve();
const enqueue = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => { });
    return run;
};

/** "Make available offline" for files and folders (folders: every file inside, and kept in step). */
export function makeAvailableOffline(items) {
    if (!offlineSupported()) {
        toast.error("This browser can't keep files offline.");
        return Promise.resolve();
    }
    const targets = (items || []).filter(canSaveOffline);
    if (!targets.length) return Promise.resolve();
    return enqueue(async () => {
        await loadOffline();
        try {
            const jobs = [];
            for (const it of targets) {
                if (it.type === "folder") {
                    const path = folderPathOf(it);
                    const inside = await listFolderFiles(path);
                    commit(addFolder(index, path, it.name));
                    jobs.push(...inside.map((item) => ({ item, folder: path })));
                }
                else {
                    jobs.push({ item: it, folder: null });
                }
            }
            if (!jobs.length) {
                toast.success(`“${targets[0].name}” is available offline. New files in it will be saved too.`);
                return;
            }
            await saveAll(jobs);
        }
        catch (error) {
            toast.error(error?.message || "Couldn't save offline");
        }
    });
}

/** "Remove offline copy" for files and folders. */
export function removeOffline(items) {
    return enqueue(async () => {
        await loadOffline();
        let next = index;
        const gone = [];
        const kept = [];
        for (const it of items || []) {
            const r = it.type === "folder" ? removeFolder(next, folderPathOf(it)) : unpinFile(next, it.id);
            if (it.type !== "folder" && !r.removed.length && next.files[it.id]) kept.push(it);
            next = r.index;
            gone.push(...r.removed);
        }
        await commit(next);
        await deleteCopies(gone);
        if (kept.length) toast.info(`“${kept[0].name}” stays offline because its folder is saved offline.`);
        else toast.success(items?.length === 1 ? `Removed the offline copy of “${items[0].name}”` : "Removed the offline copies");
    });
}

/** Removes one saved folder by its path (the Offline page). */
export const removeOfflineFolder = (path, name) => removeOffline([{ type: "folder", name: name || path.split("/").pop(), file_path: path.split("/").slice(0, -1).join("/") || "/" }]);

/** Removes every saved copy and folder. */
export function removeAllOffline() {
    return enqueue(async () => {
        await loadOffline();
        urls.forEach((url) => URL.revokeObjectURL(url));
        urls.clear();
        try {
            const { base } = await dirs();
            await base.removeEntry(FILES_DIR, { recursive: true });
        }
        catch (error) {
            logger.warn("Couldn't clear offline files", error?.message);
        }
        await commit(emptyIndex());
        toast.success("Removed all offline files");
    });
}

/** Keeps saved folders in step with the server: saves new files, drops removed ones. */
export function syncOfflineFolders() {
    if (!offlineSupported() || (typeof navigator !== "undefined" && navigator.onLine === false)) return Promise.resolve();
    return enqueue(async () => {
        await loadOffline();
        for (const folder of Object.values(index.folders)) {
            let inside;
            try {
                inside = await listFolderFiles(folder.path);
            }
            catch (error) {
                logger.warn("Couldn't check a saved folder", { path: folder.path, message: error?.message });
                continue;
            }
            const { add, remove } = folderSyncDiff(index, folder.path, inside);
            if (remove.length) {
                const r = removeFiles(index, remove);
                await commit(r.index);
                await deleteCopies(r.removed);
            }
            commit(addFolder(index, folder.path, folder.name));
            if (add.length) {
                try {
                    await saveAll(add.map((item) => ({ item, folder: folder.path })), { quiet: true });
                }
                catch (error) {
                    logger.warn("Couldn't save new files of a saved folder", { path: folder.path, message: error?.message });
                }
            }
        }
    });
}
