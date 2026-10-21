import { describe, it, expect } from "vitest";
import { countByType, filterAndSortItems, mapCloudItems } from "./itemFilters";

const items = [
    { name: "Movies", type: "folder", modified: "2026-10-01T00:00:00Z" },
    { name: "b.mkv", type: "file", fileType: "video", size: 5 * 1024 ** 3, modified: "2026-10-18T00:00:00Z" },
    { name: "a10.pdf", type: "file", fileType: "document", size: 2 * 1024 ** 2, modified: "2026-10-19T10:00:00Z" },
    { name: "a2.pdf", type: "file", fileType: "document", size: 50 * 1024 ** 2, modified: "2026-09-01T00:00:00Z" },
    { name: "song.flac", type: "file", fileType: "audio", size: 40 * 1024 ** 2 },
    { name: "x.bin", type: "file", fileType: "other", size: 1 },
];
const NOW = new Date("2026-10-19T12:00:00Z").getTime();
const names = (list) => list.map((i) => i.name);

describe("item filters", () => {
    it("counts each kind", () => {
        expect(countByType(items)).toEqual({ all: 6, folder: 1, video: 1, document: 3, photo: 0, audio: 1, archive: 0 });
    });
    it("sorts names naturally with folders first", () => {
        expect(names(filterAndSortItems(items, { now: NOW }))).toEqual(["Movies", "a2.pdf", "a10.pdf", "b.mkv", "song.flac", "x.bin"]);
    });
    it("filters by search, type, size and date", () => {
        expect(names(filterAndSortItems(items, { searchQuery: "A1", now: NOW }))).toEqual(["a10.pdf"]);
        expect(names(filterAndSortItems(items, { typeFilter: "document", now: NOW }))).toEqual(["a2.pdf", "a10.pdf", "x.bin"]);
        // Storage's "Other" row opens this filter; it used to match nothing
        expect(names(filterAndSortItems(items, { typeFilter: "other", now: NOW }))).toEqual(["x.bin"]);
        expect(names(filterAndSortItems([{ name: "notes.txt", type: "file", fileType: "other" }], { typeFilter: "other", now: NOW }))).toEqual([]);
        expect(names(filterAndSortItems(items, { sizeFilter: "huge", now: NOW }))).toEqual(["Movies", "b.mkv"]);
        // Items without a date stay visible under a date filter
        expect(names(filterAndSortItems(items, { dateFilter: "today", now: NOW }))).toEqual(["a10.pdf", "song.flac", "x.bin"]);
    });
    it("sorts by size and date", () => {
        expect(names(filterAndSortItems(items, { sortField: "size", sortOrder: "desc", foldersFirst: false, now: NOW }))[0]).toBe("b.mkv");
        expect(names(filterAndSortItems(items, { sortField: "date", sortOrder: "desc", foldersFirst: false, now: NOW })).slice(0, 2)).toEqual(["a10.pdf", "b.mkv"]);
    });
    it("maps Drive listings", () => {
        const mapped = mapCloudItems({ account_name: "My Drive", items: [{ id: "d1", name: "x.mp4", type: "file", size: 9, starred: true, trashed: false }] }, "acc1");
        expect(mapped[0]).toMatchObject({ id: "d1", is_cloud: true, cloud_account_id: "acc1", file_path: "/Cloud/My Drive", starred: true });
        expect(mapCloudItems(null, "acc1")).toEqual([]);
    });
});
