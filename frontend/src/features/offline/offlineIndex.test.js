import { describe, expect, it } from "vitest";
import { addFile, addFolder, emptyIndex, filesOfFolder, folderPathOf, folderSyncDiff, isUnder, parseIndex, removeFiles, removeFolder, spaceShortfall, totalBytes, unpinFile } from "./offlineIndex";

const NOW = "2026-10-27T10:00:00.000Z";
const f = (id, filePath = "/Home/Movies", size = 10) => ({ id, name: `${id}.mkv`, size, fileType: "video", file_path: filePath });

describe("offline index", () => {
    it("reads a stored index and survives a damaged one", () => {
        expect(parseIndex("{oops")).toEqual(emptyIndex());
        expect(parseIndex(null)).toEqual(emptyIndex());
        const idx = addFile(emptyIndex(), f("a"), { now: NOW });
        expect(parseIndex(JSON.stringify(idx))).toEqual(idx);
    });

    it("knows folder paths", () => {
        expect(folderPathOf({ name: "Movies", file_path: "/Home" })).toBe("/Home/Movies");
        expect(folderPathOf({ name: "Movies", file_path: "/Home/" })).toBe("/Home/Movies");
        expect(isUnder("/Home/Movies/2024", "/Home/Movies")).toBe(true);
        expect(isUnder("/Home/Movies", "/Home/Movies/")).toBe(true);
        expect(isUnder("/Home/Movies Old", "/Home/Movies")).toBe(false);
    });

    it("adds files on their own (pinned) or with a folder, and counts the bytes", () => {
        let idx = addFile(emptyIndex(), f("a"), { size: 12, type: "video/x-matroska", now: NOW });
        expect(idx.files.a).toMatchObject({ pinned: true, folder: null, size: 12, type: "video/x-matroska", saved_at: NOW });
        idx = addFile(idx, f("b"), { folder: "/Home/Movies", now: NOW });
        expect(idx.files.b).toMatchObject({ pinned: false, folder: "/Home/Movies" });
        // Saving a folder's file on its own later pins it and keeps its folder
        idx = addFile(idx, f("b"), { now: NOW });
        expect(idx.files.b).toMatchObject({ pinned: true, folder: "/Home/Movies" });
        expect(totalBytes(idx)).toBe(22);
        expect(removeFiles(idx, ["a", "zzz"]).removed).toEqual(["a"]);
    });

    it("removing a folder drops only the files that came with it", () => {
        let idx = addFolder(emptyIndex(), "/Home/Movies", "Movies", NOW);
        idx = addFolder(idx, "/Home/Movies/Kids", "Kids", NOW);
        idx = addFile(idx, f("a"), { folder: "/Home/Movies" });
        idx = addFile(idx, f("b"), { folder: "/Home/Movies" });
        idx = addFile(idx, f("b"));
        idx = addFile(idx, f("k", "/Home/Movies/Kids"), { folder: "/Home/Movies" });
        const { index, removed } = removeFolder(idx, "/Home/Movies");
        expect(removed).toEqual(["a"]);
        expect(index.folders["/Home/Movies"]).toBeUndefined();
        expect(index.files.b).toMatchObject({ pinned: true, folder: null });
        expect(index.files.k.folder).toBe("/Home/Movies/Kids");
        expect(filesOfFolder(index, "/Home/Movies/Kids").map((x) => x.id)).toEqual(["k"]);
    });

    it("a folder's file can't be removed on its own, only unpinned", () => {
        let idx = addFolder(emptyIndex(), "/Home/Movies", "Movies", NOW);
        idx = addFile(idx, f("a"), { folder: "/Home/Movies" });
        idx = addFile(idx, f("a"));
        let r = unpinFile(idx, "a");
        expect(r.removed).toEqual([]);
        expect(r.index.files.a.pinned).toBe(false);
        idx = addFile(emptyIndex(), f("x"));
        r = unpinFile(idx, "x");
        expect(r.removed).toEqual(["x"]);
        expect(unpinFile(idx, "nope").removed).toEqual([]);
    });

    it("a folder sync adds new files and drops the ones that are gone", () => {
        let idx = addFolder(emptyIndex(), "/Home/Movies", "Movies", NOW);
        idx = addFile(idx, f("a"), { folder: "/Home/Movies" });
        idx = addFile(idx, f("gone"), { folder: "/Home/Movies" });
        idx = addFile(idx, f("kept"));
        const { add, remove } = folderSyncDiff(idx, "/Home/Movies", [f("a"), f("new", "/Home/Movies/Sub")]);
        expect(add.map((x) => x.id)).toEqual(["new"]);
        // "kept" was saved on its own, so it stays even though it's no longer in the folder
        expect(remove).toEqual(["gone"]);
    });

    it("checks the space left", () => {
        expect(spaceShortfall(100, { quota: 1000, usage: 800 })).toBeNull();
        expect(spaceShortfall(300, { quota: 1000, usage: 800 })).toBe(200);
        expect(spaceShortfall(300, null)).toBeNull();
        expect(spaceShortfall(300, {})).toBeNull();
    });
});
