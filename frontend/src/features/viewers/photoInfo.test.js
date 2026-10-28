import { describe, expect, it } from "vitest";
import { cameraLabel, exposureLine, flashLabel, formatAperture, formatCoordinates, formatExposure, formatFocalLength, mapsUrl, megapixelsLabel } from "./photoInfo";

describe("photo details", () => {
    it("names the camera without repeating the make", () => {
        expect(cameraLabel("Apple", "iPhone 13")).toBe("Apple iPhone 13");
        expect(cameraLabel("Canon", "Canon EOS R6")).toBe("Canon EOS R6");
        expect(cameraLabel("Google", null)).toBe("Google");
        expect(cameraLabel(null, null)).toBe("");
    });

    it("shows megapixels and size", () => {
        expect(megapixelsLabel({ megapixels: 12.19, width: 4032, height: 3024 })).toBe("12.2 MP · 4032 × 3024");
        expect(megapixelsLabel({ width: 4032, height: 3024 })).toBe("12.2 MP · 4032 × 3024");
        expect(megapixelsLabel({ megapixels: 48 })).toBe("48 MP");
        expect(megapixelsLabel({})).toBe("");
    });

    it("formats shutter, aperture, ISO and focal length", () => {
        expect(formatExposure(1 / 120)).toBe("1/120 s");
        expect(formatExposure(0.008333)).toBe("1/120 s");
        expect(formatExposure(2)).toBe("2 s");
        expect(formatExposure("1/250")).toBe("1/250 s");
        expect(formatExposure("0.5")).toBe("1/2 s");
        expect(formatExposure("1/60 s")).toBe("1/60 s");
        expect(formatExposure(null)).toBe("");
        expect(formatAperture(1.8)).toBe("f/1.8");
        expect(formatAperture("f/2.2")).toBe("f/2.2");
        expect(formatFocalLength(4.2)).toBe("4.2 mm");
        expect(formatFocalLength(26)).toBe("26 mm");
        expect(exposureLine({ aperture: 1.8, exposure: 1 / 120, iso: 100, focal_length: 4.2 })).toBe("f/1.8 · 1/120 s · ISO 100 · 4.2 mm");
        expect(exposureLine({ iso: 400 })).toBe("ISO 400");
        expect(exposureLine({})).toBe("");
    });

    it("says whether the flash fired", () => {
        expect(flashLabel(true)).toBe("Flash fired");
        expect(flashLabel(false)).toBe("No flash");
        expect(flashLabel("Off, did not fire")).toBe("Off, did not fire");
        expect(flashLabel(null)).toBe("");
    });

    it("writes coordinates with N/S/E/W and links to Maps", () => {
        expect(formatCoordinates(15.55271, 73.75169)).toBe("15.5527° N, 73.7517° E");
        expect(formatCoordinates(-33.8568, -151.2153)).toBe("33.8568° S, 151.2153° W");
        expect(formatCoordinates(null, 73.7)).toBe("");
        expect(mapsUrl(15.5527, 73.7517)).toBe("https://www.google.com/maps?q=15.5527,73.7517");
        expect(mapsUrl(undefined, undefined)).toBeNull();
    });
});
