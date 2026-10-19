/**
 * Pure helper functions for Storage analytics, calculations,
 * category breakdowns, and file list manipulations.
 */

export const STORAGE_CATEGORIES = [
  { key: "video", label: "Videos", barClass: "bg-primary", tokenColor: "text-primary" },
  { key: "audio", label: "Audio & Voice", barClass: "bg-info", tokenColor: "text-info" },
  { key: "photo", label: "Images", barClass: "bg-success", tokenColor: "text-success" },
  { key: "document", label: "Documents", barClass: "bg-warning", tokenColor: "text-warning" },
  { key: "archive", label: "Archives", barClass: "bg-cloud", tokenColor: "text-cloud" },
  { key: "other", label: "Other", barClass: "bg-muted-foreground", tokenColor: "text-muted-foreground" },
];

/**
 * Calculates percentage safely without division by zero.
 */
export const calculatePercentage = (value, total, precision = 1) => {
  if (!total || total <= 0 || !value || value <= 0) return 0;
  const pct = (Number(value) / Number(total)) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Number(pct.toFixed(precision));
};

/**
 * Formats a share percentage as a human readable string.
 */
export const formatPercentage = (value, total, precision = 1) => {
  const pct = calculatePercentage(value, total, precision);
  return `${pct}%`;
};

/**
 * Builds table rows for categories with sizes, counts, and percentages.
 */
export const buildCategoryRows = (byCategory = {}, totalBytes = 0) => {
  const safeTotal = Number(totalBytes) || 0;
  return STORAGE_CATEGORIES.map((cat) => {
    const data = byCategory?.[cat.key] || {};
    const bytes = Number(data.bytes) || 0;
    const count = Number(data.count) || 0;
    const sharePercent = calculatePercentage(bytes, safeTotal, 1);
    return {
      key: cat.key,
      label: cat.label,
      bytes,
      count,
      sharePercent,
      barClass: cat.barClass,
      tokenColor: cat.tokenColor,
    };
  });
};

/**
 * Builds stacked bar segments for categories with positive bytes.
 */
export const buildBarSegments = (byCategory = {}, totalBytes = 0) => {
  const safeTotal = Number(totalBytes) || 0;
  if (safeTotal <= 0) return [];
  const rows = buildCategoryRows(byCategory, safeTotal);
  return rows.filter((r) => r.bytes > 0 && r.sharePercent > 0);
};

/**
 * Sorts files by size in descending order.
 */
export const sortLargestFiles = (files = []) => {
  if (!Array.isArray(files)) return [];
  return [...files].sort((a, b) => {
    const sizeA = Number(a?.file_size ?? a?.size ?? 0);
    const sizeB = Number(b?.file_size ?? b?.size ?? 0);
    return sizeB - sizeA;
  });
};

/**
 * Normalizes folder path string into segments for FileExplorer navigation.
 */
export const normalizeFolderPath = (filePath) => {
  if (!filePath || typeof filePath !== "string") return ["Home"];
  const segments = filePath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return ["Home"];
  if (segments[0] !== "Home" && segments[0] !== "Private Vault") {
    return ["Home", ...segments];
  }
  return segments;
};

/**
 * Returns trash summary info and empty state.
 */
export const getTrashSummary = (trashCount = 0, trashBytes = 0) => {
  const count = Math.max(0, Number(trashCount) || 0);
  const bytes = Math.max(0, Number(trashBytes) || 0);
  const isEmpty = count === 0 && bytes === 0;
  return {
    count,
    bytes,
    isEmpty,
  };
};

