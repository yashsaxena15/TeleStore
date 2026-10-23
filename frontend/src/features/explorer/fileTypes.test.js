import { describe, expect, it } from "vitest";
import { serverTime } from "./fileTypes";
import { formatShortDate } from "./lib/explorerItems";

describe("serverTime", () => {
    it("reads times saved without a zone as UTC", () => {
        expect(serverTime("2026-10-23T09:44:00.123456")).toBe("2026-10-23T09:44:00.123456Z");
        expect(new Date(serverTime("2026-10-23T09:44:00")).toISOString()).toBe("2026-10-23T09:44:00.000Z");
    });
    it("leaves times that carry their zone alone", () => {
        expect(serverTime("2026-10-23T09:44:00+00:00")).toBe("2026-10-23T09:44:00+00:00");
        expect(serverTime("2026-10-23T09:44:00Z")).toBe("2026-10-23T09:44:00Z");
        expect(serverTime("2026-10-23")).toBe("2026-10-23");
        expect(serverTime(undefined)).toBeUndefined();
    });
    it("a file saved a moment ago reads as just now", () => {
        const now = new Date("2026-10-23T09:44:30Z");
        expect(formatShortDate(serverTime("2026-10-23T09:44:00"), now)).toBe("just now");
    });
});
