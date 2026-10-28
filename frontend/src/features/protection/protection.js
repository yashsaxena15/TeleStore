// Protect from deletion. A protected file or folder, anything inside a protected folder, and any
// folder holding a protected item can't be trashed or deleted at all: the server answers HTTP 423
// with a message saying why. The app hides delete for such items and shows that message.
//
// Removing the protection needs the password (or an emailed code when the account signs in with
// Google only). Confirming gives a one-time pass for that one item, used for that one request.
// The confirm dialog (ProtectionDialog) is mounted once, in App; confirmUnlock() opens it.

const CONFIRM_EVENT = "telestore:confirm-unlock";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The item itself is protected, or it's inside a protected folder. */
export const isProtectedItem = (item) => Boolean(item && (item.protected || item.protected_by));

/** The server refused because the item is protected (HTTP 423 Locked). */
export const isProtectedError = (error) => error?.status === 423;

/** Why this item can't be deleted (mirrors the server's message). */
export function protectedReason(item) {
    if (!item?.protected && item?.protected_by)
        return `“${item.name}” is inside the protected folder “${item.protected_by}”. Remove the folder's protection first.`;
    return `“${item?.name}” is protected. Remove protection first.`;
}

/** Why a selection can't be deleted, or null when nothing in it is protected. */
export function protectedSelectionReason(items) {
    const locked = (items || []).filter(isProtectedItem);
    if (!locked.length) return null;
    if (locked.length === 1 && items.length === 1) return protectedReason(locked[0]);
    return `${plural(locked.length, "protected item")} — remove protection first`;
}

/** After a bulk delete: how many were left alone because they're protected. */
export const notDeletedMessage = (n) => `${plural(n, "protected item")} not deleted`;

/** After emptying the trash: how many protected items it kept. */
export const keptMessage = (n) => `${plural(n, "protected item")} kept`;

/** Items in TeleStore (not Google Drive, the Vault or Trash) can be protected. */
export const canProtect = (item) => Boolean(item && item.id && !item.is_cloud && !item.is_virtual && !item.is_vault && !item.trashed && !item.is_trashed);

/**
 * Removes the protection from one item: asks the server for a pass with the user's password or
 * code, then spends it on that item straight away.
 */
export async function unprotectWith(client, fileId, credentials) {
    const { unlock_token: token } = await client.unlockProtection({ ...credentials, fileId });
    return client.setProtected(fileId, false, token);
}

/**
 * Opens the confirm dialog. `onConfirm(credentials)` runs when the user submits their password
 * ({ password }) or code ({ code }); if it throws, the dialog shows the error and stays open.
 * Resolves true once onConfirm succeeded, false when the user closes the dialog.
 */
export function confirmUnlock({ reason, onConfirm }) {
    if (typeof window === "undefined") return Promise.resolve(false);
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: { reason, onConfirm, resolve } }));
    });
}

/** The dialog listens here. The handler gets { reason, onConfirm, resolve } and must call resolve once. */
export function onConfirmUnlockRequest(handler) {
    const listener = (e) => handler(e.detail);
    window.addEventListener(CONFIRM_EVENT, listener);
    return () => window.removeEventListener(CONFIRM_EVENT, listener);
}
