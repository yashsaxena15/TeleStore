import { useEffect } from "react";
import { toast } from "sonner";
import { ARROW_KEYS, calculateNextIndex, canRenameItem, computeRangeSelection, isButtonOrLink, isInputOrModalActive, isInsideFileGrid } from "../lib/fileKeyboardNavigation";
import { getItemKey } from "../lib/fileCardHelpers";

/**
 * Keyboard shortcuts for the file grid: Escape clears the selection, Ctrl/Cmd+A selects all,
 * Alt+Enter opens Details, I toggles the details pane, arrows move, Space selects, Enter opens,
 * F2 renames, Delete deletes, Ctrl/Cmd+C/X/V copy, cut and paste.
 * Everything it needs is read from `stateRef.current` at key-press time; the setters are React's
 * (stable), so the listener is added once.
 */
export function useGridKeyboard(stateRef, { setBatchDeleteDialogOpen, setContextMenu, setFocusedIndex, setIsSelectionMode, setLastSelectedIndex, setSelectedItems }) {
    useEffect(() => {
        const handleKeyDown = (e) => {
            const s = stateRef.current;
            const target = e.target;

            // 1. Guard against firing while typing in inputs, textareas, selects, editable elements,
            // open dialogs (Radix modals), or when user is navigating the sidebar/header.
            const isModalActive = Boolean(
                s.movePickerOpen ||
                s.batchDeleteDialogOpen ||
                s.imageViewer ||
                s.documentReader ||
                s.archiveInspect ||
                s.compressDialog ||
                s.showTelegramVerificationDialog ||
                s.showIndexChatDialog ||
                s.renamingItem ||
                (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]'))
            );

            if (isInputOrModalActive({ target, isModalOpen: isModalActive })) {
                return;
            }

            // Guard against shortcuts firing when focus is outside the file grid
            if (!isInsideFileGrid(target)) {
                return;
            }

            // Guard against Space / Enter hijacking native button or link actions
            if (isButtonOrLink(target) && (e.key === " " || e.code === "Space" || e.key === "Enter")) {
                return;
            }

            // 2. Escape: clear selection, cancel selection mode, close context menu
            if (e.key === "Escape") {
                if (s.selectedItems && s.selectedItems.size > 0) {
                    e.preventDefault();
                    setSelectedItems(new Set());
                    setLastSelectedIndex(null);
                    setIsSelectionMode(false);
                }
                if (s.contextMenu) {
                    setContextMenu(null);
                }
                return;
            }

            // If there are no items to interact with, ignore remaining shortcuts
            if (!s.items || s.items.length === 0) {
                return;
            }

            // 3. Arrow Keys / Home / End / PageUp / PageDown Navigation
            if (ARROW_KEYS.has(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();

                const cols = s.getGridColumns ? s.getGridColumns() : 1;
                const nextIdx = calculateNextIndex({
                    currentIndex: s.focusedIndex,
                    totalItems: s.items.length,
                    key: e.key,
                    viewMode: s.viewMode,
                    cols,
                });

                if (e.shiftKey) {
                    // Range selection with Shift + Arrow
                    const anchor = s.lastSelectedIndex !== null ? s.lastSelectedIndex : (s.focusedIndex ?? 0);
                    if (s.lastSelectedIndex === null) {
                        setLastSelectedIndex(anchor);
                    }
                    const range = computeRangeSelection({
                        anchorIndex: anchor,
                        targetIndex: nextIdx,
                        items: s.items,
                        getItemKey,
                    });
                    setSelectedItems(range);
                    setIsSelectionMode(true);
                    setFocusedIndex(nextIdx);
                } else {
                    // Arrow navigation without Shift
                    setFocusedIndex(nextIdx);
                    if (!s.isSelectionMode) {
                        setLastSelectedIndex(nextIdx);
                        if (s.selectedItems && s.selectedItems.size === 1) {
                            const targetItem = s.items[nextIdx];
                            if (targetItem) {
                                setSelectedItems(new Set([getItemKey(targetItem)]));
                            }
                        }
                    }
                }
                return;
            }

            // 4. Space: Toggle item selection for focused item
            if (e.key === " " || e.code === "Space") {
                if (s.focusedIndex !== null && s.items[s.focusedIndex]) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation?.();

                    const item = s.items[s.focusedIndex];
                    const itemKey = getItemKey(item);
                    const nextSelected = new Set(s.selectedItems || []);
                    if (nextSelected.has(itemKey)) {
                        nextSelected.delete(itemKey);
                        if (nextSelected.size === 0) {
                            setIsSelectionMode(false);
                        }
                    } else {
                        nextSelected.add(itemKey);
                        setIsSelectionMode(true);
                    }
                    setSelectedItems(nextSelected);
                    setLastSelectedIndex(s.focusedIndex);
                }
                return;
            }

            // 5. Enter: Open item (folder navigation or preview)
            if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey) {
                let targetItem = null;
                if (s.focusedIndex !== null && s.items[s.focusedIndex]) {
                    targetItem = s.items[s.focusedIndex];
                } else if (s.selectedItems && s.selectedItems.size === 1) {
                    const selKey = Array.from(s.selectedItems)[0];
                    targetItem = s.items.find(i => getItemKey(i) === selKey);
                }
                if (targetItem && s.handleItemOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    s.handleItemOpen(targetItem);
                }
                return;
            }

            // 6. F2: Safe Rename flow
            if (e.key === "F2") {
                e.preventDefault();
                e.stopPropagation();
                let targetItem = null;
                let targetIndex = null;
                if (s.selectedItems && s.selectedItems.size === 1) {
                    const selKey = Array.from(s.selectedItems)[0];
                    targetIndex = s.items.findIndex(i => getItemKey(i) === selKey);
                    if (targetIndex !== -1) {
                        targetItem = s.items[targetIndex];
                    }
                } else if (s.focusedIndex !== null && s.items[s.focusedIndex]) {
                    targetItem = s.items[s.focusedIndex];
                    targetIndex = s.focusedIndex;
                }

                if (targetItem && targetIndex !== null && s.onRename) {
                    const check = canRenameItem({
                        item: targetItem,
                        isTrashMode: s.isTrashMode,
                        isEffectiveInboxMode: s.isEffectiveInboxMode,
                        isCloudVirtualSection: s.isCloudVirtualSection,
                        currentFolder: s.currentFolder,
                        currentApiPath: s.currentApiPath,
                        currentPath: s.currentPath,
                    });
                    if (!check.allowed) {
                        toast.error(check.reason);
                        return;
                    }
                    s.onRename(targetItem, targetIndex);
                }
                return;
            }

            // 7. Delete / Cmd+Backspace: Safe Delete flow (NEVER bypasses confirmation)
            if (e.key === "Delete" || ((e.metaKey || e.ctrlKey) && e.key === "Backspace")) {
                e.preventDefault();
                e.stopPropagation();
                if (s.selectedItems && s.selectedItems.size > 0) {
                    // Refuses (with a message) when the selection holds protected items
                    if (s.requestBatchDelete) s.requestBatchDelete();
                    else setBatchDeleteDialogOpen(true);
                } else if (s.focusedIndex !== null && s.items[s.focusedIndex]) {
                    const item = s.items[s.focusedIndex];
                    if (s.onDelete) {
                        s.onDelete(item, s.focusedIndex);
                    }
                }
                return;
            }

            // 8. Alt+Enter: show the item in the details pane
            if (e.altKey && e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                let targetItem = null;
                if (s.selectedItems && s.selectedItems.size === 1) {
                    const selKey = Array.from(s.selectedItems)[0];
                    targetItem = s.items.find(i => getItemKey(i) === selKey);
                } else if (s.focusedIndex !== null && s.items[s.focusedIndex]) {
                    targetItem = s.items[s.focusedIndex];
                }
                if (targetItem) {
                    s.openDetails(targetItem);
                }
                return;
            }

            // 8b. "i": show or hide the details pane
            if (e.key.toLowerCase() === "i" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                s.onDetailsOpenChange?.(!s.detailsOpen);
                return;
            }

            // 9. Ctrl/Cmd + A: Select All
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
                e.preventDefault();
                e.stopPropagation();
                const allKeys = s.items.map(getItemKey);
                setSelectedItems(new Set(allKeys));
                setIsSelectionMode(true);
                return;
            }

            // 10. Ctrl/Cmd + C: Copy
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
                if (s.selectedItems && s.selectedItems.size > 0 && s.onCopy) {
                    e.preventDefault();
                    e.stopPropagation();
                    const selectedList = s.items.filter(it => s.selectedItems.has(getItemKey(it)));
                    if (selectedList.length > 0) s.onCopy(selectedList);
                } else if (s.focusedIndex !== null && s.items[s.focusedIndex] && s.onCopy) {
                    e.preventDefault();
                    e.stopPropagation();
                    s.onCopy([s.items[s.focusedIndex]]);
                }
                return;
            }

            // 11. Ctrl/Cmd + X: Cut
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
                if (s.selectedItems && s.selectedItems.size > 0 && s.onCut) {
                    e.preventDefault();
                    e.stopPropagation();
                    const selectedList = s.items.filter(it => s.selectedItems.has(getItemKey(it)));
                    if (selectedList.length > 0) s.onCut(selectedList);
                } else if (s.focusedIndex !== null && s.items[s.focusedIndex] && s.onCut) {
                    e.preventDefault();
                    e.stopPropagation();
                    s.onCut([s.items[s.focusedIndex]]);
                }
                return;
            }

            // 12. Ctrl/Cmd + V: Paste
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
                if (s.hasClipboard && s.hasClipboard() && s.onPaste) {
                    e.preventDefault();
                    e.stopPropagation();
                    s.onPaste();
                }
                return;
            }
        };
        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state comes from stateRef; setters are stable
    }, []);
}
