import { describe, expect, it } from "vitest";
import { FOLDER_COLORS, folderColorHex, folderIconStyle } from "./folderColors";

describe("folder colours", () => {
    it("has the eight server colours", () => {
        expect(FOLDER_COLORS.map((c) => c.id)).toEqual(["red", "orange", "yellow", "green", "teal", "blue", "purple", "grey"]);
    });

    it("maps an id to its shade; default and unknown ids have none", () => {
        expect(folderColorHex("blue")).toBe("#3b82f6");
        expect(folderColorHex(null)).toBeNull();
        expect(folderColorHex("pink")).toBeNull();
        expect(folderIconStyle("red")).toEqual({ color: "#ef4444", fill: "#ef444433" });
        expect(folderIconStyle(null)).toBeUndefined();
    });
});
