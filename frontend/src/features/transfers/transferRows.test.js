import { describe, it, expect } from "vitest";
import { buildTransferItems, countByFilter, matchesFilter, formatEta, statusInfo, rowActions, kindLabel, activitySummary, itemSpeeds, totalSpeeds, speedText, headerLine, googleNote, workerLabel, fileActions, detailFacts, FOLDER_FILTERS } from "./transferRows";
import { countRemoteTasks, groupRemoteTransfers } from "./transferGrouping";
import { smoothSpeed } from "./speed";

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
        expect(statusInfo({ status: "paused_quota" })).toEqual({ label: "Google limit", tone: "warning" });
        expect(statusInfo({ status: "uploading_tg" }).label).toBe("To Telegram");
        expect(kindLabel({ type: "remote", source_type: "magnet" })).toBe("Magnet");
        expect(kindLabel({ isGroup: true, group_type: "folder" })).toBe("Folder leech");
        expect(kindLabel({ type: "remote", source_type: "instagram" })).toBe("Instagram");
        expect(kindLabel({ isGroup: true, group_type: "instagram" })).toBe("Instagram");
        expect(kindLabel({ type: "remote", source_type: "media" })).toBe("Video download");
        expect(kindLabel({ isGroup: true, group_type: "media" })).toBe("Playlist");
        expect(statusInfo({ status: "paused_quota", source_type: "media" }).label).toBe("Waiting");
        expect(statusInfo({ status: "paused_quota", source_type: "gdrive_file" }).label).toBe("Google limit");
    });
    it("offers the right buttons", () => {
        expect(rowActions({ type: "upload", status: "uploading" })).toMatchObject({ pause: true, cancel: true, retry: false });
        expect(rowActions({ type: "remote", status: "downloading" })).toMatchObject({ pause: false, cancel: true });
        expect(rowActions({ type: "remote", status: "paused_quota" })).toMatchObject({ resumeNow: true, cancel: true });
        expect(rowActions({ type: "download", status: "completed", savePath: "/x" }).showInFolder).toBe(true);
        expect(rowActions({ type: "remote", isGroup: true, status: "failed", items: [{ status: "failed" }] })).toMatchObject({ retryFailed: true, retry: false, resumeNow: false });
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

describe("the server pausing only files that hit Google's limit", () => {
    const at = () => "4:08 PM";
    const summary = { name: "Other Tools", total: 2967, counts: { completed: 326, downloading: 2, paused_quota: 3 }, filesize: 26_628_797_235, transferred_bytes: 0, speed_bps: 9, download_bps: 7, upload_bps: 2, resumes_at: "2026-11-02T10:38:00Z", source_url: "https://drive.google.com/x", destination_path: "/Home/Tools", created_at: "2026-11-02T08:00:00Z" };
    it("keeps a folder running while some of its files wait, with an amber note", () => {
        const [group] = groupRemoteTransfers([], { g: summary }).groupedRemoteItems;
        expect(group.status).toBe("downloading");
        expect(group.filename).toBe("Other Tools");
        expect(group.source_url).toBe("https://drive.google.com/x");
        expect(group.destination_path).toBe("/Home/Tools");
        expect(group.pausedCount).toBe(3);
        expect(googleNote(group, at)).toBe("3 files wait for Google's limit · next resumes at 4:08 PM");
        expect(rowActions(group)).toMatchObject({ resumeNow: true, retryFailed: false, cancel: true });
        expect(itemSpeeds(group)).toEqual({ down: 7, up: 2 });
    });
    it("shows the limit as the folder's status only when every file left waits", () => {
        const [group] = groupRemoteTransfers([], { g: { ...summary, counts: { completed: 10, paused_quota: 1 } } }).groupedRemoteItems;
        expect(group.status).toBe("paused_quota");
        expect(statusInfo(group).label).toBe("Google limit");
        expect(googleNote(group, at)).toBe("1 file waits for Google's limit · resumes at 4:08 PM");
    });
    it("a folder waiting its turn isn't shown as paused", () => {
        const [group] = groupRemoteTransfers([], { g: { ...summary, counts: { queued: 5, paused_quota: 2 } } }).groupedRemoteItems;
        expect(group.status).toBe("queued");
    });
    it("lists folders the server sends only as a summary, and counts them once", () => {
        const items = buildTransferItems([], [], [{ task_id: "x", id: "x", status: "queued", group_id: "g", group_summary: summary }], { g: summary, h: { total: 1, counts: { failed: 1 } } });
        expect(items.filter((i) => i.isGroup).map((i) => i.id).sort()).toEqual(["g", "h"]);
        expect(countRemoteTasks([], { g: summary, h: { total: 1, counts: { failed: 1 } } })).toMatchObject({ running: 2, pausedQuota: 3, failed: 1, completed: 326 });
    });
    it("a single paused file says when it tries again", () => {
        expect(googleNote({ type: "remote", status: "paused_quota", cooldown_until: "2026-11-02T10:38:00Z" }, at)).toBe("Waits for Google's download limit · resumes at 4:08 PM");
        expect(googleNote({ type: "remote", status: "paused_quota" })).toBe("Waits for Google's download limit · resumes by itself");
        expect(googleNote({ type: "remote", status: "paused_quota", source_type: "media" })).toBe("");
        expect(googleNote({ type: "remote", status: "downloading" })).toBe("");
    });
});

describe("speeds", () => {
    it("splits server speeds into down and up; older servers count their one speed as the download", () => {
        expect(itemSpeeds({ type: "remote", status: "downloading", download_bps: 5, upload_bps: 3, speed_bps: 8 })).toEqual({ down: 5, up: 3 });
        expect(itemSpeeds({ type: "remote", status: "downloading", speed_bps: 8 })).toEqual({ down: 8, up: 0 });
        expect(itemSpeeds({ type: "remote", status: "completed", speed_bps: 8 })).toEqual({ down: 0, up: 0 });
        expect(itemSpeeds({ type: "upload", status: "uploading", speed: 4 })).toEqual({ down: 0, up: 4 });
        expect(itemSpeeds({ type: "download", status: "downloading", speed: 6 })).toEqual({ down: 6, up: 0 });
    });
    it("adds them up for the header", () => {
        const speeds = totalSpeeds([{ type: "upload", status: "uploading", speed: 4 }, { type: "remote", status: "downloading", download_bps: 11_744_051, upload_bps: 6_396_309 }]);
        expect(speeds).toEqual({ down: 11_744_051, up: 6_396_313 });
        expect(speedText(speeds)).toBe("↓ 11.2 MB/s ↑ 6.1 MB/s");
        expect(headerLine("3 running", speeds)).toBe("3 running · ↓ 11.2 MB/s ↑ 6.1 MB/s");
        expect(headerLine("", { down: 0, up: 0 })).toBe("");
    });
    it("smooths a speed over about five seconds", () => {
        expect(smoothSpeed(0, 1000, 1)).toBe(1000);
        const burst = smoothSpeed(1000, 10_000, 1);
        expect(burst).toBeGreaterThan(2000);
        expect(burst).toBeLessThan(3500);
        expect(smoothSpeed(burst, 0, 1)).toBeLessThan(burst);
        expect(smoothSpeed(burst, 0, 1)).toBeGreaterThan(1000);
        expect(smoothSpeed(500, 100, 0)).toBe(500);
    });
});

describe("a folder's files and details", () => {
    it("names the machines", () => {
        expect(workerLabel("main")).toBe("Main server");
        expect(workerLabel("vm2")).toBe("vm2");
        expect(workerLabel(undefined)).toBe("");
    });
    it("offers retry for failed files and cancel for unfinished ones", () => {
        expect(fileActions({ status: "failed" })).toMatchObject({ retry: true, cancel: false });
        expect(fileActions({ status: "paused_quota" })).toMatchObject({ retry: false, cancel: true, resumeNow: true });
        expect(fileActions({ status: "completed", source_url: "x" })).toMatchObject({ retry: false, cancel: false, copyLink: true });
        expect(FOLDER_FILTERS.map((f) => f.id)).toEqual(["all", "active", "waiting", "failed", "done"]);
    });
    it("lists a transfer's facts in order, with the full error", () => {
        const facts = detailFacts({ type: "remote", source_url: "https://x/y", destination_path: "/Home", filesize: 2048, transferred_bytes: 1024, bytesUploaded: 1024, created_at: "2026-11-02T08:00:00Z", worker: "main", error_message: "HTTP 403 from source" }, { formatDate: () => "today" });
        expect(facts.map((f) => [f.label, f.value])).toEqual([
            ["Source link", "https://x/y"],
            ["Destination folder", "/Home"],
            ["Size", "1.0 KB of 2.0 KB"],
            ["Started", "today"],
            ["Machine", "Main server"],
            ["Error", "HTTP 403 from source"],
        ]);
        expect(facts[0].kind).toBe("link");
        expect(facts[5].kind).toBe("error");
    });
});
