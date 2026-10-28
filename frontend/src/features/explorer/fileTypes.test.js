import { describe, expect, it } from "vitest";
import { apiFileToFileItem, serverTime } from "./fileTypes";
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

describe("apiFileToFileItem protection", () => {
    const api = (extra) => ({ id: "f1", file_name: "2024.pdf", file_type: "document", file_size: 1, file_path: "/Home/Taxes", ...extra });
    it("carries the item's own protection and the protected folder it's inside", () => {
        expect(apiFileToFileItem(api({ protected: true }))).toMatchObject({ protected: true, protected_by: null });
        expect(apiFileToFileItem(api({ protected: false, protected_by: "Taxes" }))).toMatchObject({ protected: false, protected_by: "Taxes" });
        expect(apiFileToFileItem(api({}))).toMatchObject({ protected: false, protected_by: null });
    });
});
