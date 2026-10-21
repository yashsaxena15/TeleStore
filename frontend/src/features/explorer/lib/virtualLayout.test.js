import { describe, it, expect } from "vitest";
import { gridColumnCount, shouldVirtualize } from "./virtualLayout";

describe("virtual layout", () => {
    it("matches the grid's auto-fill columns", () => {
        expect(gridColumnCount(0)).toBe(2);
        expect(gridColumnCount(358)).toBe(2);
        expect(gridColumnCount(640)).toBe(4);
        expect(gridColumnCount(1190)).toBe(7);
        expect(gridColumnCount(150)).toBe(2);
    });
    it("only virtualizes long folders", () => {
        expect(shouldVirtualize(50)).toBe(false);
        expect(shouldVirtualize(1500)).toBe(true);
    });
});
