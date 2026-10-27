import { describe, expect, it } from "vitest";
import { canPreview, firstStage } from "./previews";

describe("thumbnail fallback", () => {
    it("tries the Telegram thumbnail first", () => {
        expect(firstStage({ id: "1", type: "file", fileType: "photo", thumbnail: "AAMC" })).toBe("thumb");
    });
    it("asks the server for a preview of photos and videos without one", () => {
        expect(firstStage({ id: "1", type: "file", fileType: "photo" })).toBe("preview");
        expect(firstStage({ id: "2", type: "file", fileType: "video" })).toBe("preview");
    });
    it("shows the icon for everything else", () => {
        expect(firstStage({ id: "3", type: "file", fileType: "document" })).toBe("none");
        expect(firstStage({ id: "4", type: "folder" })).toBe("none");
        expect(canPreview({ id: "5", type: "file", fileType: "photo", is_cloud: true })).toBe(false);
        expect(canPreview({ type: "file", fileType: "photo" })).toBe(false);
    });
});
