import { describe, expect, it } from "vitest";
import { machineState } from "./workers";

describe("machineState", () => {
    it("says a paused machine finishes what it runs", () => {
        expect(machineState({ paused: true, online: true, running: 2 })).toMatchObject({ label: "Paused", detail: "Finishing 2 transfers, then waits" });
        expect(machineState({ paused: true, online: true, running: 0 }).detail).toBe("Takes no new transfers until resumed");
    });
    it("tells online from offline", () => {
        expect(machineState({ paused: false, online: true, running: 1 })).toMatchObject({ label: "Online", detail: "1 transfer running" });
        expect(machineState({ paused: false, online: true, running: 0 }).detail).toBe("Idle");
        expect(machineState({ paused: false, online: false, running: 0 }).label).toBe("Offline");
    });
});
