/**
 * Keyboard navigation, selection calculation, and safety guard helpers for FileGrid.
 */

export const ARROW_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown"
]);

/**
 * Calculates the next index based on keyboard input and grid dimensions.
 */
export function calculateNextIndex({
  currentIndex,
  totalItems,
  key,
  viewMode = "grid",
  cols = 1
}) {
  if (totalItems <= 0) return 0;
  const safeCols = Math.max(1, cols);

  if (currentIndex === null || currentIndex === undefined) {
    if (key === "ArrowUp" || key === "ArrowLeft" || key === "End") {
      return totalItems - 1;
    }
    return 0;
  }

  const clampedCurrent = Math.max(0, Math.min(totalItems - 1, currentIndex));

  switch (key) {
    case "ArrowRight":
      return Math.min(totalItems - 1, clampedCurrent + 1);

    case "ArrowLeft":
      return Math.max(0, clampedCurrent - 1);

    case "ArrowDown":
      if (viewMode === "list" || safeCols === 1) {
        return Math.min(totalItems - 1, clampedCurrent + 1);
      }
      return Math.min(totalItems - 1, clampedCurrent + safeCols);

    case "ArrowUp":
      if (viewMode === "list" || safeCols === 1) {
        return Math.max(0, clampedCurrent - 1);
      }
      return Math.max(0, clampedCurrent - safeCols);

    case "Home":
      return 0;

    case "End":
      return totalItems - 1;

    case "PageDown": {
      const step = viewMode === "list" || safeCols === 1 ? 8 : safeCols * 4;
      return Math.min(totalItems - 1, clampedCurrent + step);
    }

    case "PageUp": {
      const step = viewMode === "list" || safeCols === 1 ? 8 : safeCols * 4;
      return Math.max(0, clampedCurrent - step);
    }

    default:
      return clampedCurrent;
  }
}

/**
 * Computes range selection from an anchor index to target index.
 */
export function computeRangeSelection({
  anchorIndex,
  targetIndex,
  items,
  getItemKey
}) {
  if (!items || items.length === 0) return new Set();
  const safeAnchor = Math.max(0, Math.min(items.length - 1, anchorIndex ?? targetIndex ?? 0));
  const safeTarget = Math.max(0, Math.min(items.length - 1, targetIndex ?? 0));
  const start = Math.min(safeAnchor, safeTarget);
  const end = Math.max(safeAnchor, safeTarget);

  const selected = new Set();
  for (let i = start; i <= end; i++) {
    if (items[i]) {
      selected.add(getItemKey ? getItemKey(items[i]) : (items[i].id || items[i].name));
    }
  }
  return selected;
}

/**
 * Checks whether an event originated from an editable field, input, or open modal dialog.
 */
export function isInputOrModalActive({ target, isModalOpen = false }) {
  if (isModalOpen) return true;
  if (!target) return false;

  const tagName = target.tagName ? target.tagName.toUpperCase() : "";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (typeof target.closest === "function") {
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], aside, nav, [data-sidebar], header')) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether the event target is within the FileGrid container or body.
 */
export function isInsideFileGrid(target) {
  if (!target) return false;
  if (typeof document !== 'undefined' && (target === document.body || target === document.documentElement)) {
    return true;
  }
  if (typeof target.closest === "function") {
    return Boolean(target.closest('[data-drag-container], [data-grid-background], [data-grid-item]'));
  }
  return false;
}

/**
 * Checks whether the target is a button, link, or child of one.
 */
export function isButtonOrLink(target) {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest('button, a'));
}

/**
 * System folders in root Home that cannot be deleted or renamed.
 */
export const PROTECTED_SYSTEM_FOLDERS = new Set([
  "Images",
  "Documents",
  "Audio",
  "Voice Messages",
  "Videos"
]);

export function isSystemProtectedFolder(item, currentPath) {
  if (!item) return false;
  const isRootHome = Array.isArray(currentPath) && currentPath.length === 1 && currentPath[0] === "Home";
  return isRootHome && PROTECTED_SYSTEM_FOLDERS.has(item.name);
}

/**
 * Validates whether an item can be renamed in the current context.
 */
export function canRenameItem({
  item,
  isTrashMode,
  isEffectiveInboxMode,
  isCloudVirtualSection,
  currentFolder,
  currentApiPath,
  currentPath
}) {
  if (!item) return { allowed: false, reason: "No item specified" };
  if (isTrashMode) {
    return { allowed: false, reason: "Cannot rename items in Trash" };
  }
  if (isEffectiveInboxMode) {
    return { allowed: false, reason: "Cannot rename items in Telegram Inbox" };
  }
  if (isCloudVirtualSection) {
    return { allowed: false, reason: "Cannot rename items in virtual section" };
  }
  if (currentFolder === "Starred" || currentApiPath === "/starred") {
    return { allowed: false, reason: "Cannot rename items in Starred" };
  }
  if (isSystemProtectedFolder(item, currentPath)) {
    return { allowed: false, reason: "Cannot rename default system folders" };
  }
  return { allowed: true };
}
