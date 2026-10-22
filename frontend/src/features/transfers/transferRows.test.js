import { describe, it, expect } from "vitest";
import { buildTransferItems, countByFilter, matchesFilter, formatEta, statusInfo, rowActions, kindLabel } from "./transferRows";

const uploads = [
    { id: "u1", filename: "a.mkv", status: "completed", startTime: "2026-10-19T08:00:00Z" },
    { id: "u2", filename: "b.pdf", status: "uploading", startTime: "2026-10-19T07:00:00Z" },
];
const downloads = [{ id: "d1", filename: "c.zip", status: "failed", size: 10, downloaded: 4, startTime: "2026-10-19T09:00:00Z" }];
const remote = [
    { task_id: "r1", id: "r1", filename: "iso", status: "downloading", source_type: "magnet" },
    { task_id: "g1a", id: "g1a", filename: "x", status: "completed", group_id: "g1", group_name: "Lectures", filesize: 5 },
    { task_id: "g1b", id: "g1b", filename: "y", status: "failed", group_id: "g1", group_name: "Lectures", filesize: 5 },
];

describe("buildTransferItems", () => {
    const items = buildTransferItems(uploads, downloads, remote);
    it("groups folder leeches and puts active transfers first", () => {
        expect(items.map((i) => i.id)).toEqual(["u2", "r1", "d1", "u1", "g1"]);
        expect(items.find((i) => i.id === "g1").status).toBe("failed");
        expect(items.find((i) => i.id === "g1").isGroup).toBe(true);
    });
    it("maps download sizes onto the shared fields", () => {
        const d = items.find((i) => i.id === "d1");
        expect(d.filesize).toBe(10);
        expect(d.bytesUploaded).toBe(4);
    });
    it("counts each filter; a folder with a failed file counts as failed", () => {
        expect(countByFilter(items)).toEqual({ all: 5, remote: 2, uploads: 2, downloads: 1, completed: 1, failed: 2 });
        expect(matchesFilter(items.find((i) => i.id === "g1"), "failed")).toBe(true);
    });
});

describe("row helpers", () => {
    it("formats ETA", () => {
        expect(formatEta(0)).toBe("");
        expect(formatEta(42)).toBe("42s");
        expect(formatEta(125)).toBe("2m 5s");
        expect(formatEta(3720)).toBe("1h 2m");
    });
    it("labels status and kind", () => {
        expect(statusInfo({ status: "paused_quota" })).toEqual({ label: "Quota pause", tone: "warning" });
        expect(statusInfo({ status: "uploading_tg" }).label).toBe("To Telegram");
        expect(kindLabel({ type: "remote", source_type: "magnet" })).toBe("Magnet");
        expect(kindLabel({ isGroup: true, group_type: "folder" })).toBe("Folder leech");
        expect(kindLabel({ type: "remote", source_type: "instagram" })).toBe("Instagram");
        expect(kindLabel({ isGroup: true, group_type: "instagram" })).toBe("Instagram");
        expect(kindLabel({ type: "remote", source_type: "media" })).toBe("Video download");
        expect(kindLabel({ isGroup: true, group_type: "media" })).toBe("Playlist");
        expect(statusInfo({ status: "paused_quota", source_type: "media" }).label).toBe("Waiting");
        expect(statusInfo({ status: "paused_quota", source_type: "gdrive_file" }).label).toBe("Quota pause");
    });
    it("offers the right buttons", () => {
        expect(rowActions({ type: "upload", status: "uploading" })).toMatchObject({ pause: true, cancel: true, retry: false });
        expect(rowActions({ type: "remote", status: "downloading" })).toMatchObject({ pause: false, cancel: true });
        expect(rowActions({ type: "remote", status: "paused_quota" })).toMatchObject({ resumeRemaining: true, cancel: true });
        expect(rowActions({ type: "download", status: "completed", savePath: "/x" }).showInFolder).toBe(true);
        expect(rowActions({ type: "remote", isGroup: true, status: "completed", items: [{ status: "failed" }] }).resumeRemaining).toBe(true);
    });
});
