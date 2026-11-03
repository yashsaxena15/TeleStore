import { describe, expect, it } from "vitest";
import { canShare, crumbsFor, dateInputValue, expiryBody, expiryToIso, itemActions, joinRel, linkStateMessage, linkStatusLabel, linkUrls, memberUrls, parentRel, parseLimit, peopleLabel, previewKind, shareAbilities, shareLinkUrl, sortShareItems, withQuery } from "./shareHelpers";

describe("shareLinkUrl", () => {
    it("builds {origin}/s/{token}", () => {
        expect(shareLinkUrl("abc123", "https://store.example.com")).toBe("https://store.example.com/s/abc123");
        expect(shareLinkUrl("abc", "https://store.example.com/")).toBe("https://store.example.com/s/abc");
        expect(shareLinkUrl("a b")).toBe("/s/a%20b");
    });
});

describe("canShare", () => {
    it("allows your own files and folders", () => {
        expect(canShare({ id: "f1", name: "a.jpg", type: "file", file_path: "/Home" })).toBe(true);
        expect(canShare({ id: "f2", name: "Movies", type: "folder", file_path: "/Home" })).toBe(true);
    });
    it("never shares Vault, Drive, Trash or virtual items", () => {
        expect(canShare({ id: "v", name: "tax.pdf", file_path: "/Vault" })).toBe(false);
        expect(canShare({ id: "v", name: "tax.pdf", file_path: "/Vault/2025" })).toBe(false);
        expect(canShare({ id: "v", name: "x", is_vault: true })).toBe(false);
        expect(canShare({ id: "c", name: "x", is_cloud: true })).toBe(false);
        expect(canShare({ id: "t", name: "x", trashed: true })).toBe(false);
        expect(canShare({ id: "i", name: "x", is_virtual: true })).toBe(false);
        expect(canShare({ name: "no id" })).toBe(false);
        expect(canShare(null)).toBe(false);
    });
    it("does not mistake a folder path starting with Vault", () => {
        expect(canShare({ id: "f", name: "x", file_path: "/Vaulted" })).toBe(true);
    });
});

describe("roles", () => {
    it("viewers only view and download; editors change things", () => {
        expect(shareAbilities("viewer")).toMatchObject({ view: true, download: true, upload: false, rename: false, move: false, trash: false, newFolder: false });
        expect(shareAbilities("editor")).toMatchObject({ upload: true, rename: true, move: true, trash: true, newFolder: true });
    });
    it("the shared folder itself can be renamed but not moved or trashed", () => {
        expect(itemActions("editor", { isRoot: true })).toEqual({ rename: true, move: false, trash: false });
        expect(itemActions("editor")).toEqual({ rename: true, move: true, trash: true });
        expect(itemActions("viewer")).toEqual({ rename: false, move: false, trash: false });
    });
});

describe("expiry", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    it("turns an option into an ISO time", () => {
        expect(expiryToIso("never", now)).toBeNull();
        expect(expiryToIso("1d", now)).toBe("2026-11-05T10:00:00.000Z");
        expect(expiryToIso("7d", now)).toBe("2026-11-11T10:00:00.000Z");
        expect(expiryToIso("30d", now)).toBe("2026-12-04T10:00:00.000Z");
    });
    it("a custom date ends at the end of that local day", () => {
        const iso = expiryToIso("custom", now, "2026-12-25");
        const d = new Date(iso);
        expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 25, 23, 59]);
        expect(expiryToIso("custom", now, "")).toBeUndefined();
        expect(expiryToIso("custom", now, "25/12/2026")).toBeUndefined();
    });
    it("builds the link body: clear for Never, nothing for a bad date", () => {
        expect(expiryBody("never", now)).toEqual({ clear_expiry: true });
        expect(expiryBody("1d", now)).toEqual({ expires_at: "2026-11-05T10:00:00.000Z" });
        expect(expiryBody("custom", now, "")).toBeNull();
    });
    it("formats a date input value", () => {
        expect(dateInputValue(new Date(2026, 0, 5))).toBe("2026-01-05");
        expect(dateInputValue("nope")).toBe("");
    });
});

