import { afterEach, describe, expect, it, vi } from "vitest";
// The API client reads the browser's storage when it loads; these helpers don't need it
vi.mock("@/lib/api", () => ({ api: {} }));

import { canAddToPlaylist, mapPlaylist, moveItem, playOrder, playlistIdFromPath, requestAddToPlaylist, onAddToPlaylistRequest } from "./playlists";

const song = { id: "s1", name: "a.mp3", type: "file", fileType: "audio" };
const clip = { id: "v1", name: "b.mkv", type: "file", fileType: "video" };
const doc = { id: "d1", name: "c.pdf", type: "file", fileType: "document" };

describe("playlists", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("takes music and videos only", () => {
        expect(canAddToPlaylist(song)).toBe(true);
        expect(canAddToPlaylist(clip)).toBe(true);
        expect(canAddToPlaylist(doc)).toBe(false);
        expect(canAddToPlaylist({ ...song, is_cloud: true })).toBe(false);
        expect(canAddToPlaylist({ id: "f", name: "Music", type: "folder" })).toBe(false);
    });

    it("asks the dialog for the playable items only", () => {
        vi.stubGlobal("window", new EventTarget());
        const got = [];
        const stop = onAddToPlaylistRequest((items) => got.push(items));
        expect(requestAddToPlaylist([song, doc, clip])).toBe(2);
        expect(requestAddToPlaylist([doc])).toBe(0);
        stop();
        expect(got).toEqual([[song, clip]]);
    });

    it("knows Liked music and reads items as files", () => {
        const p = mapPlaylist({ id: "liked", name: "Liked music", kind: "liked", count: 1, file_ids: ["s1"], items: [{ id: "s1", file_name: "a.mp3", file_type: "audio" }] });
        expect(p.isLiked).toBe(true);
        expect(p.fileIds).toEqual(["s1"]);
        expect(p.items[0].name).toBe("a.mp3");
    });

    it("moves an item up or down, never off the ends", () => {
        expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
        expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    });

    it("shuffles with the chosen item first and keeps every item", () => {
        const items = ["a", "b", "c", "d"];
        expect(playOrder(items, 1)).toEqual({ items, index: 1 });
        const shuffled = playOrder(items, 2, true, () => 0.3);
        expect(shuffled.items[0]).toBe("c");
        expect([...shuffled.items].sort()).toEqual(items);
    });

    it("reads the playlist from the address", () => {
        expect(playlistIdFromPath("/playlists")).toBeNull();
        expect(playlistIdFromPath("/playlists/liked")).toBe("liked");
        expect(playlistIdFromPath("/playlists/abc%20d/")).toBe("abc d");
    });
});
