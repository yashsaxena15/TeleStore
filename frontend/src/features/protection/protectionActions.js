// Menu actions: protect items, remove the protection and colour folders. `refresh` reloads the file lists.
import { toast } from "sonner";
import { api } from "@/lib/api";
import { confirmUnlock, unprotectWith } from "./protection";

const named = (items) => (items.length === 1 ? `“${items[0].name}”` : `${items.length} items`);

/** Protect items from deletion (no password needed to turn it on). */
export async function protectItems(items, refresh) {
    if (!items.length) return;
    try {
        await Promise.all(items.map((it) => api.setProtected(it.id, true)));
        toast.success(`${named(items)} ${items.length === 1 ? "is" : "are"} protected from deletion`);
    }
    catch (error) {
        toast.error(error.message);
    }
    finally {
        refresh?.();
    }
}

/**
 * Remove the protection from one item, after the user confirms with their password (or emailed
 * code). Each confirm gets a pass for this item only, spent on this one request.
 */
export async function removeProtection(item, refresh) {
    if (!item?.id) return;
    const done = await confirmUnlock({
        reason: `Confirm to remove the protection from “${item.name}”.`,
        onConfirm: (credentials) => unprotectWith(api, item.id, credentials),
    });
    if (!done) return;
    toast.success(`Removed the protection from “${item.name}”`);
    refresh?.();
}

/** Colour folders (null = the default colour). */
export async function setFolderColor(folders, color, refresh) {
    if (!folders.length) return;
    try {
        await Promise.all(folders.map((f) => api.setFolderColor(f.id, color)));
    }
    catch (error) {
        toast.error(error.message);
    }
    finally {
        refresh?.();
    }
}