describe("link labels", () => {
    it("explains a link that doesn't work", () => {
        expect(linkStateMessage("expired")).toMatch(/expired/);
        expect(linkStateMessage("used_up")).toMatch(/download limit/);
        expect(linkStateMessage("active")).toBe("");
    });
    it("summarises a link for lists", () => {
        expect(linkStatusLabel(null)).toBe("");
        expect(linkStatusLabel({ enabled: false, state: "off" })).toBe("");
        expect(linkStatusLabel({ enabled: true, state: "active" })).toBe("Anyone with the link");
        expect(linkStatusLabel({ enabled: true, state: "expired" })).toBe("Link expired");
        expect(linkStatusLabel({ enabled: true, state: "used_up" })).toBe("Link used up");
    });
    it("counts people", () => {
        expect(peopleLabel(0)).toBe("");
        expect(peopleLabel(1)).toBe("1 person");
        expect(peopleLabel(3)).toBe("3 people");
    });
    it("reads a download limit", () => {
        expect(parseLimit("5")).toBe(5);
        expect(parseLimit(" 12 ")).toBe(12);
        expect(parseLimit("0")).toBeNull();
        expect(parseLimit("2.5")).toBeNull();
        expect(parseLimit("")).toBeNull();
    });
});

describe("paths inside a share", () => {
    it("joins and splits relative paths", () => {
        expect(joinRel("", "Day 1")).toBe("/Day 1");
        expect(joinRel("/Day 1", "Beach")).toBe("/Day 1/Beach");
        expect(parentRel("/Day 1/Beach")).toBe("/Day 1");
        expect(parentRel("/Day 1")).toBe("");
    });
    it("makes breadcrumbs from the shared folder down", () => {
        expect(crumbsFor("Goa", "/Day 1/Beach")).toEqual([
            { name: "Goa", path: "" }, { name: "Day 1", path: "/Day 1" }, { name: "Beach", path: "/Day 1/Beach" },
        ]);
        expect(crumbsFor("Goa", "")).toEqual([{ name: "Goa", path: "" }]);
    });
    it("lists folders first, then by name", () => {
        const sorted = sortShareItems([{ name: "b.jpg", type: "photo" }, { name: "Zeta", type: "folder" }, { name: "a10.jpg", type: "photo" }, { name: "a2.jpg", type: "photo" }]);
        expect(sorted.map((i) => i.name)).toEqual(["Zeta", "a2.jpg", "a10.jpg", "b.jpg"]);
    });
});

describe("previewKind", () => {
    it("picks a viewer from the type and extension", () => {
        expect(previewKind({ name: "Day 1", type: "folder" })).toBe("folder");
        expect(previewKind({ name: "beach.JPG", type: "document" })).toBe("image");
        expect(previewKind({ name: "clip.mp4", type: "document" })).toBe("video");
        expect(previewKind({ name: "song.flac", type: "audio" })).toBe("audio");
        expect(previewKind({ name: "report.pdf", type: "document" })).toBe("pdf");
        expect(previewKind({ name: "notes.txt", type: "document" })).toBe("doc");
        expect(previewKind({ name: "IMG", type: "photo" })).toBe("image");
        expect(previewKind({ name: "setup.exe", type: "document" })).toBe("other");
    });
});

describe("file addresses", () => {
    it("member addresses carry the sign-in token", () => {
        const u = memberUrls("https://s.example", "sh_1", "tok");
        expect(u.file("f1")).toBe("https://s.example/shares/sh_1/dl/f1?token=tok");
        expect(u.file("f1", true)).toBe("https://s.example/shares/sh_1/dl/f1?inline=1&token=tok");
        expect(u.thumb("f1")).toBe("https://s.example/shares/sh_1/thumb/f1?token=tok");
        expect(u.part("/shares/sh_1/zip?path=&part=1")).toBe("https://s.example/shares/sh_1/zip?path=&part=1&token=tok");
    });
    it("public link addresses never do", () => {
        const u = linkUrls("", "abc");
        expect(u.file("f1")).toBe("/share-links/abc/dl/f1");
        expect(u.file("f1", true)).toBe("/share-links/abc/dl/f1?inline=1");
        expect(u.thumb("f1")).toBe("/share-links/abc/thumb/f1");
        expect(u.part("/share-links/abc/zip?path=&part=2")).toBe("/share-links/abc/zip?path=&part=2");
    });
    it("adds to an existing query", () => {
        expect(withQuery("/a?x=1", { token: "t" })).toBe("/a?x=1&token=t");
        expect(withQuery("/a", { token: null })).toBe("/a");
    });
});
