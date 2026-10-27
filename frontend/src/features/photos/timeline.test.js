import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay, timelineDate, PHOTOS_FOLDER } from "./timeline";

const today = new Date(2026, 9, 27, 15, 0); // Tue 27 Oct 2026, local time

describe("Photos timeline", () => {
    it("names days like the Android app", () => {
        expect(dayLabel(new Date(2026, 9, 27, 1), today)).toBe("Today");
        expect(dayLabel(new Date(2026, 9, 26, 23), today)).toBe("Yesterday");
        expect(dayLabel(new Date(2026, 9, 14), today)).toBe("Wed, 14 Oct");
        expect(dayLabel(new Date(2025, 0, 3), today)).toBe("Fri, 3 Jan 2025");
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
        expect(days.map((d) => d.label)).toEqual(["Today", "Tue, 20 Oct", "Undated"]);
        expect(days[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    });

    it("shows only the phone backup folder", () => {
        expect(PHOTOS_FOLDER).toBe("/Home/Phone Backup");
    });
});
