import { describe, expect, it } from "vitest";
import {
    albumNames, bigger, comfortableRows, dayLabel, detailsDate, exposureCells, fileChips, gridRows, groupByDay, groupByMonth, memories, monthLabel, monthTitle,
    photosSubtitle, photosUnder, places, smaller, stacks, timelineDate, videoLength, viewerDay, viewerLine, PHOTOS_FOLDER,
} from "./timeline";

const today = new Date(2026, 9, 27, 15, 0); // Tue 27 Oct 2026, local time

describe("Photos timeline", () => {
    it("names days like Google Photos", () => {
        expect(dayLabel(new Date(2026, 9, 27, 1), today)).toBe("Today");
        expect(dayLabel(new Date(2026, 9, 26, 23), today)).toBe("Yesterday");
        expect(dayLabel(new Date(2026, 9, 14), today)).toBe("Wed, Oct 14");
        expect(dayLabel(new Date(2025, 0, 3), today)).toBe("Fri, Jan 3, 2025");
        expect(dayLabel(null, today)).toBe("Undated");
    });

    it("uses when it was taken before when it was uploaded", () => {
        const taken = new Date(2026, 5, 1).toISOString();
        const uploaded = new Date(2026, 9, 1).toISOString();
        expect(timelineDate({ takenAt: taken, modified: uploaded }).toISOString()).toBe(taken);
        expect(timelineDate({ modified: uploaded }).toISOString()).toBe(uploaded);
        expect(timelineDate({})).toBeNull();
    });

    it("groups by day and keeps the server's order", () => {
        const at = (d, h) => new Date(2026, 9, d, h).toISOString();
        const items = [
            { id: "a", takenAt: at(27, 12) },
            { id: "b", takenAt: at(27, 9) },
            { id: "c", takenAt: at(20, 8) },
            { id: "d" },
        ];
        const days = groupByDay(items, today);
        expect(days.map((d) => d.label)).toEqual(["Today", "Tue, Oct 20", "Undated"]);
        expect(days[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    });

    it("titles each earlier month once", () => {
        expect(monthTitle(null, new Date(2026, 9, 2), today)).toBeNull();
        expect(monthTitle(new Date(2026, 9, 2), new Date(2026, 8, 30), today)).toBe("September");
        expect(monthTitle(new Date(2026, 8, 30), new Date(2026, 8, 3), today)).toBeNull();
        expect(monthTitle(new Date(2026, 0, 2), new Date(2025, 11, 30), today)).toBe("December 2025");
        expect(monthLabel(new Date(2026, 9, 1), today)).toBe("October");
        expect(monthLabel(null, today)).toBe("Undated");
    });

    it("puts days of one month together for Month view", () => {
        const days = groupByDay([
            { id: "a", takenAt: new Date(2026, 9, 27).toISOString() },
            { id: "b", takenAt: new Date(2026, 9, 3).toISOString() },
            { id: "c", takenAt: new Date(2026, 8, 3).toISOString() },
        ], today);
        expect(groupByMonth(days).map((m) => m.items.map((i) => i.id))).toEqual([["a", "b"], ["c"]]);
    });

    it("lists places once each", () => {
        expect(places(["Gandhinagar", null, "Indroda Nature Park", " ", "gandhinagar", "Ahmedabad"])).toBe("Gandhinagar, Indroda Nature Park, Ahmedabad");
    });

    it("finds memories like the app", () => {
        const at = (y, m, d) => ({ id: `${y}-${m}-${d}`, takenAt: new Date(y, m, d, 10).toISOString() });
        const found = memories([at(2024, 9, 27), at(2021, 9, 27), at(2026, 9, 26), at(2026, 9, 25), at(2026, 9, 24), at(2026, 9, 23)], today);
        expect(found.map((m) => m.title)).toEqual(["2 years ago", "5 years ago", "Recent highlights"]);
        expect(found[2].items).toHaveLength(4);
    });

    it("writes video lengths like Google Photos", () => {
        expect(videoLength(7.2)).toBe("0:07");
        expect(videoLength(167)).toBe("02:47");
        expect(videoLength(3723)).toBe("1:02:03");
        expect(videoLength(null)).toBeNull();
    });

    it("heads the viewer and details", () => {
        const when = new Date(2026, 10, 1, 18, 35);
        const thisYear = new Date(2026, 10, 2);
        expect(viewerDay(when, thisYear)).toBe("Nov 1");
        expect(viewerDay(when, new Date(2027, 0, 1))).toBe("Nov 1, 2026");
        expect(viewerLine(when, "Gandhinagar, Gujarat")).toBe("6:35 PM • Gandhinagar, Gujarat");
        expect(viewerLine(null, "Ahmedabad")).toBe("Ahmedabad");
        expect(detailsDate(when)).toBe("Sun, Nov 1, 2026 • 6:35 PM");
    });

    it("details chips read like Google Photos", () => {
        const info = { width: 4096, height: 2304, aperture: 1.5, exposure: 1 / 105, focal_length: 4.95, iso: 80 };
        expect(exposureCells(info)).toEqual(["ƒ/1.5", "1/105s", "4.95 mm", "ISO80"]);
        expect(fileChips(info)).toEqual(["9.4 MP", "4096 x 2304"]);
        expect(exposureCells({})).toEqual([]);
    });

    it("shows only the phone backup folder", () => {
        expect(PHOTOS_FOLDER).toBe("/Home/Phone Backup");
    });
});

describe("layouts", () => {
    it("pinch moves between Month, Day and Comfortable", () => {
        expect(bigger("month")).toBe("day");
        expect(bigger("day")).toBe("comfortable");
        expect(smaller("comfortable")).toBe("day");
        expect(smaller("day")).toBe("month");
    });

    it("stacks photos taken a moment apart", () => {
        const at = (ms, video) => ({ id: String(ms), takenAt: new Date(ms).toISOString(), fileType: video ? "video" : "photo" });
        const groups = stacks([at(10000), at(9000), at(7500), at(1000), at(900, true), at(800)]);
        expect(groups.map((g) => g.map((i) => i.id))).toEqual([["10000", "9000", "7500"], ["1000"], ["900"], ["800"]]);
    });

    it("comfortable mixes rows, big tiles and wide photos like the app", () => {
        expect(comfortableRows(["a"])).toEqual([{ kind: "hero", item: "a" }]);
        expect(comfortableRows(["a", "b"])).toEqual([{ kind: "row", items: ["a", "b"], columns: 2 }]);
        const rows = comfortableRows(Array.from({ length: 14 }, (_, i) => String(i + 1)));
        expect(rows.map((r) => r.kind)).toEqual(["row", "feature", "row", "hero", "row", "hero"]);
        expect(rows[1]).toEqual({ kind: "feature", big: "4", small: ["5", "6"], bigOnLeft: false });
        const many = Array.from({ length: 50 }, (_, i) => i);
        const placed = comfortableRows(many).flatMap((r) => (r.kind === "row" ? r.items : r.kind === "hero" ? [r.item] : [r.big, ...r.small]));
        expect(placed).toEqual(many);
    });

    it("day and month are even rows", () => {
        expect(gridRows([1, 2, 3, 4], 3)).toEqual([{ kind: "row", items: [1, 2, 3], columns: 3 }, { kind: "row", items: [4], columns: 3 }]);
    });
});

describe("photo views", () => {
    it("an album is a folder inside the backup", () => {
        expect(photosUnder({ kind: "all" })).toBe(PHOTOS_FOLDER);
        expect(photosUnder({ kind: "starred" })).toBe(PHOTOS_FOLDER);
        expect(photosUnder({ kind: "album", name: "Camera" })).toBe(`${PHOTOS_FOLDER}/Camera`);
    });
    it("albums are the backup's folders, A to Z", () => {
        expect(albumNames([{ file_name: "WhatsApp", file_type: "folder" }, { file_name: "a.jpg", file_type: "image" }, { file_name: "Camera", file_type: "folder" }])).toEqual(["Camera", "WhatsApp"]);
    });
    it("says what is shown", () => {
        expect(photosSubtitle({ kind: "all" }, 1)).toBe("1 item from your phone backup");
        expect(photosSubtitle({ kind: "album", name: "Camera" }, 12)).toBe("Camera · 12 items");
        expect(photosSubtitle({ kind: "starred" }, 3)).toBe("Starred · 3 items");
    });
});
