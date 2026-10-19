import { describe, it, expect } from "vitest";
import {
  calculatePercentage,
  formatPercentage,
  buildCategoryRows,
  buildBarSegments,
  sortLargestFiles,
  normalizeFolderPath,
  getTrashSummary,
  STORAGE_CATEGORIES,
} from "./storageHelpers";

describe("calculatePercentage and formatPercentage", () => {
  it("calculates percentage accurately", () => {
    expect(calculatePercentage(25, 100)).toBe(25);
    expect(calculatePercentage(1, 3, 2)).toBe(33.33);
    expect(calculatePercentage(1, 3, 1)).toBe(33.3);
  });

  it("handles zero and negative total safely", () => {
    expect(calculatePercentage(50, 0)).toBe(0);
    expect(calculatePercentage(50, -100)).toBe(0);
    expect(calculatePercentage(0, 100)).toBe(0);
    expect(calculatePercentage(-10, 100)).toBe(0);
    expect(calculatePercentage(null, undefined)).toBe(0);
  });

  it("formats percentage string", () => {
    expect(formatPercentage(25, 100)).toBe("25%");
    expect(formatPercentage(1, 3, 1)).toBe("33.3%");
    expect(formatPercentage(0, 0)).toBe("0%");
  });
});

describe("buildCategoryRows", () => {
  it("maps category stats to rows with shares", () => {
    const byCat = {
      video: { bytes: 600, count: 3 },
      photo: { bytes: 300, count: 5 },
      audio: { bytes: 100, count: 2 },
    };
    const totalBytes = 1000;
    const rows = buildCategoryRows(byCat, totalBytes);

    expect(rows).toHaveLength(STORAGE_CATEGORIES.length);
    const videoRow = rows.find((r) => r.key === "video");
    expect(videoRow).toMatchObject({
      bytes: 600,
      count: 3,
      sharePercent: 60,
    });

    const photoRow = rows.find((r) => r.key === "photo");
    expect(photoRow).toMatchObject({
      bytes: 300,
      count: 5,
      sharePercent: 30,
    });

    const otherRow = rows.find((r) => r.key === "other");
    expect(otherRow).toMatchObject({
      bytes: 0,
      count: 0,
      sharePercent: 0,
    });
  });

  it("handles empty or missing categories", () => {
    const rows = buildCategoryRows(undefined, 0);
    expect(rows).toHaveLength(STORAGE_CATEGORIES.length);
    expect(rows.every((r) => r.bytes === 0 && r.sharePercent === 0)).toBe(true);
  });
});

describe("buildBarSegments", () => {
  it("filters out empty categories for stacked bar", () => {
    const byCat = {
      video: { bytes: 500, count: 2 },
      audio: { bytes: 0, count: 0 },
      photo: { bytes: 500, count: 10 },
    };
    const segments = buildBarSegments(byCat, 1000);
    expect(segments.map((s) => s.key)).toEqual(["video", "photo"]);
    expect(segments[0].sharePercent).toBe(50);
    expect(segments[1].sharePercent).toBe(50);
  });

  it("returns empty array if totalBytes is 0", () => {
    expect(buildBarSegments({}, 0)).toEqual([]);
  });
});

describe("sortLargestFiles", () => {
  it("sorts files descending by file_size", () => {
    const files = [
      { id: "1", file_name: "small.mp4", file_size: 100 },
      { id: "2", file_name: "huge.mkv", file_size: 5000 },
      { id: "3", file_name: "medium.zip", file_size: 1500 },
    ];
    const sorted = sortLargestFiles(files);
    expect(sorted.map((f) => f.id)).toEqual(["2", "3", "1"]);
  });

  it("falls back to size property or 0 when missing", () => {
    const files = [
      { id: "a" },
      { id: "b", size: 400 },
      { id: "c", file_size: 200 },
    ];
    const sorted = sortLargestFiles(files);
    expect(sorted.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("handles non-array inputs safely", () => {
    expect(sortLargestFiles(null)).toEqual([]);
    expect(sortLargestFiles(undefined)).toEqual([]);
  });
});

describe("normalizeFolderPath", () => {
  it("normalizes standard paths to segments with Home root", () => {
    expect(normalizeFolderPath("/Home/Documents/Invoices")).toEqual(["Home", "Documents", "Invoices"]);
    expect(normalizeFolderPath("Documents/Invoices")).toEqual(["Home", "Documents", "Invoices"]);
    expect(normalizeFolderPath("/")).toEqual(["Home"]);
    expect(normalizeFolderPath("")).toEqual(["Home"]);
    expect(normalizeFolderPath(null)).toEqual(["Home"]);
  });

  it("preserves Private Vault as root", () => {
    expect(normalizeFolderPath("Private Vault/Secret")).toEqual(["Private Vault", "Secret"]);
  });
});

describe("getTrashSummary", () => {
  it("correctly identifies empty and non-empty trash", () => {
    expect(getTrashSummary(0, 0)).toEqual({ count: 0, bytes: 0, isEmpty: true });
    expect(getTrashSummary(3, 4096)).toEqual({ count: 3, bytes: 4096, isEmpty: false });
    expect(getTrashSummary(-1, -10)).toEqual({ count: 0, bytes: 0, isEmpty: true });
  });
});

