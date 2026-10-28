// Protect from deletion. A protected file or folder (and everything in a protected folder) can't
// be trashed or deleted until the user confirms with their password (or an emailed code when the
// account signs in with Google only). The server answers such a delete with HTTP 423; confirming
// gives an unlock token that works for 5 minutes, for any number of requests (a bulk delete asks once).
//
// The confirm dialog (ProtectionDialog) is mounted once, in App; confirmProtected() opens it.

const CONFIRM_EVENT = "telestore:confirm-protected";
// Forget the token a little before the server does, so a request never races its expiry
const EXPIRY_MARGIN_MS = 10_000;

let cached = null; // { token, expiresAt }
let pending = null; // the open prompt, shared by requests that hit 423 at the same time

/** The unlock token from a recent confirm, while it's still good. */
export function cachedUnlockToken(now = Date.now()) {
    if (cached && cached.expiresAt > now) return cached.token;
    cached = null;
    return null;
}

export function rememberUnlockToken(token, expiresIn = 300, now = Date.now()) {
    if (!token) return;
    cached = { token, expiresAt: now + Math.max(0, Number(expiresIn) || 0) * 1000 - EXPIRY_MARGIN_MS };
}

export function forgetUnlockToken() {
    cached = null;
}

/** The server refused because the item is protected (HTTP 423 Locked). */
export const isProtectedError = (error) => error?.status === 423;

/** Thrown when the user closes the confirm dialog: nothing was deleted. */
export class ProtectionCancelled extends Error {
    constructor() {
        super("Not deleted");
        this.name = "ProtectionCancelled";
    }
}
export const isProtectionCancelled = (error) => error instanceof ProtectionCancelled;

/**
 * Asks the user to confirm (password or emailed code). Resolves the unlock token, or null when
 * they cancel. Calls made while the dialog is open share it.
 */
export function confirmProtected(reason) {
    if (pending) return pending;
    if (typeof window === "undefined") return Promise.resolve(null);
    pending = new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: { reason, resolve } }));
    }).then((token) => {
        pending = null;
        return token || null;
    });
    return pending;
}

/** The dialog listens here. The handler gets { reason, resolve } and must call resolve once. */
export function onConfirmProtectedRequest(handler) {
    const listener = (e) => handler(e.detail);
    window.addEventListener(CONFIRM_EVENT, listener);
    return () => window.removeEventListener(CONFIRM_EVENT, listener);
}

/**
 * Runs deletes that may hit protected items. `action(token)` makes the request (token is
 * undefined when there is none yet). On 423 it asks once, then retries with the token. After the
 * user cancels, later 423s in the same guard fail with ProtectionCancelled without asking again.
 */
export function createProtectionGuard({ confirm = confirmProtected } = {}) {
    let declined = false;
    return async function run(action) {
        const token = cachedUnlockToken();
        try {
            return await action(token || undefined);
        }
        catch (error) {
            if (!isProtectedError(error)) throw error;
            if (declined) throw new ProtectionCancelled();
            if (token) forgetUnlockToken(); // the server no longer takes it
            const fresh = await confirm(error.message);
            if (!fresh) {
                declined = true;
                throw new ProtectionCancelled();
            }
            return await action(fresh);
        }
    };
}

/** One protected-aware request (see createProtectionGuard). */
export const withProtection = (action, options) => createProtectionGuard(options)(action);

/**
 * Asks first (unless a token is cached), then runs `action(token)`; for turning protection off.
 * Resolves undefined when the user cancels.
 */
export async function withUnlock(reason, action, { confirm = confirmProtected } = {}) {
    let token = cachedUnlockToken();
    if (!token) {
        token = await confirm(reason);
        if (!token) throw new ProtectionCancelled();
    }
    try {
        return await action(token);
    }
    catch (error) {
        if (!isProtectedError(error)) throw error;
        forgetUnlockToken();
        const fresh = await confirm(error.message || reason);
        if (!fresh) throw new ProtectionCancelled();
        return await action(fresh);
    }
}

/** Items in TeleStore (not Google Drive, the Vault or Trash) can be protected. */
export const canProtect = (item) => Boolean(item && item.id && !item.is_cloud && !item.is_virtual && !item.trashed && !item.is_trashed);
