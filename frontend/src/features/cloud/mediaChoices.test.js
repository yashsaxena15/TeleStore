import { describe, expect, it } from "vitest";
import { audioChoices, conversionNote, toChoice, videoChoices } from "./mediaChoices";

const youtube = {
    kind: "video",
    options: {
        video: [
            { value: "2160", height: 2160, fps: 25, hdr: false, size: 243_784_090 },
            { value: "1080", height: 1080, fps: 60, hdr: false, size: 33_865_443 },
            { value: "144", height: 144, fps: 25, hdr: false, size: 0 },
        ],
        audio: [{ id: "140", codec: "AAC", abr: 130, size: 3_449_447 }, { id: "251", codec: "Opus", abr: 129, size: 3_433_755 }],
    },
};

describe("videoChoices", () => {
    it("lists only the sizes the video has, with best and most compatible", () => {
        const values = videoChoices(youtube).map((c) => c.value);
        expect(values).toEqual(["best", "2160", "1080", "144", "compat"]);
        expect(videoChoices(youtube)[0].label).toBe("Best available (2160p)");
        expect(videoChoices(youtube)[2].label).toMatch(/^1080p 60fps · ~/);
    });
    it("a 144p-only video offers just 144p", () => {
        const only = { kind: "video", options: { video: [{ value: "144", height: 144, fps: 25 }], audio: [] } };
        expect(videoChoices(only).map((c) => c.value)).toEqual(["best", "144", "compat"]);
    });
    it("Facebook's named versions", () => {
        const fb = { kind: "video", options: { video: [{ value: "fmt:hd", label: "HD", size: 0 }, { value: "fmt:sd", label: "SD", size: 0 }], audio: [] } };
        expect(videoChoices(fb).map((c) => c.label)).toEqual(["Best available", "HD", "SD"]);
    });
    it("playlists get an up-to ladder", () => {
        const labels = videoChoices({ kind: "playlist" }).map((c) => c.label);
        expect(labels).toContain("Up to 4320p");
        expect(labels).toContain("Up to 144p");
    });
});

describe("audio", () => {
    it("originals first, then conversions", () => {
        const groups = audioChoices(youtube);
        expect(groups[0].items.map((i) => i.value)).toEqual(["original", "src:140", "src:251"]);
        expect(groups[1].items.map((i) => i.value)).toContain("mp3:320");
        expect(groups[1].items.map((i) => i.value)).toContain("flac");
    });
    it("choices for the server", () => {
        expect(toChoice({ mode: "audio", audio: "src:251" })).toEqual({ mode: "audio", audio_format: "original", audio_source: "251" });
        expect(toChoice({ mode: "audio", audio: "mp3:320" })).toEqual({ mode: "audio", audio_format: "mp3", audio_bitrate: "320" });
        expect(toChoice({ mode: "audio", audio: "flac" })).toEqual({ mode: "audio", audio_format: "flac" });
        expect(toChoice({ mode: "video", quality: "2160", subtitles: "" })).toEqual({ mode: "video", quality: "2160", subtitles: null });
    });
    it("says when a conversion can't sound better", () => {
        expect(conversionNote("mp3:320", youtube)).toMatch(/source is 130 kbps/);
        expect(conversionNote("mp3:128", youtube)).toBe("");
        expect(conversionNote("flac", youtube)).toMatch(/can't add quality/);
        expect(conversionNote("original", youtube)).toBe("");
    });
});
