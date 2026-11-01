import { describe, expect, it } from "vitest";
import { adjustFilter, centredCrop, cropPixels, dragCorner, editedName, FULL, moveCrop } from "./edits";

const near = (a, b) => Math.abs(a - b) < 1e-3;

describe("photo editor", () => {
    it("centres crops of a shape", () => {
        expect(centredCrop(null, 4000, 3000)).toEqual(FULL);
        const square = centredCrop(1, 4000, 3000);
        expect(near(square.left, 0.125) && near(square.right, 0.875) && square.top === 0 && square.bottom === 1).toBe(true);
        const tall = centredCrop(16 / 9, 2304, 4096);
        expect(near(((tall.right - tall.left) * 2304) / ((tall.bottom - tall.top) * 4096), 9 / 16)).toBe(true);
    });

    it("drags corners within the photo", () => {
        expect(dragCorner(FULL, 0, 0.2, 0.1)).toEqual({ left: 0.2, top: 0.1, right: 1, bottom: 1 });
        const small = dragCorner(FULL, 2, -2, -2);
        expect(near(small.right - small.left, 0.08) && near(small.bottom - small.top, 0.08)).toBe(true);
        const sq = dragCorner({ left: 0, top: 0, right: 0.5, bottom: 0.5 }, 2, -0.1, 0, 1, 1);
        expect(near(sq.right - sq.left, sq.bottom - sq.top)).toBe(true);
    });

    it("moves the crop inside the photo", () => {
        const m = moveCrop({ left: 0.2, top: 0.2, right: 0.6, bottom: 0.6 }, 0.9, -0.5);
        expect([m.left, m.top, m.right, m.bottom].map((v) => Math.round(v * 10) / 10)).toEqual([0.6, 0, 1, 0.4]);
    });

    it("turns a crop into pixels", () => {
        expect(cropPixels({ left: 0.125, top: 0, right: 0.875, bottom: 1 }, 4000, 3000)).toEqual([500, 0, 3000, 3000]);
    });

    it("adjusts with plain filters", () => {
        expect(adjustFilter({})).toBe("brightness(100%) contrast(100%) saturate(100%)");
        expect(adjustFilter({ brightness: 0.5, saturation: -1 })).toBe("brightness(120%) contrast(100%) saturate(0%)");
    });

    it("names the copy", () => {
        expect(editedName("IMG_1.HEIC", 1730480000000)).toBe("IMG_1-edited-1730480000.jpg");
    });
});
