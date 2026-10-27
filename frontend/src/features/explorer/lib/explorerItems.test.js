import { describe, it, expect } from "vitest";
import { formatShortDate, getTypeInfo, getSection, getSelectionActions, planMove, getItemParent } from "./explorerItems";

const ids = (actions) => actions.map((a) => a.id);

describe("formatShortDate", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    it("uses relative times for the last week", () => {
        expect(formatShortDate("2026-10-19T11:59:30Z", now)).toBe("just now");
        expect(formatShortDate("2026-10-19T11:15:00Z", now)).toBe("45m ago");
        expect(formatShortDate("2026-10-19T07:00:00Z", now)).toBe("5h ago");
        expect(formatShortDate("2026-10-17T12:00:00Z", now)).toBe("2d ago");
    });
    it("uses month and day after a week, adding the year when it differs", () => {
        expect(formatShortDate("2026-09-12T12:00:00Z", now)).toBe("Sep 12");
        expect(formatShortDate("2024-03-02T12:00:00Z", now)).toBe("Mar 2, 2024");
    });
    it("returns an empty string for missing or invalid dates", () => {
        expect(formatShortDate(null, now)).toBe("");
        expect(formatShortDate("not a date", now)).toBe("");
    });
});

describe("getTypeInfo", () => {
    it("classifies by file type or extension", () => {
        expect(getTypeInfo({ name: "Dune.mkv" })).toEqual({ kind: "video", label: "MKV" });
        expect(getTypeInfo({ name: "suite.flac" })).toEqual({ kind: "audio", label: "FLAC" });
        expect(getTypeInfo({ name: "a.JPG" })).toEqual({ kind: "image", label: "JPG" });
        expect(getTypeInfo({ name: "src.zip" })).toEqual({ kind: "archive", label: "ZIP" });
        expect(getTypeInfo({ name: "report.pdf" })).toEqual({ kind: "doc", label: "PDF" });
        expect(getTypeInfo({ name: "Movies", type: "folder" })).toEqual({ kind: "folder", label: "Folder" });
        expect(getTypeInfo({ name: "voice_12", fileType: "voice" }).kind).toBe("audio");
    });
});

describe("getSection", () => {
    it("prefers cloud, then trash, vault, inbox, starred", () => {
        expect(getSection({ isCloud: true, isTrash: true })).toBe("drive-trash");
        expect(getSection({ isCloud: true })).toBe("drive");
        expect(getSection({ isTrash: true, isVault: true })).toBe("trash");
        expect(getSection({ isVault: true })).toBe("vault");
        expect(getSection({ isInbox: true })).toBe("inbox");
        expect(getSection({ isStarred: true })).toBe("starred");
        expect(getSection({})).toBe("home");
    });
});

describe("getSelectionActions", () => {
    it("trash only offers restore and delete forever", () => {
        expect(ids(getSelectionActions("trash", { count: 1 }))).toEqual(["restore", "delete-forever"]);
    });
    it("home offers move, star, compress and vault", () => {
        expect(ids(getSelectionActions("home", { count: 2 }))).toEqual(["download", "move-to", "copy", "cut", "star", "compress", "to-vault", "delete"]);
        expect(ids(getSelectionActions("home", { count: 2, playable: true }))).toContain("playlist");
        expect(ids(getSelectionActions("trash", { count: 2, playable: true }))).not.toContain("playlist");
    });
    it("shows details only for a single item and unstar when all are starred", () => {
        const a = ids(getSelectionActions("home", { count: 1, allStarred: true }));
        expect(a).toContain("details");
        expect(a).toContain("unstar");
        expect(a).not.toContain("star");
    });
    it("inbox files items instead of moving, vault sends to home", () => {
        expect(ids(getSelectionActions("inbox", { count: 3 }))[0]).toBe("file-to");
        expect(ids(getSelectionActions("vault", { count: 3 }))).toContain("to-home");
        expect(ids(getSelectionActions("vault", { count: 3 }))).not.toContain("to-vault");
    });
    it("drive has no move-to (the picker only browses Telegram folders)", () => {
        expect(ids(getSelectionActions("drive", { count: 2 }))).not.toContain("move-to");
    });
});

describe("planMove", () => {
    const file = (name, file_path, extra = {}) => ({ id: name, name, file_path, ...extra });
    it("uses the plain move inside one side of the vault", () => {
        const { moves } = planMove([file("a.mkv", "/Home")], "/Home/Movies");
        expect(moves).toEqual([{ item: expect.objectContaining({ name: "a.mkv" }), via: "move" }]);
    });
    it("routes vault crossings through the vault endpoints", () => {
        expect(planMove([file("a", "/Home")], "/Vault/x").moves[0].via).toBe("vault-in");
        expect(planMove([file("b", "/Vault")], "/Home").moves[0].via).toBe("vault-out");
        expect(planMove([file("c", "/Vault", { is_vault: true })], "/Vault/sub").moves[0].via).toBe("move");
    });
    it("skips items already there, folders into themselves, and items without an id", () => {
        const { moves, skipped } = planMove([
            file("same", "/Home/Movies"),
            { id: "f", name: "Movies", type: "folder", file_path: "/Home" },
            { name: "noid", file_path: "/Home" },
        ], "/Home/Movies/");
        expect(moves).toEqual([]);
        expect(skipped.map((s) => s.reason)).toEqual(["same-folder", "into-itself", "missing-id"]);
    });
    it("normalises parents", () => {
        expect(getItemParent({ file_path: "//Home//Movies/" })).toBe("/Home/Movies");
        expect(getItemParent({}, "/inbox")).toBe("/inbox");
    });
});
