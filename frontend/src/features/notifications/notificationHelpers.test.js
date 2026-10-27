import { describe, expect, it } from "vitest";
import { badgeText, freshItems, markReadLocally, popupPlan, relativeTime, targetRoute } from "./notificationHelpers";

const now = new Date("2026-10-27T12:00:00Z");
const n = (id, read = false) => ({ id, title: `T${id}`, body: `B${id}`, read, target: { type: "transfers" } });

describe("relativeTime", () => {
    it("reads server times without a zone as UTC", () => {
        expect(relativeTime("2026-10-27T11:55:00", now)).toBe("5 min ago");
        expect(relativeTime("2026-10-27T11:55:00Z", now)).toBe("5 min ago");
    });
    it("says just now, hours, yesterday, days, then the date", () => {
        expect(relativeTime("2026-10-27T11:59:40Z", now)).toBe("just now");
        expect(relativeTime("2026-10-27T09:00:00Z", now)).toBe("3 h ago");
        expect(relativeTime("2026-10-26T10:00:00Z", now)).toBe("yesterday");
        expect(relativeTime("2026-10-23T10:00:00Z", now)).toBe("4 days ago");
        expect(relativeTime("2026-10-02T10:00:00Z", now)).toBe("Oct 2");
        expect(relativeTime("2025-10-02T10:00:00Z", now)).toBe("Oct 2, 2025");
        expect(relativeTime("", now)).toBe("");
        expect(relativeTime("nonsense", now)).toBe("");
    });
});

describe("targetRoute", () => {
    it("maps each target to a page or a folder", () => {
        expect(targetRoute({ type: "transfers" })).toEqual({ view: "transfers" });
        expect(targetRoute({ type: "playlists" })).toEqual({ view: "playlists" });
        expect(targetRoute({ type: "settings" })).toEqual({ view: "settings" });
        expect(targetRoute({ type: "folder", path: "/Home/Music" })).toEqual({ folderPath: "/Home/Music" });
        expect(targetRoute({ type: "file", path: "/Telegram Inbox", id: "f1" })).toEqual({ folderPath: "/Telegram Inbox" });
        expect(targetRoute({ type: "folder" })).toEqual({ view: "files" });
        expect(targetRoute(null)).toBeNull();
        expect(targetRoute({ type: "rocket" })).toBeNull();
    });
});

describe("freshItems and popupPlan", () => {
    it("nothing is new on the first check", () => {
        expect(freshItems([n("3"), n("2")], null)).toEqual([]);
    });
    it("takes the unread ones newer than the last seen", () => {
        const items = [n("5"), n("4", true), n("3"), n("2"), n("1")];
        expect(freshItems(items, "3").map((x) => x.id)).toEqual(["5"]);
        expect(freshItems(items, "5")).toEqual([]);
        // The last seen one fell off the list: all unread ones are new
        expect(freshItems(items, "0").map((x) => x.id)).toEqual(["5", "3", "2", "1"]);
    });
    it("pops up three at most, then one summary", () => {
        expect(popupPlan([n("1"), n("2")]).map((p) => p.id)).toEqual(["1", "2"]);
        const plan = popupPlan([n("1"), n("2"), n("3"), n("4"), n("5")]);
        expect(plan.map((p) => p.id)).toEqual(["1", "2", "3", "summary"]);
        expect(plan[3].title).toBe("2 more notifications");
        expect(popupPlan([n("1"), n("2"), n("3"), n("4")])[3].title).toBe("1 more notification");
    });
});

describe("markReadLocally and badgeText", () => {
    const data = { items: [n("2"), n("1"), n("0", true)], unread: 2, latest: "2" };
    it("marks one or all as read and lowers the count", () => {
        const one = markReadLocally(data, ["1"]);
        expect(one.unread).toBe(1);
        expect(one.items.map((x) => x.read)).toEqual([false, true, true]);
        expect(markReadLocally(data, ["0"]).unread).toBe(2);
        expect(markReadLocally(data, [], true).unread).toBe(0);
        expect(markReadLocally(undefined, ["1"])).toBeUndefined();
    });
    it("shows the count, capped", () => {
        expect(badgeText(0)).toBe("");
        expect(badgeText(7)).toBe("7");
        expect(badgeText(140)).toBe("99+");
    });
});
