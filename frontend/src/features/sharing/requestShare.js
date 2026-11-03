// Opening the Share dialog from anywhere (the file menu, the details pane, Shared by me).
// The dialog is mounted once, in FileExplorer, and listens for this event.
const SHARE_EVENT = "telestore:share";

/** Asks the Share dialog to open for one item ({ id, name, type }). onChange runs after each change. */
export function requestShare(item, onChange) {
    if (!item?.id || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(SHARE_EVENT, { detail: { item, onChange } }));
}

export function onShareRequest(handler) {
    const listener = (e) => handler(e.detail || {});
    window.addEventListener(SHARE_EVENT, listener);
    return () => window.removeEventListener(SHARE_EVENT, listener);
}
