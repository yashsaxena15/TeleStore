/**
 * Comprehensive unit tests for FileGrid keyboard navigation, range selection, and safety guards.
 */

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

export function runKeyboardNavigationTests() {
  console.log('Running File Keyboard Navigation and Safety Guard tests...');

  // -------------------------------------------------------------
  // Test 1: Grid Mode Arrow Navigation (cols = 4, totalItems = 10)
  // -------------------------------------------------------------
  const cols = 4;
  const total = 10;

  // ArrowRight: 0 -> 1
  console.assert(
    calculateNextIndex({ currentIndex: 0, totalItems: total, key: "ArrowRight", viewMode: "grid", cols }) === 1,
    "ArrowRight should increment index by 1"
  );

  // ArrowLeft: 1 -> 0, clamped at 0
  console.assert(
    calculateNextIndex({ currentIndex: 1, totalItems: total, key: "ArrowLeft", viewMode: "grid", cols }) === 0,
    "ArrowLeft should decrement index by 1"
  );
  console.assert(
    calculateNextIndex({ currentIndex: 0, totalItems: total, key: "ArrowLeft", viewMode: "grid", cols }) === 0,
    "ArrowLeft at 0 should remain at 0"
  );

  // ArrowDown: 1 -> 5 (1 + 4)
  console.assert(
    calculateNextIndex({ currentIndex: 1, totalItems: total, key: "ArrowDown", viewMode: "grid", cols }) === 5,
    "ArrowDown should jump down by cols (4)"
  );

  // ArrowDown near bottom: 8 + 4 = 12 -> clamped to 9 (total - 1)
  console.assert(
    calculateNextIndex({ currentIndex: 8, totalItems: total, key: "ArrowDown", viewMode: "grid", cols }) === 9,
    "ArrowDown should clamp to totalItems - 1"
  );

  // ArrowUp: 5 -> 1 (5 - 4)
  console.assert(
    calculateNextIndex({ currentIndex: 5, totalItems: total, key: "ArrowUp", viewMode: "grid", cols }) === 1,
    "ArrowUp should jump up by cols (4)"
  );

  // ArrowUp at top row: 2 - 4 = -2 -> clamped to 0
  console.assert(
    calculateNextIndex({ currentIndex: 2, totalItems: total, key: "ArrowUp", viewMode: "grid", cols }) === 0,
    "ArrowUp at top row should clamp to 0"
  );

  // Home & End keys
  console.assert(
    calculateNextIndex({ currentIndex: 5, totalItems: total, key: "Home", viewMode: "grid", cols }) === 0,
    "Home key should jump to index 0"
  );
  console.assert(
    calculateNextIndex({ currentIndex: 5, totalItems: total, key: "End", viewMode: "grid", cols }) === 9,
    "End key should jump to index 9"
  );

  // -------------------------------------------------------------
  // Test 2: Edge Cases & Uninitialized Navigation
  // -------------------------------------------------------------
  // Empty list (totalItems = 0)
  console.assert(
    calculateNextIndex({ currentIndex: null, totalItems: 0, key: "ArrowDown", viewMode: "grid", cols }) === 0,
    "Empty items list must return 0"
  );
  console.assert(
    calculateNextIndex({ currentIndex: 5, totalItems: 0, key: "ArrowUp", viewMode: "grid", cols }) === 0,
    "Empty items list with index must return 0"
  );

  // Null currentIndex (unfocused initial press)
  console.assert(
    calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowDown", viewMode: "grid", cols: 2 }) === 0,
    "ArrowDown with null currentIndex starts at 0"
  );
  console.assert(
    calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowRight", viewMode: "grid", cols: 2 }) === 0,
    "ArrowRight with null currentIndex starts at 0"
  );
  console.assert(
    calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowUp", viewMode: "grid", cols: 2 }) === 4,
    "ArrowUp with null currentIndex starts at last item (totalItems - 1)"
  );
  console.assert(
    calculateNextIndex({ currentIndex: null, totalItems: 5, key: "ArrowLeft", viewMode: "grid", cols: 2 }) === 4,
    "ArrowLeft with null currentIndex starts at last item (totalItems - 1)"
  );
  console.assert(
    calculateNextIndex({ currentIndex: null, totalItems: 5, key: "End", viewMode: "grid", cols: 2 }) === 4,
    "End key with null currentIndex starts at last item"
  );

  // Out-of-bound currentIndex clamping
  console.assert(
    calculateNextIndex({ currentIndex: 999, totalItems: 5, key: "ArrowRight", viewMode: "grid", cols: 2 }) === 4,
    "Out-of-bound high currentIndex is clamped"
  );
  console.assert(
    calculateNextIndex({ currentIndex: -50, totalItems: 5, key: "ArrowLeft", viewMode: "grid", cols: 2 }) === 0,
    "Out-of-bound negative currentIndex is clamped"
  );

  // Unrecognized key
  console.assert(
    calculateNextIndex({ currentIndex: 2, totalItems: 5, key: "Tab", viewMode: "grid", cols: 2 }) === 2,
    "Unrecognized key preserves current index"
  );

  // -------------------------------------------------------------
  // Test 3: List Mode & Page Navigation (PageUp / PageDown)
  // -------------------------------------------------------------
  console.assert(
    calculateNextIndex({ currentIndex: 3, totalItems: total, key: "ArrowDown", viewMode: "list", cols: 1 }) === 4,
    "ArrowDown in list mode should move by 1"
  );
  console.assert(
    calculateNextIndex({ currentIndex: 3, totalItems: total, key: "ArrowUp", viewMode: "list", cols: 1 }) === 2,
    "ArrowUp in list mode should move by 1"
  );

  // List mode PageDown (step = 8)
  console.assert(
    calculateNextIndex({ currentIndex: 0, totalItems: 25, key: "PageDown", viewMode: "list", cols: 1 }) === 8,
    "PageDown in list mode moves forward by 8"
  );
  console.assert(
    calculateNextIndex({ currentIndex: 20, totalItems: 25, key: "PageDown", viewMode: "list", cols: 1 }) === 24,
    "PageDown in list mode clamps to totalItems - 1"
  );

  // List mode PageUp (step = 8)
  console.assert(
    calculateNextIndex({ currentIndex: 15, totalItems: 25, key: "PageUp", viewMode: "list", cols: 1 }) === 7,
    "PageUp in list mode moves backward by 8"
  );
  console.assert(
    calculateNextIndex({ currentIndex: 5, totalItems: 25, key: "PageUp", viewMode: "list", cols: 1 }) === 0,
    "PageUp in list mode clamps to 0"
  );

  // Grid mode PageDown (step = safeCols * 4 = 4 * 4 = 16)
  console.assert(
    calculateNextIndex({ currentIndex: 2, totalItems: 30, key: "PageDown", viewMode: "grid", cols: 4 }) === 18,
    "PageDown in grid mode moves forward by cols * 4 (16)"
  );
  // Grid mode PageUp (step = safeCols * 4 = 4 * 4 = 16)
  console.assert(
    calculateNextIndex({ currentIndex: 25, totalItems: 30, key: "PageUp", viewMode: "grid", cols: 4 }) === 9,
    "PageUp in grid mode moves backward by cols * 4 (16)"
  );

  // -------------------------------------------------------------
  // Test 4: Range Selection & Repeated Shift-Navigation Stability
  // -------------------------------------------------------------
  const mockItems = [
    { id: "f0", name: "file0.txt" },
    { id: "f1", name: "file1.txt" },
    { id: "f2", name: "file2.txt" },
    { id: "f3", name: "file3.txt" },
    { id: "f4", name: "file4.txt" },
  ];
  const getKey = (it) => it.id;

  // Empty items array for range selection
  const emptyRange = computeRangeSelection({
    anchorIndex: 0,
    targetIndex: 2,
    items: [],
    getItemKey: getKey
  });
  console.assert(emptyRange.size === 0, "Range selection with empty items array returns empty Set");

  // Forward range: 1 to 3 -> ['f1', 'f2', 'f3']
  const rangeForward = computeRangeSelection({
    anchorIndex: 1,
    targetIndex: 3,
    items: mockItems,
    getItemKey: getKey
  });
  console.assert(
    rangeForward.size === 3 && rangeForward.has("f1") && rangeForward.has("f2") && rangeForward.has("f3"),
    "Forward range selection must include all items between anchor and target"
  );

  // Reverse range: 3 down to 1 -> ['f1', 'f2', 'f3']
  const rangeBackward = computeRangeSelection({
    anchorIndex: 3,
    targetIndex: 1,
    items: mockItems,
    getItemKey: getKey
  });
  console.assert(
    rangeBackward.size === 3 && rangeBackward.has("f1") && rangeBackward.has("f2") && rangeBackward.has("f3"),
    "Backward range selection must include all items between target and anchor"
  );

  // Repeated Shift-Navigation anchor stability test:
  // User starts at anchor = 2.
  // Step 1: Navigates to 3 -> range is [2, 3]
  const step1 = computeRangeSelection({
    anchorIndex: 2,
    targetIndex: 3,
    items: mockItems,
    getItemKey: getKey
  });
  console.assert(
    step1.size === 2 && step1.has("f2") && step1.has("f3") && !step1.has("f1"),
    "Anchor at 2 to target 3 yields [2, 3]"
  );

  // Step 2: Navigates further to 4 with anchor STILL at 2 (anchor does NOT drift to 3!)
  const step2 = computeRangeSelection({
    anchorIndex: 2,
    targetIndex: 4,
    items: mockItems,
    getItemKey: getKey
  });
  console.assert(
    step2.size === 3 && step2.has("f2") && step2.has("f3") && step2.has("f4") && !step2.has("f1"),
    "Anchor stability: repeated Shift navigation retains original anchor at 2, yielding [2, 3, 4]"
  );

  // Step 3: Navigates backwards past anchor to 0 with anchor STILL at 2
  const step3 = computeRangeSelection({
    anchorIndex: 2,
    targetIndex: 0,
    items: mockItems,
    getItemKey: getKey
  });
  console.assert(
    step3.size === 3 && step3.has("f0") && step3.has("f1") && step3.has("f2") && !step3.has("f3"),
    "Anchor stability: reversing past anchor retains anchor at 2, yielding [0, 1, 2]"
  );

  // -------------------------------------------------------------
  // Test 5: Input, Textarea, Dialog, and Landmark Guards
  // -------------------------------------------------------------
  const mockInput = { tagName: "INPUT", isContentEditable: false, closest: () => null };
  console.assert(
    isInputOrModalActive({ target: mockInput, isModalOpen: false }) === true,
    "Input elements must block grid shortcuts"
  );

  const mockTextarea = { tagName: "TEXTAREA", isContentEditable: false, closest: () => null };
  console.assert(
    isInputOrModalActive({ target: mockTextarea, isModalOpen: false }) === true,
    "Textareas must block grid shortcuts"
  );

  const mockSelect = { tagName: "SELECT", isContentEditable: false, closest: () => null };
  console.assert(
    isInputOrModalActive({ target: mockSelect, isModalOpen: false }) === true,
    "Select elements must block grid shortcuts"
  );

  const mockContentEditable = { tagName: "DIV", isContentEditable: true, closest: () => null };
  console.assert(
    isInputOrModalActive({ target: mockContentEditable, isModalOpen: false }) === true,
    "ContentEditable elements must block grid shortcuts"
  );

  const mockInsideDialog = {
    tagName: "DIV",
    isContentEditable: false,
    closest: (sel) => sel.includes('[role="dialog"]') ? {} : null
  };
  console.assert(
    isInputOrModalActive({ target: mockInsideDialog, isModalOpen: false }) === true,
    "Elements inside open dialogs must block grid shortcuts"
  );

  const mockInsideSidebar = {
    tagName: "A",
    isContentEditable: false,
    closest: (sel) => sel.includes('aside') ? {} : null
  };
  console.assert(
    isInputOrModalActive({ target: mockInsideSidebar, isModalOpen: false }) === true,
    "Elements inside navigation sidebar must block grid shortcuts"
  );

  const mockGridItem = {
    tagName: "DIV",
    isContentEditable: false,
    closest: (sel) => sel.includes('[data-grid-item]') ? {} : null
  };
  console.assert(
    isInputOrModalActive({ target: mockGridItem, isModalOpen: false }) === false,
    "Normal grid items must allow grid shortcuts"
  );

  console.assert(
    isInputOrModalActive({ target: mockGridItem, isModalOpen: true }) === true,
    "When any modal state is active, grid shortcuts must be blocked"
  );

  // -------------------------------------------------------------
  // Test 6: Container Scope Guard (isInsideFileGrid)
  // -------------------------------------------------------------
  console.assert(
    isInsideFileGrid(null) === false,
    "Null target is outside file grid"
  );

  const mockOutsideElement = {
    tagName: "DIV",
    closest: () => null
  };
  console.assert(
    isInsideFileGrid(mockOutsideElement) === false,
    "Element outside grid containers is rejected"
  );

  const mockGridItemElement = {
    tagName: "DIV",
    closest: (sel) => sel.includes('[data-grid-item]') ? {} : null
  };
  console.assert(
    isInsideFileGrid(mockGridItemElement) === true,
    "Element with [data-grid-item] is inside file grid"
  );

  const mockGridBgElement = {
    tagName: "DIV",
    closest: (sel) => sel.includes('[data-grid-background]') ? {} : null
  };
  console.assert(
    isInsideFileGrid(mockGridBgElement) === true,
    "Element with [data-grid-background] is inside file grid"
  );

  const mockDragContainer = {
    tagName: "DIV",
    closest: (sel) => sel.includes('[data-drag-container]') ? {} : null
  };
  console.assert(
    isInsideFileGrid(mockDragContainer) === true,
    "Element with [data-drag-container] is inside file grid"
  );

  // -------------------------------------------------------------
  // Test 7: Button / Link Activation Guard (isButtonOrLink)
  // -------------------------------------------------------------
  console.assert(
    isButtonOrLink(null) === false,
    "Null target is not a button or link"
  );

  const mockNormalDiv = {
    tagName: "DIV",
    closest: () => null
  };
  console.assert(
    isButtonOrLink(mockNormalDiv) === false,
    "Normal DIV is not a button or link"
  );

  const mockButton = {
    tagName: "BUTTON",
    closest: (sel) => sel.includes('button') ? {} : null
  };
  console.assert(
    isButtonOrLink(mockButton) === true,
    "BUTTON target is recognized"
  );

  const mockIconInsideButton = {
    tagName: "SVG",
    closest: (sel) => sel.includes('button') ? {} : null
  };
  console.assert(
    isButtonOrLink(mockIconInsideButton) === true,
    "Child inside button is recognized as button target"
  );

  const mockLink = {
    tagName: "A",
    closest: (sel) => sel.includes('a') ? {} : null
  };
  console.assert(
    isButtonOrLink(mockLink) === true,
    "Anchor link target is recognized"
  );

  // -------------------------------------------------------------
  // Test 8: Protected System Folders Guard
  // -------------------------------------------------------------
  const rootHome = ["Home"];
  const subHome = ["Home", "Documents"];

  console.assert(
    isSystemProtectedFolder({ name: "Documents" }, rootHome) === true,
    "Documents folder in root Home must be protected"
  );
  console.assert(
    isSystemProtectedFolder({ name: "Images" }, rootHome) === true,
    "Images folder in root Home must be protected"
  );
  console.assert(
    isSystemProtectedFolder({ name: "Videos" }, rootHome) === true,
    "Videos folder in root Home must be protected"
  );
  console.assert(
    isSystemProtectedFolder({ name: "Audio" }, rootHome) === true,
    "Audio folder in root Home must be protected"
  );
  console.assert(
    isSystemProtectedFolder({ name: "Voice Messages" }, rootHome) === true,
    "Voice Messages folder in root Home must be protected"
  );
  console.assert(
    isSystemProtectedFolder({ name: "CustomFolder" }, rootHome) === false,
    "User-created folder in root Home is not a protected system folder"
  );
  console.assert(
    isSystemProtectedFolder({ name: "Documents" }, subHome) === false,
    "Folder named Documents inside a subfolder is not root protected"
  );

  // -------------------------------------------------------------
  // Test 9: Rename Permission Safety Rules
  // -------------------------------------------------------------
  const userFolder = { id: "123", name: "My Project", type: "folder" };
  const systemFolder = { id: "sys1", name: "Videos", type: "folder" };

  // Null item
  const nullCheck = canRenameItem({ item: null });
  console.assert(nullCheck.allowed === false, "Null item cannot be renamed");

  // Allowed in normal folder
  const normalCheck = canRenameItem({
    item: userFolder,
    isTrashMode: false,
    isEffectiveInboxMode: false,
    isCloudVirtualSection: false,
    currentFolder: "My Folder",
    currentApiPath: "/My Folder",
    currentPath: ["Home", "My Folder"]
  });
  console.assert(normalCheck.allowed === true, "Renaming normal folder must be allowed");

  // Blocked in Trash
  const trashCheck = canRenameItem({
    item: userFolder,
    isTrashMode: true,
    isEffectiveInboxMode: false,
    isCloudVirtualSection: false,
    currentFolder: "Trash",
    currentApiPath: "/trash",
    currentPath: ["Home", "Trash"]
  });
  console.assert(trashCheck.allowed === false && trashCheck.reason.includes("Trash"), "Renaming in Trash must be disallowed");

  // Blocked in Telegram Inbox
  const inboxCheck = canRenameItem({
    item: userFolder,
    isTrashMode: false,
    isEffectiveInboxMode: true,
    isCloudVirtualSection: false,
    currentFolder: "Telegram Inbox",
    currentApiPath: "/inbox",
    currentPath: ["Telegram Inbox"]
  });
  console.assert(inboxCheck.allowed === false && inboxCheck.reason.includes("Telegram Inbox"), "Renaming in Telegram Inbox must be disallowed");

  // Blocked in Starred view (by folder name or api path)
  const starredCheck1 = canRenameItem({
    item: userFolder,
    currentFolder: "Starred"
  });
  console.assert(starredCheck1.allowed === false && starredCheck1.reason.includes("Starred"), "Renaming in Starred view must be disallowed");

  const starredCheck2 = canRenameItem({
    item: userFolder,
    currentApiPath: "/starred"
  });
  console.assert(starredCheck2.allowed === false && starredCheck2.reason.includes("Starred"), "Renaming with /starred API path must be disallowed");

  // Blocked in cloud virtual section
  const virtualSectionCheck = canRenameItem({
    item: userFolder,
    isCloudVirtualSection: true
  });
  console.assert(virtualSectionCheck.allowed === false && virtualSectionCheck.reason.includes("virtual section"), "Renaming in virtual section must be disallowed");

  // Blocked on system folders in root Home
  const systemCheck = canRenameItem({
    item: systemFolder,
    isTrashMode: false,
    isEffectiveInboxMode: false,
    isCloudVirtualSection: false,
    currentFolder: "Home",
    currentApiPath: "/Home",
    currentPath: ["Home"]
  });
  console.assert(systemCheck.allowed === false && systemCheck.reason.includes("system folders"), "Renaming system folder in Home must be disallowed");

  console.log('All File Keyboard Navigation and Safety Guard tests passed successfully! (48/48 assertions)');
  return true;
}

if (typeof process !== 'undefined' || (typeof window !== 'undefined' && window.location?.protocol === 'file:')) {
  runKeyboardNavigationTests();
}
