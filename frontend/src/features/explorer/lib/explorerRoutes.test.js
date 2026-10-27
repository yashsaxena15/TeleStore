import { describe, it, expect } from "vitest";
import { viewFromPathname, explorerUrl, pathFromUrl, sameLocation, segmentsFromFilePath } from "./explorerRoutes";

describe("explorer routes", () => {
    it("knows which page an address shows", () => {
        expect(viewFromPathname("/")).toBe("files");
        expect(viewFromPathname("/Movies")).toBe("files");
        expect(viewFromPathname("/profile")).toBe("settings");
        expect(viewFromPathname("/users")).toBe("settings");
        expect(viewFromPathname("/settings")).toBe("settings");
        expect(viewFromPathname("/storage")).toBe("storage");
        expect(viewFromPathname("/photos")).toBe("photos");
        expect(viewFromPathname("/playlists")).toBe("playlists");
        expect(viewFromPathname("/playlists/liked")).toBe("playlists");
        expect(viewFromPathname("/downloads")).toBe("transfers");
    });
    it("round-trips folder paths", () => {
        for (const path of [["Home"], ["Home", "Movies"], ["Home", "My Films", "2024"], ["Home", "Telegram Inbox"], ["Private Vault"], ["Private Vault", "Tax"]]) {
            expect(pathFromUrl(explorerUrl(path))).toEqual(path);
        }
        expect(explorerUrl(["Home", "My Films"])).toBe("/My%20Films");
        expect(explorerUrl(["Vault", "Tax"])).toBe("/Private%20Vault/Tax");
    });
    it("never turns a page address into a folder", () => {
        expect(pathFromUrl("/storage")).toEqual(["Home"]);
        expect(pathFromUrl("/settings")).toEqual(["Home"]);
        expect(pathFromUrl("/Home/Movies")).toEqual(["Home", "Movies"]);
        expect(pathFromUrl("/bad%E0%A4")).toEqual(["Home", "bad%E0%A4"]);
    });
    it("compares saved locations", () => {
        const a = { path: ["Home", "Movies"], filter: "all" };
        expect(sameLocation(a, { path: ["Home", "Movies"], filter: "all" })).toBe(true);
        expect(sameLocation(a, { path: ["Home"], filter: "all" })).toBe(false);
        expect(sameLocation(a, null)).toBe(false);
    });
    it("turns stored file paths into folders", () => {
        expect(segmentsFromFilePath("/Home/Movies")).toEqual(["Home", "Movies"]);
        expect(segmentsFromFilePath("/Movies")).toEqual(["Home", "Movies"]);
        expect(segmentsFromFilePath("/Vault/Tax")).toEqual(["Private Vault", "Tax"]);
        expect(segmentsFromFilePath("")).toEqual(["Home"]);
    });
});
