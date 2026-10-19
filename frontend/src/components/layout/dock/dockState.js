// When the dock shows and what it shows, from what each part reported (useDockPresence)
// and the current route.
export function getDockState(presence = {}, pathname = "/") {
    const hasMedia = Boolean(presence.video || presence.audio);
    // The Transfers page already lists every transfer, so the dock summary steps aside there
    const showTransfers = pathname !== "/transfers";
    const visible = hasMedia || Boolean(presence.upload) || (showTransfers && Boolean(presence.transfers));
    return { hasMedia, showTransfers, visible };
}
