// Playlists on the website: the same playlists as the Android app (server: /files/playlists).
// "Liked music" (id "liked") is always there and can't be renamed or deleted.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { apiFileToFileItem, isAudioItem, isVideoItem } from "@/features/explorer/fileTypes";

export const LIKED = "liked";
export const PLAYLISTS_KEY = ["playlists"];
const ADD_EVENT = "telestore:add-to-playlist";

/** Music and videos in TeleStore (not Google Drive) can go in a playlist. */
export const canAddToPlaylist = (item) => Boolean(item && item.type !== "folder" && item.id && !item.is_cloud && (isAudioItem(item) || isVideoItem(item)));

/** Opens the "Add to playlist" dialog (mounted once, in FileExplorer) for the playable items. */
export function requestAddToPlaylist(items) {
    const playable = (items || []).filter(canAddToPlaylist);
    if (playable.length && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail: playable }));
    return playable.length;
}

export function onAddToPlaylistRequest(handler) {
    const listener = (e) => handler(e.detail || []);
    window.addEventListener(ADD_EVENT, listener);
    return () => window.removeEventListener(ADD_EVENT, listener);
}

export const countLabel = (n) => (n === 1 ? "1 item" : `${n} items`);

/** A playlist from the server, with its items as file items. */
export const mapPlaylist = (p) => ({
    ...p,
    isLiked: p.kind === LIKED,
    fileIds: p.file_ids || [],
    cover: p.cover ? apiFileToFileItem(p.cover) : null,
    items: (p.items || []).map(apiFileToFileItem),
});

/** All playlists, Liked music first. */
export function usePlaylists() {
    return useQuery({
        queryKey: PLAYLISTS_KEY,
        queryFn: async () => (await api.fetchPlaylists()).playlists.map(mapPlaylist),
        staleTime: 30_000,
    });
}

/** The ids in Liked music, for the heart. */
export function useLikedIds() {
    const { data } = usePlaylists();
    return new Set(data?.find((p) => p.isLiked)?.fileIds || []);
}

/** Refreshes every playlist query after a change. */
export function useRefreshPlaylists() {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: PLAYLISTS_KEY });
}

/** The queue order to play: the playlist from [index], or shuffled with that item first. */
export function playOrder(items, index = 0, shuffle = false, random = Math.random) {
    if (!shuffle) return { items, index };
    const rest = items.filter((_, i) => i !== index);
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return { items: [items[index], ...rest].filter(Boolean), index: 0 };
}

/** [items] with the one at [from] moved by [by] places. */
export function moveItem(items, from, by) {
    const to = from + by;
    if (to < 0 || to >= items.length) return items;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
}

/** The playlist id in the address (/playlists/<id>), or null on the list. */
export const playlistIdFromPath = (pathname = "") => {
    const m = /^\/playlists\/([^/]+)\/?$/.exec(pathname);
    if (!m) return null;
    try {
        return decodeURIComponent(m[1]);
    }
    catch {
        return m[1];
    }
};
