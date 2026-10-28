// Menu actions: protect / unprotect items and colour folders. `refresh` reloads the file lists.
import { toast } from "sonner";
import { api } from "@/lib/api";
import { isProtectionCancelled, withUnlock } from "./protection";

const named = (items) => (items.length === 1 ? `“${items[0].name}”` : `${items.length} items`);

/** Protect items from deletion, or (after confirming with the password) remove the protection. */
export async function setProtection(items, on, refresh) {
    if (!items.length) return;
    try {
        if (on) {
            await Promise.all(items.map((it) => api.setProtected(it.id, true)));
            toast.success(`${named(items)} ${items.length === 1 ? "is" : "are"} protected from deletion`);
        }
        else {
            await withUnlock(`Confirm to remove the protection from ${named(items)}.`, async (token) => {
                for (const it of items) await api.setProtected(it.id, false, token);
            });
            toast.success(`Removed the protection from ${named(items)}`);
        }
    }
    catch (error) {
        if (isProtectionCancelled(error)) toast.info("Still protected");
        else toast.error(error.message);
    }
    finally {
        refresh?.();
    }
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
