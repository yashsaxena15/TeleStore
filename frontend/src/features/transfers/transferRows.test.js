import { describe, it, expect } from "vitest";
import { buildTransferItems, countByFilter, matchesFilter, formatEta, statusInfo, rowActions, kindLabel, activitySummary } from "./transferRows";
import { countRemoteTasks } from "./transferGrouping";

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

describe("a folder leech sent as a summary", () => {
    const summary = { total: 38000, counts: { queued: 31000, completed: 6800, failed: 199, downloading: 1 }, filesize: 9000, transferred_bytes: 9000, speed_bps: 5 };
    const rows = [
        { task_id: "a", id: "a", filename: "now.bin", status: "downloading", group_id: "big", group_name: "Backup", group_summary: summary },
        { task_id: "b", id: "b", filename: "next.bin", status: "queued", group_id: "big", group_name: "Backup", group_summary: summary },
    ];
    it("shows the whole folder's counts, not just the rows sent", () => {
        const group = buildTransferItems([], [], rows).find((i) => i.id === "big");
        expect(group.totalCount).toBe(38000);
        expect(group.completedCount).toBe(6800);
        expect(group.status).toBe("downloading");
        expect(group.progress).toBe(17.9);
        expect(group.phase).toBe("Leeching [6801/38000]: now.bin");
    });
    it("says why a folder's files failed", () => {
        const failedSummary = { total: 3, counts: { completed: 1, failed: 2 }, filesize: 0, transferred_bytes: 0, speed_bps: 0, error: "Google Drive refused the download (its sign-in had expired). Tap Retry." };
        const group = buildTransferItems([], [], [{ task_id: "c", id: "c", filename: "a.jpg", status: "failed", group_id: "drive", group_name: "Trip", group_summary: failedSummary }]).find((i) => i.id === "drive");
        expect(group.status).toBe("failed");
        expect(group.phase).toBe("2 of 3 files failed: Google Drive refused the download (its sign-in had expired). Tap Retry.");
    });
    it("counts active, completed and failed from the summary once", () => {
        expect(countRemoteTasks([...rows, { task_id: "s", status: "queued" }])).toMatchObject({ active: 31002, completed: 6800, failed: 199 });
    });
    it("doesn't count files paused by Google's limit as running", () => {
        const summary = { total: 3000, counts: { completed: 326, downloading: 1, queued: 2, paused_quota: 2641 }, filesize: 0, transferred_bytes: 0, speed_bps: 0 };
        const counts = countRemoteTasks([
            { task_id: "a", status: "downloading", group_id: "g", group_summary: summary },
            { task_id: "b", status: "queued", group_id: "g", group_summary: summary },
            { task_id: "c", status: "uploading_tg" },
        ]);
        expect(counts).toMatchObject({ active: 2645, running: 2, waiting: 2, pausedQuota: 2641 });
        expect(activitySummary({ running: counts.running, waiting: counts.waiting, paused: counts.pausedQuota })).toBe("2 running · 2 waiting · 2,641 paused by Google's limit");
    });
    it("says nothing when nothing is left to do", () => {
        expect(activitySummary({})).toBe("");
        expect(activitySummary({ paused: 5 })).toBe("5 paused by Google's limit");
    });
    it("shows when a paused folder resumes, from the server's summary", () => {
        const summary = { total: 2, counts: { completed: 1, paused_quota: 1 }, filesize: 0, transferred_bytes: 0, speed_bps: 0, resumes_at: "2026-10-30T10:38:00Z" };
        const group = buildTransferItems([], [], [{ task_id: "p", id: "p", filename: "a.zip", status: "completed", group_id: "q", group_name: "Tools", group_summary: summary }]).find((i) => i.id === "q");
        expect(group.status).toBe("paused_quota");
        expect(group.cooldown_until).toBe("2026-10-30T10:38:00Z");
        expect(group.phase).toMatch(/^Google Drive quota limit reached\. Auto-resumes at /);
    });
});
