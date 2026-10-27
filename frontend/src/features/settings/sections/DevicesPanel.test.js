import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: {} }));
const { deviceDetails } = await import("./DevicesPanel.jsx");

describe("deviceDetails", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    it("says how and when it signed in, and when another device was last used", () => {
        expect(deviceDetails({ method: "google", signed_in_at: "2026-10-26T12:00:00", last_seen: "2026-10-27T11:55:00", current: false }, now))
            .toBe("Google · signed in yesterday · active 5 min ago");
    });
    it("doesn't say this device is active (it obviously is)", () => {
        expect(deviceDetails({ method: "password", signed_in_at: "2026-10-27T11:00:00", last_seen: "2026-10-27T12:00:00", current: true }, now))
            .toBe("Password · signed in 1 h ago");
    });
});
