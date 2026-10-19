import { describe, it, expect } from 'vitest';
import {
  calculateNextIndex,
  computeRangeSelection,
  isInputOrModalActive,
  isInsideFileGrid,
  isButtonOrLink,
  isSystemProtectedFolder,
  canRenameItem,
  ARROW_KEYS
} from './fileKeyboardNavigation.js';

describe('File Keyboard Navigation and Safety Guards', () => {
  it('navigates grid mode with arrow, Home, and End keys', () => {
    const cols = 4;
    const total = 10;

    expect(calculateNextIndex({ currentIndex: 0, totalItems: total, key: "ArrowRight", viewMode: "grid", cols })).toBe(1);
    expect(calculateNextIndex({ currentIndex: 1, totalItems: total, key: "ArrowLeft", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: 0, totalItems: total, key: "ArrowLeft", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: 1, totalItems: total, key: "ArrowDown", viewMode: "grid", cols })).toBe(5);
    expect(calculateNextIndex({ currentIndex: 8, totalItems: total, key: "ArrowDown", viewMode: "grid", cols })).toBe(9);
    expect(calculateNextIndex({ currentIndex: 5, totalItems: total, key: "ArrowUp", viewMode: "grid", cols })).toBe(1);
    expect(calculateNextIndex({ currentIndex: 2, totalItems: total, key: "ArrowUp", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: 5, totalItems: total, key: "Home", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: 5, totalItems: total, key: "End", viewMode: "grid", cols })).toBe(9);
  });

  it('handles edge cases and uninitialized navigation', () => {
    const cols = 2;
    expect(calculateNextIndex({ currentIndex: null, totalItems: 0, key: "ArrowDown", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: 5, totalItems: 0, key: "ArrowUp", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowDown", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowRight", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowUp", viewMode: "grid", cols })).toBe(4);
    expect(calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowLeft", viewMode: "grid", cols })).toBe(4);
    expect(calculateNextIndex({ currentIndex: null, totalItems: 5, key: "End", viewMode: "grid", cols })).toBe(4);
    expect(calculateNextIndex({ currentIndex: 999, totalItems: 5, key: "ArrowRight", viewMode: "grid", cols })).toBe(4);
    expect(calculateNextIndex({ currentIndex: -50, totalItems: 5, key: "ArrowLeft", viewMode: "grid", cols })).toBe(0);
    expect(calculateNextIndex({ currentIndex: 2, totalItems: 5, key: "Tab", viewMode: "grid", cols })).toBe(2);
  });

  it('handles list mode and page navigation (PageUp / PageDown)', () => {
    const total = 10;
    expect(calculateNextIndex({ currentIndex: 3, totalItems: total, key: "ArrowDown", viewMode: "list", cols: 1 })).toBe(4);
    expect(calculateNextIndex({ currentIndex: 3, totalItems: total, key: "ArrowUp", viewMode: "list", cols: 1 })).toBe(2);
    expect(calculateNextIndex({ currentIndex: 0, totalItems: 25, key: "PageDown", viewMode: "list", cols: 1 })).toBe(8);
    expect(calculateNextIndex({ currentIndex: 20, totalItems: 25, key: "PageDown", viewMode: "list", cols: 1 })).toBe(24);
    expect(calculateNextIndex({ currentIndex: 15, totalItems: 25, key: "PageUp", viewMode: "list", cols: 1 })).toBe(7);
    expect(calculateNextIndex({ currentIndex: 5, totalItems: 25, key: "PageUp", viewMode: "list", cols: 1 })).toBe(0);
    expect(calculateNextIndex({ currentIndex: 2, totalItems: 30, key: "PageDown", viewMode: "grid", cols: 4 })).toBe(18);
    expect(calculateNextIndex({ currentIndex: 25, totalItems: 30, key: "PageUp", viewMode: "grid", cols: 4 })).toBe(9);
  });

  it('handles range selection and repeated shift-navigation stability', () => {
    const mockItems = [
      { id: "f0", name: "file0.txt" },
      { id: "f1", name: "file1.txt" },
      { id: "f2", name: "file2.txt" },
      { id: "f3", name: "file3.txt" },
      { id: "f4", name: "file4.txt" },
    ];
    const getKey = (it) => it.id;

    const emptyRange = computeRangeSelection({
      anchorIndex: 0,
      targetIndex: 2,
      items: [],
      getItemKey: getKey
    });
    expect(emptyRange.size).toBe(0);

    const rangeForward = computeRangeSelection({
      anchorIndex: 1,
      targetIndex: 3,
      items: mockItems,
      getItemKey: getKey
    });
    expect(rangeForward.size).toBe(3);
    expect(rangeForward.has("f1") && rangeForward.has("f2") && rangeForward.has("f3")).toBe(true);

    const rangeBackward = computeRangeSelection({
      anchorIndex: 3,
      targetIndex: 1,
      items: mockItems,
      getItemKey: getKey
    });
    expect(rangeBackward.size).toBe(3);
    expect(rangeBackward.has("f1") && rangeBackward.has("f2") && rangeBackward.has("f3")).toBe(true);

    const step1 = computeRangeSelection({
      anchorIndex: 2,
      targetIndex: 3,
      items: mockItems,
      getItemKey: getKey
    });
    expect(step1.size).toBe(2);
    expect(step1.has("f2") && step1.has("f3") && !step1.has("f1")).toBe(true);

    const step2 = computeRangeSelection({
      anchorIndex: 2,
      targetIndex: 4,
      items: mockItems,
      getItemKey: getKey
    });
    expect(step2.size).toBe(3);
    expect(step2.has("f2") && step2.has("f3") && step2.has("f4") && !step2.has("f1")).toBe(true);

    const step3 = computeRangeSelection({
      anchorIndex: 2,
      targetIndex: 0,
      items: mockItems,
      getItemKey: getKey
    });
    expect(step3.size).toBe(3);
    expect(step3.has("f0") && step3.has("f1") && step3.has("f2") && !step3.has("f3")).toBe(true);
  });

  it('guards against active inputs, textareas, dialogs, and landmarks', () => {
    const mockInput = { tagName: "INPUT", isContentEditable: false, closest: () => null };
    expect(isInputOrModalActive({ target: mockInput, isModalOpen: false })).toBe(true);

    const mockTextarea = { tagName: "TEXTAREA", isContentEditable: false, closest: () => null };
    expect(isInputOrModalActive({ target: mockTextarea, isModalOpen: false })).toBe(true);

    const mockSelect = { tagName: "SELECT", isContentEditable: false, closest: () => null };
    expect(isInputOrModalActive({ target: mockSelect, isModalOpen: false })).toBe(true);

    const mockContentEditable = { tagName: "DIV", isContentEditable: true, closest: () => null };
    expect(isInputOrModalActive({ target: mockContentEditable, isModalOpen: false })).toBe(true);

    const mockInsideDialog = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (sel) => sel.includes('[role="dialog"]') ? {} : null
    };
    expect(isInputOrModalActive({ target: mockInsideDialog, isModalOpen: false })).toBe(true);

    const mockInsideSidebar = {
      tagName: "A",
      isContentEditable: false,
      closest: (sel) => sel.includes('aside') ? {} : null
    };
    expect(isInputOrModalActive({ target: mockInsideSidebar, isModalOpen: false })).toBe(true);

    const mockGridItem = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (sel) => sel.includes('[data-grid-item]') ? {} : null
    };
    expect(isInputOrModalActive({ target: mockGridItem, isModalOpen: false })).toBe(false);
    expect(isInputOrModalActive({ target: mockGridItem, isModalOpen: true })).toBe(true);
  });

  it('guards container scope with isInsideFileGrid', () => {
    expect(isInsideFileGrid(null)).toBe(false);

    const mockOutsideElement = { tagName: "DIV", closest: () => null };
    expect(isInsideFileGrid(mockOutsideElement)).toBe(false);

    const mockGridItemElement = {
      tagName: "DIV",
      closest: (sel) => sel.includes('[data-grid-item]') ? {} : null
    };
    expect(isInsideFileGrid(mockGridItemElement)).toBe(true);

    const mockGridBgElement = {
      tagName: "DIV",
      closest: (sel) => sel.includes('[data-grid-background]') ? {} : null
    };
    expect(isInsideFileGrid(mockGridBgElement)).toBe(true);

    const mockDragContainer = {
      tagName: "DIV",
      closest: (sel) => sel.includes('[data-drag-container]') ? {} : null
    };
    expect(isInsideFileGrid(mockDragContainer)).toBe(true);
  });

  it('guards button and link activation with isButtonOrLink', () => {
    expect(isButtonOrLink(null)).toBe(false);

    const mockNormalDiv = { tagName: "DIV", closest: () => null };
    expect(isButtonOrLink(mockNormalDiv)).toBe(false);

    const mockButton = {
      tagName: "BUTTON",
      closest: (sel) => sel.includes('button') ? {} : null
    };
    expect(isButtonOrLink(mockButton)).toBe(true);

    const mockIconInsideButton = {
      tagName: "SVG",
      closest: (sel) => sel.includes('button') ? {} : null
    };
    expect(isButtonOrLink(mockIconInsideButton)).toBe(true);

    const mockLink = {
      tagName: "A",
      closest: (sel) => sel.includes('a') ? {} : null
    };
    expect(isButtonOrLink(mockLink)).toBe(true);
  });

  it('protects root system folders', () => {
    const rootHome = ["Home"];
    const subHome = ["Home", "Documents"];

    expect(isSystemProtectedFolder({ name: "Documents" }, rootHome)).toBe(true);
    expect(isSystemProtectedFolder({ name: "Images" }, rootHome)).toBe(true);
    expect(isSystemProtectedFolder({ name: "Videos" }, rootHome)).toBe(true);
    expect(isSystemProtectedFolder({ name: "Audio" }, rootHome)).toBe(true);
    expect(isSystemProtectedFolder({ name: "Voice Messages" }, rootHome)).toBe(true);
    expect(isSystemProtectedFolder({ name: "CustomFolder" }, rootHome)).toBe(false);
    expect(isSystemProtectedFolder({ name: "Documents" }, subHome)).toBe(false);
  });

  it('enforces rename permission safety rules', () => {
    const userFolder = { id: "123", name: "My Project", type: "folder" };
    const systemFolder = { id: "sys1", name: "Videos", type: "folder" };

    expect(canRenameItem({ item: null }).allowed).toBe(false);

    const normalCheck = canRenameItem({
      item: userFolder,
      isTrashMode: false,
      isEffectiveInboxMode: false,
      isCloudVirtualSection: false,
      currentFolder: "My Folder",
      currentApiPath: "/My Folder",
      currentPath: ["Home", "My Folder"]
    });
    expect(normalCheck.allowed).toBe(true);

    const trashCheck = canRenameItem({
      item: userFolder,
      isTrashMode: true,
      isEffectiveInboxMode: false,
      isCloudVirtualSection: false,
      currentFolder: "Trash",
      currentApiPath: "/trash",
      currentPath: ["Home", "Trash"]
    });
    expect(trashCheck.allowed).toBe(false);
    expect(trashCheck.reason).toContain("Trash");

    const inboxCheck = canRenameItem({
      item: userFolder,
      isTrashMode: false,
      isEffectiveInboxMode: true,
      isCloudVirtualSection: false,
      currentFolder: "Telegram Inbox",
      currentApiPath: "/inbox",
      currentPath: ["Telegram Inbox"]
    });
    expect(inboxCheck.allowed).toBe(false);
    expect(inboxCheck.reason).toContain("Telegram Inbox");

    const starredCheck1 = canRenameItem({ item: userFolder, currentFolder: "Starred" });
    expect(starredCheck1.allowed).toBe(false);
    expect(starredCheck1.reason).toContain("Starred");

    const starredCheck2 = canRenameItem({ item: userFolder, currentApiPath: "/starred" });
    expect(starredCheck2.allowed).toBe(false);
    expect(starredCheck2.reason).toContain("Starred");

    const virtualSectionCheck = canRenameItem({ item: userFolder, isCloudVirtualSection: true });
    expect(virtualSectionCheck.allowed).toBe(false);
    expect(virtualSectionCheck.reason).toContain("virtual section");

    const systemCheck = canRenameItem({
      item: systemFolder,
      isTrashMode: false,
      isEffectiveInboxMode: false,
      isCloudVirtualSection: false,
      currentFolder: "Home",
      currentApiPath: "/Home",
      currentPath: ["Home"]
    });
    expect(systemCheck.allowed).toBe(false);
    expect(systemCheck.reason).toContain("system folders");
  });
});
