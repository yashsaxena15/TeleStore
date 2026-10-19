import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { isVideoItem } from "./fileTypes";
import { copyStreamUrl } from "@/lib/utils";
import { Folder, MoreVertical, Check, X, Trash2, Download, Info, Star, RotateCcw, Scissors, Copy } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import { RenameInput } from "./RenameInput";
import { useMediaPlayer } from "@/features/player/MediaPlayerContext";
import { Thumbnail } from "./Thumbnail";
import { CompressDialog } from "@/features/archives/CompressDialog";
import { UploadProgressWidget } from "@/features/transfers/UploadProgressWidget";
import { uploadManager } from "@/features/transfers/uploadManager";
import { TelegramVerificationDialog } from "@/features/auth/TelegramVerificationDialog";
import { IndexChatDialog } from "@/features/explorer/dialogs/IndexChatDialog"; // Add this import
import { PropertiesDialog } from "@/features/explorer/dialogs/PropertiesDialog";
import { getApiBaseUrl, fetchWithTimeout, api } from "@/lib/api";
import { useBatchThumbnailLoader } from "@/features/explorer/hooks/useBatchThumbnailLoader"; // Add this import
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { trackArchiveTask } from "@/features/archives/archiveTracker";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, } from "@/components/ui/alert-dialog";
import authService from "@/features/auth/authService";
import {
    calculateNextIndex,
    computeRangeSelection,
    isInputOrModalActive,
    isInsideFileGrid,
    isButtonOrLink,
    canRenameItem,
    isSystemProtectedFolder,
    ARROW_KEYS
} from "@/features/explorer/lib/fileKeyboardNavigation";
import { getItemDuration, isItemStarred } from "@/features/explorer/lib/fileCardHelpers";

// Heavy viewers are split into their own chunks and load on first open
const ImageViewer = lazy(() => import("@/features/viewers/ImageViewer").then((m) => ({ default: m.ImageViewer })));
const DocumentReaderModal = lazy(() => import("@/features/viewers/DocumentReaderModal").then((m) => ({ default: m.DocumentReaderModal })));
const ArchiveInspectDialog = lazy(() => import("@/features/archives/ArchiveInspectDialog").then((m) => ({ default: m.ArchiveInspectDialog })));
export const getItemKey = (item) => item.id || item.file_unique_id || item.name;
export const FileGrid = ({ items, viewMode, onNavigate, itemCount, onCopy, onCut, onPaste, onDelete, onRename, onMove, onDownload, renamingItem, onRenameConfirm, onRenameCancel, currentFolder, onNewFolder, onUploadFiles, // Add this
onUploadFolder, // Add this
isLoading, cutItem, cutItems = [], hasClipboard, isClipboardPasted, onFileUploaded, onItemsChange, onRefresh, currentPath, currentApiPath, isTrashMode, onRestoreItem, onToggleStar, isVaultMode = false, onMoveToVault, onMoveToHome, isCloudMode = false, cloudAccountId, cloudFolderId, isInboxMode = false, }) => {
    const isEffectiveInboxMode = Boolean(isInboxMode ||
        currentFolder === "Telegram Inbox" ||
        currentApiPath === "/inbox" ||
        (currentPath && currentPath.length === 1 && currentPath[0] === "Telegram Inbox"));
    const isCloudVirtualSection = Boolean(isCloudMode && (!cloudFolderId || ["root", "starred", "trash", "shared_with_me"].includes(cloudFolderId)));
    const isRestrictedEmptyArea = Boolean(isEffectiveInboxMode ||
        isTrashMode ||
        cloudFolderId === "trash" ||
        currentFolder === "Starred" ||
        currentApiPath === "/starred" ||
        isCloudVirtualSection);
    const [contextMenu, setContextMenu] = useState(null);
    const [draggedItem, setDraggedItem] = useState(null);
    const [imageViewer, setImageViewer] = useState(null);
    const [documentReader, setDocumentReader] = useState(null);
    const [archiveInspect, setArchiveInspect] = useState(null);
    const [compressDialog, setCompressDialog] = useState(false);
    const { playMedia } = useMediaPlayer();
    const [isDragActive, setIsDragActive] = useState(false); // Add drag active state
    const [dropTarget, setDropTarget] = useState(null); // Track drop target
    const [uploadingFiles, setUploadingFiles] = useState(null); // Track uploading files
    const [uploadProgressMap, setUploadProgressMap] = useState({}); // Track real upload progress
    const [isDirectoryUpload, setIsDirectoryUpload] = useState(false); // Track if this is a directory upload
    const [showTelegramVerificationDialog, setShowTelegramVerificationDialog] = useState(false); // Track Telegram verification dialog visibility
    const [showIndexChatDialog, setShowIndexChatDialog] = useState(false); // Track index chat dialog visibility
    const isMobile = useIsMobile();
    const [selectedItems, setSelectedItems] = useState(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [isBatchDeleting, setIsBatchDeleting] = useState(false);
    const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
    const [propertiesItem, setPropertiesItem] = useState(null);
    const [focusedIndex, setFocusedIndex] = useState(null);
    const gridContainerRef = useRef(null);
    const listContainerRef = useRef(null);
    const itemElementsRef = useRef([]);
    const stateRef = useRef({});
    const lastTapRef = useRef(null);
    const lastOpenTimeRef = useRef(0);
    // If selectedItems becomes empty, automatically turn off selection mode
    useEffect(() => {
        if (selectedItems.size === 0) {
            setIsSelectionMode(false);
        }
    }, [selectedItems.size]);
    // Clear selection and focus when navigating folders
    useEffect(() => {
        setSelectedItems(new Set());
        setLastSelectedIndex(null);
        lastTapRef.current = null;
        setIsSelectionMode(false);
        setFocusedIndex(null);
    }, [currentFolder, currentApiPath]);
    // Keep focusedIndex within range when items change
    useEffect(() => {
        if (focusedIndex !== null && items && items.length > 0 && focusedIndex >= items.length) {
            setFocusedIndex(items.length - 1);
        } else if ((!items || items.length === 0) && focusedIndex !== null) {
            setFocusedIndex(null);
        }
    }, [items, focusedIndex]);
    // Prune selectedItems if items are removed, filtered, or deleted
    useEffect(() => {
        setSelectedItems(prev => {
            if (!prev || prev.size === 0) return prev;
            if (!items || items.length === 0) {
                setLastSelectedIndex(null);
                return new Set();
            }
            const currentItemKeys = new Set(items.map(getItemKey));
            let changed = false;
            const nextSelected = new Set();
            for (const key of prev) {
                if (currentItemKeys.has(key)) {
                    nextSelected.add(key);
                } else {
                    changed = true;
                }
            }
            if (changed) {
                if (nextSelected.size === 0) {
                    setLastSelectedIndex(null);
                }
                return nextSelected;
            }
            return prev;
        });
    }, [items]);
    // Keep active focused DOM element in view and focused
    useEffect(() => {
        if (focusedIndex !== null && itemElementsRef.current[focusedIndex]) {
            const el = itemElementsRef.current[focusedIndex];
            const active = typeof document !== 'undefined' ? document.activeElement : null;
            const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
            if (!isTyping) {
                try {
                    el.focus({ preventScroll: true });
                } catch (_) {}
            }
            try {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            } catch (_) {}
        }
    }, [focusedIndex]);
    const getGridColumns = () => {
        if (viewMode === "list") return 1;
        const container = gridContainerRef.current;
        if (container) {
            const children = container.children;
            if (children.length > 1) {
                const firstTop = children[0].offsetTop;
                let cols = 0;
                for (let i = 0; i < children.length; i++) {
                    if (Math.abs(children[i].offsetTop - firstTop) < 12) {
                        cols++;
                    } else {
                        break;
                    }
                }
                if (cols > 0 && cols < children.length) {
                    return cols;
                }
            }
            const width = container.clientWidth || 0;
            if (width >= 1536) return 12;
            if (width >= 1280) return 9;
            if (width >= 1024) return 8;
            if (width >= 768) return 6;
            if (width >= 640) return 4;
            if (width >= 480) return 3;
            return 2;
        }
        return 1;
    };
    // Warn user if they try to close or refresh the page while an upload is in progress
    useEffect(() => {
        const isAnyUploading = Object.values(uploadProgressMap).some(f => f.status === 'uploading');
        if (!isAnyUploading)
            return;
        const handleBeforeUnload = (e) => {
            e.preventDefault();
            e.returnValue = "An upload is in progress. Leaving or refreshing will interrupt the upload.";
            return e.returnValue;
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
    }, [uploadProgressMap]);
    // Listen for uploadCompleted events from UploadManager to refresh grid
    useEffect(() => {
        const handleUploadDone = (e) => {
            if (onRefresh)
                onRefresh();
            if (e.detail?.file && onFileUploaded) {
                onFileUploaded(e.detail.file);
            }
        };
        const handleTgNotVerified = () => setShowTelegramVerificationDialog(true);
        const handleIndexChatNotFound = () => setShowIndexChatDialog(true);
        window.addEventListener("uploadCompleted", handleUploadDone);
        window.addEventListener("telegramNotVerified", handleTgNotVerified);
        window.addEventListener("indexChatNotFound", handleIndexChatNotFound);
        return () => {
            window.removeEventListener("uploadCompleted", handleUploadDone);
            window.removeEventListener("telegramNotVerified", handleTgNotVerified);
            window.removeEventListener("indexChatNotFound", handleIndexChatNotFound);
        };
    }, [onRefresh, onFileUploaded]);
    // Keyboard shortcuts: Escape to clear selection, Ctrl+A / Cmd+A to select all, Alt+Enter for Properties, Arrow keys, Space, Enter, F2, Delete
    useEffect(() => {
        const handleKeyDown = (e) => {
            const s = stateRef.current;
            const target = e.target;

            // 1. Guard against firing while typing in inputs, textareas, selects, editable elements,
            // open dialogs (Radix modals), or when user is navigating the sidebar/header.
            const isModalActive = Boolean(
                s.propertiesItem ||
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
                    setBatchDeleteDialogOpen(true);
                } else if (s.focusedIndex !== null && s.items[s.focusedIndex]) {
                    const item = s.items[s.focusedIndex];
                    if (isSystemProtectedFolder(item, s.currentPath)) {
                        toast.error("Cannot delete default system folders");
                        return;
                    }
                    if (s.onDelete) {
                        s.onDelete(item, s.focusedIndex);
                    }
                }
                return;
            }

            // 8. Alt+Enter: Properties dialog
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
                    setPropertiesItem(targetItem);
                }
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
    }, []);
    const dragCounter = useRef(0); // Track drag enter/leave events
    const draggedItemRef = useRef(null); // Ref for dragged item to access in Tauri events    // Update the ref whenever draggedItem changes
    useEffect(() => {
        draggedItemRef.current = draggedItem;
    }, [draggedItem]);
    // Check if we're running in Tauri
    const isTauri = authService.isTauri();
    // Use the batch thumbnail loader hook
    const { loadedThumbnails, loadingStates, retryLoad } = useBatchThumbnailLoader(items);
    // Reset drag counter on component mount and unmount
    useEffect(() => {
        dragCounter.current = 0;
        return () => {
            dragCounter.current = 0;
        };
    }, []);
    // Reference for the hidden file input
    const fileInputRef = useRef(null);
    const directoryInputRef = useRef(null);
    // Add Tauri event listeners for drag and drop
    useEffect(() => {
        if (!isTauri)
            return;
        let unlistenDragEnter = null;
        let unlistenDragOver = null;
        let unlistenDragDrop = null;
        let unlistenDragLeave = null;
        const initTauriDragListeners = async () => {
            try {
                // Dynamically import the event module only in Tauri environment
                const eventModule = await import('@tauri-apps/api/event');
                // Listen for Tauri drag enter events
                unlistenDragEnter = await eventModule.listen('tauri://drag-enter', (event) => {
                    // Increment the drag counter, ensuring it doesn't go negative
                    dragCounter.current = Math.max(0, dragCounter.current + 1);
                    // Only set drag over state for actual file drags (not internal moves)
                    // In Tauri, we can't access DataTransfer data, so we rely on our internal state
                    if (!draggedItemRef.current) {
                        setIsDragActive(true);
                    }
                });
                // Listen for Tauri drag over events
                unlistenDragOver = await eventModule.listen('tauri://drag-over', (event) => {
                    // Keep drag over state for actual file drags (not internal moves)
                    // In Tauri, we can't access DataTransfer data, so we rely on our internal state
                    if (!draggedItemRef.current) {
                        setIsDragActive(true);
                    }
                });
                // Listen for Tauri drag drop events
                unlistenDragDrop = await eventModule.listen('tauri://drag-drop', (event) => {
                    // Handle dropped files in Tauri
                    // Reset the drag counter and clear drag state
                    dragCounter.current = 0;
                    setIsDragActive(false);
                    if (event && event.payload) {
                        // The payload should contain the file paths
                        // Check if this is an internal move by checking if we have a dragged item
                        // In Tauri, we can't access DataTransfer data, so we rely on our internal state
                        if (draggedItemRef.current) {
                            // Don't process as file upload, let the item drop handlers handle it
                            return;
                        }
                        // If no internal drag, process as file upload
                        // Note: This is a simplified version - in a real implementation, 
                        // we would need to handle the file paths from the payload
                    }
                });
                // Listen for Tauri drag leave events
                unlistenDragLeave = await eventModule.listen('tauri://drag-leave', (event) => {
                    // Always decrement the drag counter on drag leave
                    dragCounter.current = Math.max(0, dragCounter.current - 1);
                    // Clear drag over state when counter is 0
                    if (dragCounter.current === 0) {
                        setIsDragActive(false);
                    }
                });
            }
            catch (error) {
                console.error('Failed to initialize Tauri drag listeners:', error);
            }
        };
        initTauriDragListeners();
        // Cleanup function to remove event listeners and reset drag counter
        return () => {
            if (unlistenDragEnter)
                unlistenDragEnter();
            if (unlistenDragOver)
                unlistenDragOver();
            if (unlistenDragDrop)
                unlistenDragDrop();
            if (unlistenDragLeave)
                unlistenDragLeave();
            // Reset drag counter when component unmounts
            dragCounter.current = 0;
        };
    }, [isTauri]);
    // Disable Tauri's file drop functionality if possible
    useEffect(() => {
        if (!isTauri)
            return;
        const disableFileDrop = async () => {
            try {
                // Try to access the Tauri window API to disable file drop
                // In Tauri v2, we don't need to explicitly get the current window
                // The file drop is now handled at the Rust level
                console.log('Tauri file drop workaround applied');
            }
            catch (error) {
                console.error('Failed to apply file drop workaround:', error);
            }
        };
        disableFileDrop();
    }, [isTauri]);
    const openItemContextMenu = (item, index, clientX, clientY) => {
        const itemKey = getItemKey(item);
        if (!selectedItems.has(itemKey)) {
            setSelectedItems(new Set([itemKey]));
            setLastSelectedIndex(index);
        }
        setContextMenu({
            x: clientX ?? (typeof window !== 'undefined' ? window.innerWidth / 2 : 200),
            y: clientY ?? (typeof window !== 'undefined' ? window.innerHeight / 2 : 300),
            itemType: item.type,
            itemName: item.name,
            item,
            index,
        });
    };
    const touchTimerRef = useRef(null);
    const touchStartPosRef = useRef(null);
    const isLongPressRef = useRef(false);
    const handleTouchStart = (e, item, index) => {
        const touch = e.touches[0];
        touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
        isLongPressRef.current = false;
        if (touchTimerRef.current)
            clearTimeout(touchTimerRef.current);
        touchTimerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try {
                    navigator.vibrate(40);
                }
                catch (_) { }
            }
            openItemContextMenu(item, index, touch.clientX, touch.clientY);
        }, 500);
    };
    const handleTouchMove = (e) => {
        if (!touchStartPosRef.current)
            return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
        const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
        if (dx > 10 || dy > 10) {
            if (touchTimerRef.current)
                clearTimeout(touchTimerRef.current);
        }
    };
    const handleTouchEnd = () => {
        if (touchTimerRef.current)
            clearTimeout(touchTimerRef.current);
    };
    const handleContextMenu = (e, item, index) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent event from bubbling to parent container
        // Additional prevention of default context menu
        e.nativeEvent.preventDefault();
        const itemKey = getItemKey(item);
        if (!selectedItems.has(itemKey)) {
            setSelectedItems(new Set([itemKey]));
            setLastSelectedIndex(index);
        }
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            itemType: item.type,
            itemName: item.name,
            item,
            index,
        });
    };
    const handleItemOpen = (item) => {
        const now = Date.now();
        if (now - lastOpenTimeRef.current < 250)
            return;
        lastOpenTimeRef.current = now;
        const ext = (item.extension || item.name.split('.').pop() || '').toLowerCase();
        const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'avif', 'tiff'];
        const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', '3gp', 'ts'];
        const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'wma'];
        const DOC_EXTS = [
            'pdf', 'epub', 'cbz', 'cbr', 'docx', 'md', 'markdown',
            'txt', 'log', 'json', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css',
            'sh', 'bash', 'yml', 'yaml', 'xml', 'sql', 'env', 'ini', 'conf',
            'xlsx', 'xls', 'xlsm', 'xlsb', 'xltx', 'csv', 'tsv', 'ods',
            'pptx', 'ppt', 'ppsx', 'potx', 'pptm', 'potm'
        ];
        const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z'];
        const isPhoto = item.fileType === "photo" || PHOTO_EXTS.includes(ext);
        const isVideo = item.fileType === "video" || VIDEO_EXTS.includes(ext);
        const isAudio = item.fileType === "audio" || item.fileType === "voice" || AUDIO_EXTS.includes(ext);
        const isDoc = DOC_EXTS.includes(ext);
        const isArchive = ARCHIVE_EXTS.includes(ext);
        const baseUrl = getApiBaseUrl();
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
        const sep = tokenParam ? '&' : '?';
        if (item.type === "folder") {
            setSelectedItems(new Set());
            setLastSelectedIndex(null);
            setIsSelectionMode(false);
            onNavigate(item.name, item);
        }
        else if (isPhoto) {
            const photoItems = items.filter((it) => it.type !== "folder" &&
                (it.fileType === "photo" ||
                    PHOTO_EXTS.includes((it.extension || it.name.split('.').pop() || '').toLowerCase())));
            const allImages = photoItems.map((it) => {
                const fId = it.id ? `&file_id=${encodeURIComponent(it.id)}` : '';
                const fPath = it.file_path ? `&path=${encodeURIComponent(it.file_path)}` : '';
                return {
                    url: `${baseUrl ? baseUrl : ''}/dl/${encodeURIComponent(it.name)}${tokenParam}${sep}inline=1${fId}${fPath}`,
                    fileName: it.name,
                };
            });
            const currentIdx = allImages.findIndex((img) => img.fileName === item.name);
            const itemFId = item.id ? `&file_id=${encodeURIComponent(item.id)}` : '';
            const itemFPath = item.file_path ? `&path=${encodeURIComponent(item.file_path)}` : '';
            if (item.is_cloud) {
                const photoUrl = api.getCloudStreamUrl(cloudAccountId || item.cloud_account_id, item.cloud_file_id || item.id);
                setImageViewer({
                    images: [{ url: photoUrl, fileName: item.name }],
                    initialIndex: 0,
                });
            }
            else {
                setImageViewer({
                    images: allImages.length > 0 ? allImages : [{
                            url: `${baseUrl ? baseUrl : ''}/dl/${encodeURIComponent(item.name)}${tokenParam}${sep}inline=1${itemFId}${itemFPath}`,
                            fileName: item.name,
                        }],
                    initialIndex: Math.max(0, currentIdx),
                });
            }
        }
        else if (isVideo || isAudio) {
            console.log("Opening media in built-in player");
            let mediaUrl;
            if (item.is_cloud) {
                mediaUrl = api.getCloudStreamUrl(cloudAccountId || item.cloud_account_id, item.cloud_file_id || item.id);
            }
            else {
                const itemFId = item.id ? `&file_id=${encodeURIComponent(item.id)}` : '';
                const itemFPath = item.file_path ? `&path=${encodeURIComponent(item.file_path)}` : '';
                mediaUrl = `${baseUrl ? baseUrl : ''}/dl/${encodeURIComponent(item.name)}${tokenParam}${sep}inline=1${itemFId}${itemFPath}`;
            }
            // If audio, construct a full playlist of all audio items in current folder/view
            let folderAudioPlaylist;
            if (isAudio) {
                const audioExtensions = new Set(["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "wma"]);
                folderAudioPlaylist = items
                    .filter((it) => {
                    const itExt = (it.extension || it.name.split('.').pop() || '').toLowerCase();
                    return it.type === "audio" || it.fileType === "audio" || audioExtensions.has(itExt);
                })
                    .map((it) => {
                    let trackUrl;
                    if (it.is_cloud) {
                        trackUrl = api.getCloudStreamUrl(cloudAccountId || it.cloud_account_id, it.cloud_file_id || it.id);
                    }
                    else {
                        const itFId = it.id ? `&file_id=${encodeURIComponent(it.id)}` : '';
                        const itFPath = it.file_path ? `&path=${encodeURIComponent(it.file_path)}` : '';
                        trackUrl = `${baseUrl ? baseUrl : ''}/dl/${encodeURIComponent(it.name)}${tokenParam}${sep}inline=1${itFId}${itFPath}`;
                    }
                    return {
                        id: it.id || it.name,
                        name: it.name,
                        url: trackUrl,
                        size: it.size,
                        fileItem: it,
                    };
                });
            }
            playMedia({
                url: mediaUrl,
                fileName: item.name,
                fileType: isVideo ? "video" : (item.fileType || "audio"),
                fileItem: item,
            }, folderAudioPlaylist);
        }
        else if (isDoc) {
            let docUrl;
            if (item.is_cloud) {
                docUrl = api.getCloudStreamUrl(cloudAccountId || item.cloud_account_id, item.cloud_file_id || item.id);
            }
            else {
                const itemFId = item.id ? `&file_id=${encodeURIComponent(item.id)}` : '';
                const itemFPath = item.file_path ? `&path=${encodeURIComponent(item.file_path)}` : '';
                docUrl = `${baseUrl ? baseUrl : ''}/dl/${encodeURIComponent(item.name)}${tokenParam}${sep}inline=1${itemFId}${itemFPath}`;
            }
            setDocumentReader({
                url: docUrl,
                fileName: item.name,
                extension: ext,
            });
        }
        else if (isArchive) {
            setArchiveInspect({
                fileId: getItemKey(item),
                fileName: item.name,
            });
        }
        else {
            // For unknown binary types, trigger download
            onDownload(item);
        }
    };
    // Keep stateRef fresh for capture-phase keyboard navigation
    stateRef.current = {
        items,
        selectedItems,
        focusedIndex,
        lastSelectedIndex,
        isSelectionMode,
        viewMode,
        isTrashMode,
        isEffectiveInboxMode,
        isCloudVirtualSection,
        currentFolder,
        currentApiPath,
        currentPath,
        onRename,
        onDelete,
        onCopy,
        onCut,
        onPaste,
        hasClipboard,
        propertiesItem,
        batchDeleteDialogOpen,
        imageViewer,
        documentReader,
        archiveInspect,
        compressDialog,
        showTelegramVerificationDialog,
        showIndexChatDialog,
        renamingItem,
        contextMenu,
        handleItemOpen,
        getGridColumns,
    };
    const handleItemClick = (e, item, index) => {
        if (isLongPressRef.current) {
            isLongPressRef.current = false;
            return;
        }
        // Range select with Shift
        if (e.shiftKey && lastSelectedIndex !== null) {
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            const newSelected = new Set(selectedItems);
            for (let i = start; i <= end; i++) {
                if (items[i])
                    newSelected.add(getItemKey(items[i]));
            }
            setSelectedItems(newSelected);
            setIsSelectionMode(true);
            setFocusedIndex(index);
            return;
        }
        else if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd toggle
            const itemKey = getItemKey(item);
            const newSelected = new Set(selectedItems);
            if (newSelected.has(itemKey)) {
                newSelected.delete(itemKey);
                if (newSelected.size === 0)
                    setIsSelectionMode(false);
            }
            else {
                newSelected.add(itemKey);
                setIsSelectionMode(true);
            }
            setSelectedItems(newSelected);
            setLastSelectedIndex(index);
            setFocusedIndex(index);
            return;
        }
        // When multi-selection mode is active (activated via circle checkbox or select all)
        if (isSelectionMode && selectedItems.size > 0) {
            const itemKey = getItemKey(item);
            const newSelected = new Set(selectedItems);
            if (newSelected.has(itemKey)) {
                newSelected.delete(itemKey);
                if (newSelected.size === 0)
                    setIsSelectionMode(false);
            }
            else {
                newSelected.add(itemKey);
            }
            setSelectedItems(newSelected);
            setLastSelectedIndex(index);
            setFocusedIndex(index);
            return;
        }
        // Normal mode: Single click/tap OPENS IMMEDIATELY! (Both folders and files)
        // Selection happens only when clicking the circular checkbox!
        setSelectedItems(new Set());
        setLastSelectedIndex(null);
        setIsSelectionMode(false);
        setFocusedIndex(index);
        handleItemOpen(item);
    };
    const handleCheckboxClick = (e, item, index) => {
        e.stopPropagation();
        lastTapRef.current = null;
        const itemKey = getItemKey(item);
        const newSelected = new Set(selectedItems);
        if (newSelected.has(itemKey)) {
            newSelected.delete(itemKey);
            if (newSelected.size === 0) {
                setIsSelectionMode(false);
            }
        }
        else {
            newSelected.add(itemKey);
            setIsSelectionMode(true);
        }
        setSelectedItems(newSelected);
        setLastSelectedIndex(index);
        setFocusedIndex(index);
    };
    const handleSelectAllToggle = () => {
        if (selectedItems.size === items.length) {
            setSelectedItems(new Set());
            setLastSelectedIndex(null);
            setIsSelectionMode(false);
        }
        else {
            setSelectedItems(new Set(items.map(getItemKey)));
            setIsSelectionMode(true);
        }
    };
    const handleBatchDownload = async () => {
        const itemsToDownload = items.filter(item => selectedItems.has(getItemKey(item)));
        if (itemsToDownload.length === 0) {
            toast.info("No items selected for download");
            return;
        }
        toast.info(`Queueing ${itemsToDownload.length} item${itemsToDownload.length > 1 ? 's' : ''} for download...`);
        for (const item of itemsToDownload) {
            try {
                await onDownload(item);
            }
            catch (err) {
                console.error("Error downloading item:", item.name, err);
            }
        }
    };
    const handleConfirmBatchDelete = async () => {
        const itemsToDelete = items.filter(item => selectedItems.has(getItemKey(item)));
        // Protect system folders in root Home
        const validItemsToDelete = itemsToDelete.filter(item => {
            if (currentPath && currentPath.length === 1 &&
                currentPath[0] === "Home" &&
                ["Images", "Documents", "Audio", "Voice Messages", "Videos"].includes(item.name)) {
                return false;
            }
            return true;
        });
        if (validItemsToDelete.length === 0) {
            toast.error("Cannot delete default system folders");
            setBatchDeleteDialogOpen(false);
            return;
        }
        setIsBatchDeleting(true);
        let successCount = 0;
        let failCount = 0;
        const baseUrl = getApiBaseUrl();
        const apiUrl = baseUrl ? `${baseUrl}` : '';
        const deleteEndpoint = isTrashMode ? `${apiUrl}/files/delete` : `${apiUrl}/files/trash`;
        for (const item of validItemsToDelete) {
            try {
                const response = await fetchWithTimeout(deleteEndpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        file_id: item.id,
                    }),
                }, 5000);
                if (response.ok) {
                    successCount++;
                }
                else {
                    failCount++;
                }
            }
            catch (e) {
                failCount++;
            }
        }
        setIsBatchDeleting(false);
        setBatchDeleteDialogOpen(false);
        setSelectedItems(new Set());
        setLastSelectedIndex(null);
        if (successCount > 0) {
            toast.success(isTrashMode
                ? `Permanently deleted ${successCount} item${successCount > 1 ? 's' : ''}`
                : `Moved ${successCount} item${successCount > 1 ? 's' : ''} to Trash`);
            if (onRefresh) {
                onRefresh();
            }
        }
        if (failCount > 0) {
            toast.error(`Failed to process ${failCount} item${failCount > 1 ? 's' : ''}`);
        }
    };
    const selectedFilesCount = items.filter(item => selectedItems.has(getItemKey(item))).length;
    const handleDragStart = (e, item) => {
        setDraggedItem(item);
        e.dataTransfer.effectAllowed = "move";
        // Set both application/json and text/plain data to ensure compatibility
        e.dataTransfer.setData("application/json", JSON.stringify(item));
        e.dataTransfer.setData("text/plain", JSON.stringify(item));
        // In Tauri, we might need to explicitly set the drag image
        if (isTauri) {
            const img = new Image();
            img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            e.dataTransfer.setDragImage(img, 0, 0);
        }
    };
    const handleDragEnd = () => {
        setDraggedItem(null);
    };
    // Add file upload handler that accepts both FileList and TraversedFile[]
    const handleFileUpload = async (files) => {
        try {
            if (isEffectiveInboxMode) {
                toast.error("Uploading files to Telegram Inbox is restricted. Inbox is only for incoming Telegram messages.");
                return;
            }
            if (isCloudMode && isCloudVirtualSection) {
                toast.error("Cannot upload files at root level or in virtual sections. Please open My Drive first.");
                return;
            }
            if (isTrashMode || cloudFolderId === "trash") {
                toast.error("Cannot upload files to Trash.");
                return;
            }
            if (currentFolder === "Starred" || currentApiPath === "/starred") {
                toast.error("Cannot upload files to Starred.");
                return;
            }
            // Use the API path if available, otherwise construct it
            // Ensure root path is always "/Home" instead of "/"
            let currentPathStr = currentApiPath || `/${currentFolder}`;
            if (currentPathStr === '/') {
                currentPathStr = '/Home';
            }
            console.log('Current folder:', currentFolder);
            console.log('Current path array:', currentPath);
            console.log('Current API path:', currentApiPath);
            console.log('Using path for upload:', currentPathStr);
            // Validate inputs
            if (!files || (Array.isArray(files) && files.length === 0) || (files instanceof FileList && files.length === 0)) {
                throw new Error('No files selected for upload');
            }
            // Convert files to array for easier handling
            const filesArray = [];
            if (files instanceof FileList) {
                // Convert FileList to array and check for webkitRelativePath
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    // Check if this is a directory upload with webkitRelativePath
                    if ('webkitRelativePath' in file && file.webkitRelativePath) {
                        // Extract just the file name from the webkitRelativePath
                        const fullPath = file.webkitRelativePath;
                        const fileName = fullPath.split('/').pop() || file.name;
                        // Create a new File object with a clean name
                        const cleanFile = new File([file], fileName, {
                            type: file.type,
                            lastModified: file.lastModified,
                        });
                        // Create TraversedFile object with fullPath from webkitRelativePath
                        filesArray.push({
                            file: cleanFile,
                            name: fileName,
                            fullPath: fullPath,
                            size: file.size,
                            type: file.type,
                            lastModified: file.lastModified
                        });
                    }
                    else {
                        // Regular file object
                        filesArray.push(file);
                    }
                }
            }
            else {
                // Already an array
                filesArray.push(...files);
            }
            // Log all files for debugging
            console.log('All files received:', filesArray.map(f => {
                // Handle both File objects and TraversedFile objects
                if ('file' in f && f.file instanceof File) {
                    // TraversedFile object
                    return {
                        name: f.file.name,
                        size: f.file.size,
                        type: f.file.type,
                        fullPath: f.fullPath,
                        lastModified: f.file.lastModified,
                        webkitRelativePath: 'webkitRelativePath' in f.file ? f.file.webkitRelativePath : 'N/A'
                    };
                }
                else if (f instanceof File) {
                    // Regular File object
                    return {
                        name: f.name,
                        size: f.size,
                        type: f.type,
                        fullPath: 'N/A',
                        lastModified: f.lastModified,
                        webkitRelativePath: 'webkitRelativePath' in f ? f.webkitRelativePath : 'N/A'
                    };
                }
                else {
                    // Unknown object type
                    return {
                        name: 'unknown',
                        size: 0,
                        type: 'unknown',
                        fullPath: 'unknown',
                        lastModified: 0,
                        webkitRelativePath: 'N/A'
                    };
                }
            }));
            // Filter out clearly problematic files
            const validFiles = filesArray.filter(fileObj => {
                // Handle both File objects and TraversedFile objects
                let file;
                let fullPath;
                if ('file' in fileObj && fileObj.file instanceof File) {
                    // TraversedFile object
                    file = fileObj.file;
                    fullPath = fileObj.fullPath;
                }
                else if (fileObj instanceof File) {
                    // Regular File object
                    file = fileObj;
                    // Check for webkitRelativePath in regular File objects too
                    if ('webkitRelativePath' in fileObj && fileObj.webkitRelativePath) {
                        fullPath = fileObj.webkitRelativePath;
                    }
                }
                else {
                    // Unknown object type
                    console.warn('Skipping unknown file object type');
                    return false;
                }
                // Skip files with no name
                if (!file.name) {
                    console.warn('Skipping file with no name');
                    return false;
                }
                // Skip system files that are definitely not user files
                if (file.name === 'Thumbs.db' || file.name === 'desktop.ini') {
                    console.warn('Skipping system file:', file.name);
                    return false;
                }
                // For traversed files (from folder drop), we should keep them even if they have size 0
                // because they came from our folder traversal logic and have proper fullPaths
                if (fullPath && fullPath !== file.name) {
                    // This is a traversed file with a path structure, keep it
                    console.log('Keeping traversed file:', file.name, 'with fullPath:', fullPath);
                    return true;
                }
                // Keep files that have either:
                // 1. Content (size > 0)
                // 2. A type (indicating it's a real file)
                if (file.size > 0 || file.type) {
                    return true;
                }
                // For files with size 0 and no type, we need to be more careful
                // If it has a meaningful path structure (contains slashes), it's likely from folder traversal
                if (fullPath && fullPath.includes('/') && fullPath !== file.name) {
                    return true;
                }
                // According to project specification "Preserve Zero-Size Directory Placeholders During Filtering":
                // Do not skip entries solely based on size 0 and empty type. Directory placeholders appear this way;
                // they must be allowed to pass through so recursive traversal can process their contents.
                console.log('Preserving potential directory placeholder:', file.name);
                return true;
            });
            // Log valid files for debugging
            console.log('Valid files after filtering:', validFiles.map(f => {
                // Handle both File objects and TraversedFile objects
                if ('file' in f && f.file instanceof File) {
                    // TraversedFile object
                    return {
                        name: f.file.name,
                        size: f.file.size,
                        type: f.file.type,
                        fullPath: f.fullPath,
                        lastModified: f.file.lastModified,
                        webkitRelativePath: 'webkitRelativePath' in f.file ? f.file.webkitRelativePath : 'N/A'
                    };
                }
                else if (f instanceof File) {
                    // Regular File object
                    return {
                        name: f.name,
                        size: f.size,
                        type: f.type,
                        fullPath: 'webkitRelativePath' in f && f.webkitRelativePath ? f.webkitRelativePath : 'N/A',
                        lastModified: f.lastModified,
                        webkitRelativePath: 'webkitRelativePath' in f ? f.webkitRelativePath : 'N/A'
                    };
                }
                else {
                    // Unknown object type
                    return {
                        name: 'unknown',
                        size: 0,
                        type: 'unknown',
                        fullPath: 'unknown',
                        lastModified: 0,
                        webkitRelativePath: 'N/A'
                    };
                }
            }));
            if (validFiles.length === 0) {
                throw new Error('No valid files to upload after filtering');
            }
            // Set uploading files state to show the progress widget
            const filesToUpload = validFiles.map(f => {
                if ('file' in f && f.file instanceof File) {
                    return f.file;
                }
                else if (f instanceof File) {
                    return f;
                }
                return null;
            }).filter(Boolean);
            // Check if any of these files is already actively uploading
            const duplicateUploading = filesToUpload.find(f => {
                const fileKey = ('fullPath' in f && f.fullPath) || f.name;
                return uploadProgressMap[fileKey]?.status === 'uploading';
            });
            if (duplicateUploading) {
                toast.warning(`"${duplicateUploading.name}" is already uploading! Please wait for it to complete.`);
                return;
            }
            setUploadingFiles(filesToUpload);
            // Direct upload to Google Drive if in Cloud Mode
            if (isCloudMode && cloudAccountId) {
                if (isCloudVirtualSection) {
                    toast.error("Cannot upload files at root level or in virtual sections. Please open My Drive first.");
                    setUploadingFiles(null);
                    return;
                }
                let uploadedCount = 0;
                toast.info(`Uploading ${filesToUpload.length} file(s) to Google Drive ☁️...`);
                for (const file of filesToUpload) {
                    try {
                        await api.uploadToCloud(cloudAccountId, file, cloudFolderId || "root");
                        uploadedCount++;
                    }
                    catch (uploadErr) {
                        toast.error(`Failed to upload "${file.name}": ${uploadErr.message}`);
                    }
                }
                if (uploadedCount > 0) {
                    toast.success(`Successfully uploaded ${uploadedCount} file(s) to Google Drive ☁️`);
                    if (onRefresh)
                        onRefresh();
                    if (onFileUploaded)
                        onFileUploaded();
                }
                setUploadingFiles(null);
                setUploadProgressMap({});
                return;
            }
            // Collect all unique top-level folder names that need to be created
            const topLevelFoldersToCreate = new Set();
            // Collect all unique folder paths that need to be created
            const folderPathsToCreate = new Set();
            // Process each file to determine all folder paths in the hierarchy
            validFiles.forEach(fileObj => {
                let fullPath;
                if ('file' in fileObj && fileObj.file instanceof File) {
                    fullPath = fileObj.fullPath;
                }
                else if (fileObj instanceof File) {
                    // Check for webkitRelativePath in regular File objects too
                    if ('webkitRelativePath' in fileObj && fileObj.webkitRelativePath) {
                        fullPath = fileObj.webkitRelativePath;
                    }
                }
                // If we have a full path structure (e.g., "qwes/subfolder/file.txt"), we need to:
                // 1. Extract all folder paths in the hierarchy
                // 2. Add them to our set of folders to create
                if (fullPath && fullPath.includes('/')) {
                    const pathParts = fullPath.split('/');
                    console.log(`Processing fullPath: ${fullPath}, pathParts:`, pathParts);
                    // Skip if the path is just "Home" or empty
                    if (pathParts.length === 1 && (pathParts[0] === 'Home' || pathParts[0] === '')) {
                        console.log(`Skipping invalid path: ${fullPath}`);
                        return;
                    }
                    if (pathParts.length >= 1) {
                        // Create all intermediate folder paths
                        // For a path like "folder1/subfolder1/subfolder2/file.txt"
                        // We need to create folder paths: 
                        // - currentPathStr/folder1
                        // - currentPathStr/folder1/subfolder1
                        // - currentPathStr/folder1/subfolder1/subfolder2
                        let cumulativePath = "";
                        for (let i = 0; i < pathParts.length - 1; i++) { // -1 because we don't want the filename
                            if (i === 0) {
                                cumulativePath = pathParts[i];
                            }
                            else {
                                cumulativePath = `${cumulativePath}/${pathParts[i]}`;
                            }
                            folderPathsToCreate.add(cumulativePath);
                            console.log(`Adding folder path to create: ${cumulativePath}`);
                        }
                    }
                }
            });
            // Create all required folder paths using the recursive create_folder_path API
            console.log('Creating folder paths:', Array.from(folderPathsToCreate));
            for (const folderPath of folderPathsToCreate) {
                try {
                    console.log(`Creating folder path '${folderPath}' in base path '${currentPathStr}'`);
                    // Construct the full path by combining current path with the relative folder path
                    let fullPathToCreate;
                    if (currentPathStr === '/') {
                        // If we're at root, the full path is "/Home/folderPath"
                        fullPathToCreate = `/Home/${folderPath}`;
                    }
                    else if (currentPathStr === '/Home') {
                        // If we're in /Home, just append the folderPath
                        fullPathToCreate = `/Home/${folderPath}`;
                    }
                    else {
                        // If we're in a subdirectory like /Home/Documents, combine the paths correctly
                        // Ensure currentPathStr doesn't end with slash
                        const cleanCurrentPath = currentPathStr.replace(/\/$/, ''); // Remove trailing slash
                        fullPathToCreate = `${cleanCurrentPath}/${folderPath}`;
                    }
                    console.log(`Calling createFolderPath with full path: ${fullPathToCreate}`);
                    await api.createFolderPath(fullPathToCreate);
                    console.log(`Successfully created folder path: ${fullPathToCreate}`);
                }
                catch (error) {
                    console.warn(`Error creating folder path ${folderPath}:`, error);
                }
            }
            // Queue files into uploadManager
            let addedCount = 0;
            validFiles.forEach((fileObj) => {
                let file;
                let fullPath;
                if ('file' in fileObj && fileObj.file instanceof File) {
                    file = fileObj.file;
                    fullPath = fileObj.fullPath;
                }
                else if (fileObj instanceof File) {
                    file = fileObj;
                    if ('webkitRelativePath' in fileObj && fileObj.webkitRelativePath) {
                        fullPath = fileObj.webkitRelativePath;
                    }
                }
                else {
                    return;
                }
                // For folder uploads, construct the correct path
                let uploadPath = currentPathStr;
                if (fullPath && fullPath.includes('/')) {
                    const pathParts = fullPath.split('/');
                    if (pathParts.length >= 1) {
                        const folderPathParts = pathParts.slice(0, -1);
                        const folderPathRelative = folderPathParts.join('/');
                        if (currentPathStr === '/') {
                            uploadPath = `/Home/${folderPathRelative}`;
                        }
                        else if (currentPathStr === '/Home') {
                            uploadPath = `/Home/${folderPathRelative}`;
                        }
                        else {
                            const cleanCurrentPath = currentPathStr.replace(/\/$/, '');
                            uploadPath = `${cleanCurrentPath}/${folderPathRelative}`;
                        }
                    }
                }
                uploadManager.addUpload(file, uploadPath);
                addedCount++;
            });
            if (addedCount > 0) {
                toast.success(`Added ${addedCount} file${addedCount > 1 ? 's' : ''} to Transfers`);
            }
            setUploadingFiles(null);
            setUploadProgressMap({});
        }
        catch (error) {
            console.error('Upload process error:', error);
            if (error?.message?.includes('TELEGRAM_NOT_VERIFIED')) {
                setShowTelegramVerificationDialog(true);
            }
            else if (error?.message?.includes('User index chat not found')) {
                setShowIndexChatDialog(true);
            }
        }
    };
    // Handle drag enter event
    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Increment the drag counter, ensuring it doesn't go negative
        dragCounter.current = Math.max(0, dragCounter.current + 1);
        // Check for internal drag data first - this indicates item moves, not file uploads
        // Check for both application/json and text/plain for compatibility
        const hasInternalData = e.dataTransfer.types.includes('application/json') ||
            e.dataTransfer.types.includes('text/plain');
        // If it's an internal drag, don't set drag active state
        if (hasInternalData) {
            return;
        }
        // Only set drag active for actual file drags (not internal moves)
        const hasFiles = e.dataTransfer.types.includes('Files');
        if (hasFiles) {
            if (isRestrictedEmptyArea) {
                return;
            }
            setIsDragActive(true);
        }
    };
    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Always decrement the drag counter on drag leave
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        // Only hide the overlay if drag counter is 0
        if (dragCounter.current === 0) {
            setIsDragActive(false);
        }
    };
    const handleFileDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Check for internal drag data first - this indicates item moves, not file uploads
        // Check for both application/json and text/plain for compatibility
        const hasInternalData = e.dataTransfer.types.includes('application/json') ||
            e.dataTransfer.types.includes('text/plain');
        // If it's an internal drag, don't set drop effect
        if (hasInternalData) {
            return;
        }
        // Only set drop effect for actual file drags (not internal moves)
        const hasFiles = e.dataTransfer.types.includes('Files');
        if (hasFiles) {
            if (isRestrictedEmptyArea) {
                e.dataTransfer.dropEffect = 'none';
                return;
            }
            e.dataTransfer.dropEffect = 'copy';
        }
    };
    // Handle file drop with modern folder traversal
    const handleFileDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Reset the drag counter and clear drag state
        dragCounter.current = 0;
        setIsDragActive(false);
        try {
            // Check for internal drag data first - this indicates item moves, not file uploads
            // Check for both application/json and text/plain for compatibility
            const hasInternalData = e.dataTransfer.types.includes('application/json') ||
                e.dataTransfer.types.includes('text/plain');
            // If it's an internal drag, don't treat as file upload regardless of other data types
            if (hasInternalData) {
                // This is an internal item drag, let the item drop handlers handle it
                // If no item drop handler caught it, it means it was dropped in an invalid location
                // In this case, we should just clear the drag state
                setDraggedItem(null);
                return;
            }
            // Check for actual file data from OS (only if no internal data)
            const hasFiles = e.dataTransfer.types.includes('Files');
            // If it's a file drag from OS, handle as file upload
            if (hasFiles) {
                // Process items synchronously within the event handler
                // Due to browser security restrictions, we must access DataTransfer items immediately
                // Try modern FileSystemHandle API first (synchronously)
                const modernFiles = await processItemsWithModernAPI(e.dataTransfer.items);
                if (modernFiles && modernFiles.length > 0) {
                    handleFileUpload(modernFiles);
                    return;
                }
                // Try legacy Entry API (synchronously)
                const legacyFiles = await processItemsWithLegacyAPI(e.dataTransfer.items);
                if (legacyFiles && legacyFiles.length > 0) {
                    handleFileUpload(legacyFiles);
                    return;
                }
                // Fallback to direct file access
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const files = e.dataTransfer.files;
                    // Convert to array and process
                    const fileListArray = Array.from(files);
                    // Create TraversedFile objects for each file
                    const traversedFiles = fileListArray.map(file => ({
                        file,
                        name: file.name,
                        fullPath: file.name,
                        size: file.size,
                        type: file.type,
                        lastModified: file.lastModified
                    }));
                    // Handle the upload
                    handleFileUpload(traversedFiles);
                    return;
                }
                // If we get here, we couldn't process any files
                alert('Unable to process the dropped files. Please try dragging files directly from your file manager.');
                return;
            }
        }
        catch (error) {
            alert('Failed to handle file drop. Please try again.');
        }
    };
    // Process items with modern FileSystemHandle API
    const processItemsWithModernAPI = async (items) => {
        const allFiles = [];
        let hasHandles = false;
        // This must be done synchronously within the event handler
        for (const item of Array.from(items)) {
            if (item.getAsFileSystemHandle) {
                try {
                    // This is the critical part - we must call getAsFileSystemHandle synchronously
                    const handlePromise = item.getAsFileSystemHandle();
                    const handle = await handlePromise;
                    hasHandles = true;
                    if (handle) {
                        // Import the helper functions
                        const { isFileSystemFileHandle, isFileSystemDirectoryHandle, traverseDirectoryWithHandle } = await import('@/features/explorer/lib/folderTraversal');
                        if (isFileSystemFileHandle(handle)) {
                            try {
                                const file = await handle.getFile();
                                allFiles.push({
                                    file,
                                    name: file.name,
                                    fullPath: file.name,
                                    size: file.size,
                                    type: file.type,
                                    lastModified: file.lastModified
                                });
                            }
                            catch (error) {
                            }
                        }
                        else if (isFileSystemDirectoryHandle(handle)) {
                            try {
                                // For directories, traverse recursively
                                const files = await traverseDirectoryWithHandle(handle, handle.name);
                                allFiles.push(...files);
                            }
                            catch (error) {
                            }
                        }
                    }
                }
                catch (error) {
                }
            }
        }
        return hasHandles ? allFiles : null;
    };
    // Process items with legacy Entry API
    const processItemsWithLegacyAPI = async (items) => {
        const allFiles = [];
        let hasEntries = false;
        // This must be done synchronously within the event handler
        for (const item of Array.from(items)) {
            if ('webkitGetAsEntry' in item) {
                try {
                    // This is the critical part - we must call webkitGetAsEntry synchronously
                    const entry = item.webkitGetAsEntry();
                    hasEntries = true;
                    if (entry) {
                        if (entry.isFile) {
                            try {
                                const file = await new Promise((resolve, reject) => {
                                    entry.file(resolve, reject);
                                });
                                const fullPath = entry.fullPath && entry.fullPath.length > 1
                                    ? entry.fullPath.substring(1) // Remove leading slash
                                    : entry.name;
                                allFiles.push({
                                    file,
                                    name: file.name,
                                    fullPath,
                                    size: file.size,
                                    type: file.type,
                                    lastModified: file.lastModified
                                });
                            }
                            catch (error) {
                                console.warn(`Failed to get file from entry:`, error);
                            }
                        }
                        else if (entry.isDirectory) {
                            try {
                                // Import the traversal function
                                const { traverseDirectoryWithEntry } = await import('@/features/explorer/lib/folderTraversal');
                                // For directories, traverse recursively
                                const basePath = entry.fullPath && entry.fullPath.length > 1
                                    ? entry.fullPath.substring(1) // Remove leading slash
                                    : entry.name;
                                const files = await traverseDirectoryWithEntry(entry, basePath);
                                allFiles.push(...files);
                            }
                            catch (error) {
                                console.warn(`Failed to traverse directory:`, error);
                            }
                        }
                    }
                }
                catch (error) {
                    console.warn('Error getting Entry:', error);
                }
            }
        }
        return hasEntries ? allFiles : null;
    };
    // Traverse directory using FileSystemDirectoryHandle (Modern API)
    const traverseDirectoryWithHandle = async (handle, basePath = '') => {
        const files = [];
        try {
            // Using entries() to iterate through directory contents
            for await (const [name, entry] of handle.entries()) {
                const fullPath = basePath ? `${basePath}/${name}` : name;
                if (entry.kind === 'file') {
                    try {
                        const file = await entry.getFile();
                        files.push({
                            file,
                            name: file.name,
                            fullPath,
                            size: file.size,
                            type: file.type,
                            lastModified: file.lastModified
                        });
                    }
                    catch (error) {
                        console.warn(`Failed to get file ${fullPath}:`, error);
                    }
                }
                else if (entry.kind === 'directory') {
                    try {
                        const subFiles = await traverseDirectoryWithHandle(entry, fullPath);
                        files.push(...subFiles);
                    }
                    catch (error) {
                        console.warn(`Failed to traverse directory ${fullPath}:`, error);
                    }
                }
            }
        }
        catch (error) {
            console.warn(`Failed to read directory entries for ${handle.name}:`, error);
        }
        return files;
    };
    // Traverse directory using DirectoryEntry (Legacy API)
    const traverseDirectoryWithEntry = async (entry, basePath = '') => {
        const files = [];
        try {
            const reader = entry.createReader();
            const entries = await new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });
            for (const childEntry of entries) {
                const fullPath = basePath ? `${basePath}/${childEntry.name}` : childEntry.name;
                if (childEntry.isFile) {
                    try {
                        const file = await new Promise((resolve, reject) => {
                            childEntry.file(resolve, reject);
                        });
                        const finalFullPath = basePath ? `${basePath}/${childEntry.name}` : childEntry.name;
                        files.push({
                            file,
                            name: file.name,
                            fullPath: finalFullPath,
                            size: file.size,
                            type: file.type,
                            lastModified: file.lastModified
                        });
                    }
                    catch (error) {
                    }
                }
                else if (childEntry.isDirectory) {
                    try {
                        const subFiles = await traverseDirectoryWithEntry(childEntry, fullPath);
                        files.push(...subFiles);
                    }
                    catch (error) {
                    }
                }
            }
        }
        catch (error) {
        }
        return files;
    };
    // Handle drag over event for items
    const handleItemDragOver = (e, targetItem) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget(targetItem);
    };
    // Handle drop event on items
    const handleItemDrop = (e, targetItem) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            if (!draggedItem || targetItem.type !== "folder" || draggedItem.name === targetItem.name) {
                // Clear drag state even if we can't move the item
                setDraggedItem(null);
                return;
            }
            // Pass the target item (folder) to onMove instead of just the name
            onMove(draggedItem, targetItem);
            setDraggedItem(null);
        }
        catch (error) {
            // Clear drag state on error
            setDraggedItem(null);
            alert('Failed to move item. Please try again.');
        }
    };
    const getFileIcon = (item) => {
        // For folders, use the Folder icon directly
        if (item.type === "folder") {
            // Use smaller icons for list view
            const folderIconSize = viewMode === 'list' ? 'w-4 h-4' : 'w-14 h-14 sm:w-16 sm:h-16';
            return <Folder className={`${folderIconSize} text-primary`}/>;
        }
        // Use the new Thumbnail component with pre-loaded data for better performance
        const thumbnailData = item.thumbnail ? loadedThumbnails[item.thumbnail] : undefined;
        const loadingState = item.thumbnail ? loadingStates[item.thumbnail] : undefined;
        return <Thumbnail item={item} size={viewMode === 'list' ? 'sm' : 'lg'} thumbnailSrc={thumbnailData} loadingState={loadingState}/>;
    };
    // Format file size in a human-readable format
    const formatFileSize = (bytes) => {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    // Add functions to trigger file/directory uploads
    const triggerFileUpload = () => {
        fileInputRef.current?.click();
    };
    const triggerDirectoryUpload = () => {
        directoryInputRef.current?.click();
    };
    return (<div className="flex-1 flex flex-col bg-background select-none min-h-0 overflow-hidden" data-drag-container onDragOver={handleFileDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleFileDrop}>
      {/* Hidden file input for regular file uploads */}
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleFileUpload(e.target.files);
                // Reset the input
                e.target.value = '';
            }
        }}/>
      
      {/* Hidden directory input for directory uploads */}
      <input type="file" ref={directoryInputRef} className="hidden" multiple {...{ webkitdirectory: "true" }}
     onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
                setIsDirectoryUpload(true);
                handleFileUpload(e.target.files);
                // Reset the input
                e.target.value = '';
                setIsDirectoryUpload(false);
            }
        }}/>
      
      {/* Upload Progress Widget */}
      {uploadingFiles && (<UploadProgressWidget files={uploadingFiles} currentPath={currentApiPath || `/${currentFolder}`} isDirectoryUpload={isDirectoryUpload} uploadProgress={uploadProgressMap} onComplete={() => {
                setUploadingFiles(null);
                setUploadProgressMap({});
                setIsDirectoryUpload(false);
                // Refresh the file list if a refresh function is provided
                if (onRefresh) {
                    onRefresh();
                }
                // Show success message through UI feedback
                console.log('Upload process completed and widget closed');
            }} onCancel={() => {
                setUploadingFiles(null);
                setUploadProgressMap({});
                setIsDirectoryUpload(false);
            }}/>)}
      
      <div className={`flex-1 overflow-y-auto overflow-x-hidden p-4 pb-28 sm:pb-20 min-h-0 custom-scrollbar ${isDragActive ? 'bg-primary/5 border-2 border-dashed border-primary rounded-lg' : ''}`} onClick={(e) => {
            const target = e.target;
            if (target === e.currentTarget || target.getAttribute('data-grid-background') === "true") {
                setSelectedItems(new Set());
                setLastSelectedIndex(null);
                setFocusedIndex(null);
            }
        }} onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Additional prevention of default context menu
            e.nativeEvent.preventDefault();
            if (isEffectiveInboxMode) {
                return;
            }
            // Show context menu for empty area
            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                itemType: "empty",
                itemName: "",
                item: { name: "", type: "folder", icon: "" },
                index: -1,
            });
        }}>
        {/* Upload indicator when dragging files over */}
        {isDragActive && (<div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg z-50 pointer-events-none border-2 border-dashed border-primary">
            <div className="text-center p-6 bg-background rounded-lg shadow-lg pointer-events-auto border border-border">
              <Folder className="w-10 h-10 text-primary mx-auto mb-2"/>
              <p className="text-lg font-semibold text-foreground">Drop files here to upload</p>
              <p className="text-muted-foreground">Upload to {currentFolder}</p>
            </div>
          </div>)}

        {/* Modernized Floating Selection Action Bar */}
        {selectedItems.size > 0 && (<div className="sticky top-1 z-30 mb-3 flex items-center justify-between gap-2 px-3 py-2 bg-card/95 dark:bg-card/90 backdrop-blur-md border border-border/70 rounded-xl shadow-lg ring-1 ring-border/20 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button type="button" onClick={() => {
                setSelectedItems(new Set());
                setLastSelectedIndex(null);
            }} className="p-1.5 rounded-lg hover:bg-accent active:bg-accent/80 text-muted-foreground hover:text-foreground transition-colors" title="Clear selection (Esc)" aria-label="Clear selection">
                <X className="w-4 h-4"/>
              </button>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/20 shrink-0">
                {selectedItems.size} selected
              </span>
              <div className="h-4 w-px bg-border/60 hidden sm:block"/>
              <button type="button" onClick={handleSelectAllToggle} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors hidden sm:inline-block">
                {selectedItems.size === items.length ? "Deselect all" : "Select all"}
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={handleBatchDownload} disabled={selectedFilesCount === 0} className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground border border-border/50 hover:border-border transition-all shadow-xs active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed" title="Download selected files">
                <Download className="w-3.5 h-3.5"/>
                <span className="hidden sm:inline">Download</span>
                {selectedFilesCount > 0 && <span className="text-[11px] text-muted-foreground">({selectedFilesCount})</span>}
              </button>

              <button type="button" onClick={() => {
                const selectedList = items.filter(it => selectedItems.has(getItemKey(it)));
                if (selectedList.length > 0)
                    onCut(selectedList);
            }} className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground border border-border/50 hover:border-border transition-all shadow-xs active:scale-[0.98]" title="Cut selected items (Ctrl+X)">
                <Scissors className="w-3.5 h-3.5"/>
                <span className="hidden sm:inline">Cut</span>
                <span className="text-[11px] text-muted-foreground">({selectedItems.size})</span>
              </button>

              <button type="button" onClick={() => {
                const selectedList = items.filter(it => selectedItems.has(getItemKey(it)));
                if (selectedList.length > 0)
                    onCopy(selectedList);
            }} className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground border border-border/50 hover:border-border transition-all shadow-xs active:scale-[0.98]" title="Copy selected items (Ctrl+C)">
                <Copy className="w-3.5 h-3.5"/>
                <span className="hidden sm:inline">Copy</span>
                <span className="text-[11px] text-muted-foreground">({selectedItems.size})</span>
              </button>

              {selectedItems.size === 1 && (<button type="button" onClick={() => {
                    const selectedKey = Array.from(selectedItems)[0];
                    const found = items.find(i => getItemKey(i) === selectedKey);
                    if (found) {
                        setPropertiesItem(found);
                    }
                }} className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground border border-border/50 hover:border-border transition-all shadow-xs active:scale-[0.98]" title="View Properties (Alt+Enter)">
                  <Info className="w-3.5 h-3.5"/>
                  <span className="hidden sm:inline">Properties</span>
                </button>)}

              <button type="button" onClick={() => setBatchDeleteDialogOpen(true)} className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 transition-all shadow-xs active:scale-[0.98]" title="Delete selected items">
                <Trash2 className="w-3.5 h-3.5"/>
                <span className="hidden sm:inline">Delete</span>
                <span className="text-[11px]">({selectedItems.size})</span>
              </button>
            </div>
          </div>)}
        
        {isLoading ? (<div className="flex-1 flex items-center justify-center min-h-[350px]">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          </div>) : items.length === 0 ? (<div className="flex-1 flex flex-col items-center justify-center min-h-[320px] text-center p-6 select-none pointer-events-none">
            <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-3 text-2xl shadow-inner">
              <Folder className="w-7 h-7 text-muted-foreground/60"/>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No items found</h3>
            <p className="text-xs text-muted-foreground max-w-xs">
              No files or folders match your search or filter criteria in this view.
            </p>
          </div>) : viewMode === "grid" ? (<div ref={gridContainerRef} role="grid" aria-label="Files and folders grid" tabIndex={-1} data-grid-background="true" className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9 2xl:grid-cols-12 gap-2 sm:gap-1.5 focus:outline-none">
            {items.map((item, index) => {
                const itemKey = getItemKey(item);
                const isRenaming = renamingItem?.index === index;
                const isDragging = (draggedItem?.id && item.id) ? draggedItem.id === item.id : draggedItem?.name === item.name;
                const isCut = Boolean((cutItems && cutItems.some(ci => (ci.id && item.id ? ci.id === item.id : ci.name === item.name))) ||
                    (cutItem && (cutItem.id && item.id ? cutItem.id === item.id : cutItem.name === item.name)));
                const isSelected = selectedItems.has(itemKey);
                const isFocused = index === focusedIndex;
                const starred = isItemStarred(item);
                const duration = isVideoItem(item) ? getItemDuration(item) : null;
                return (<div key={itemKey || index} ref={(el) => { itemElementsRef.current[index] = el; }} role="row" tabIndex={index === (focusedIndex ?? 0) ? 0 : -1} aria-selected={isSelected} aria-label={`${item.name}, ${item.type === 'folder' ? 'Folder' : (item.fileType || 'File')}${isSelected ? ', selected' : ''}`} data-grid-item="true" data-item-index={index} onFocus={() => setFocusedIndex(index)} draggable={!isRenaming} onDragStart={(e) => handleDragStart(e, item)} onDragEnd={handleDragEnd} onDragOver={item.type === "folder" ? (e) => handleItemDragOver(e, item) : undefined} onDrop={item.type === "folder" ? (e) => handleItemDrop(e, item) : undefined} onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Additional prevention of default context menu
                        e.nativeEvent.preventDefault();
                        if (!isRenaming) {
                            if (!selectedItems.has(itemKey)) {
                                setSelectedItems(new Set([itemKey]));
                                setLastSelectedIndex(index);
                            }
                            setFocusedIndex(index);
                            handleContextMenu(e, item, index);
                        }
                    }} onTouchStart={(e) => handleTouchStart(e, item, index)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onClick={(e) => {
                        if (!isRenaming) {
                            handleItemClick(e, item, index);
                        }
                    }} onDoubleClick={(e) => {
                        if (!isRenaming) {
                            e.preventDefault();
                            e.stopPropagation();
                            setFocusedIndex(index);
                            handleItemOpen(item);
                        }
                    }} className={`group relative flex flex-col items-center p-2 sm:p-1.5 rounded-xl sm:rounded-lg border transition-all duration-200 cursor-pointer select-none outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
                    ${isSelected
                        ? "bg-primary/15 dark:bg-primary/25 border-primary ring-2 ring-primary/30 shadow-sm"
                        : isFocused
                            ? "border-primary/60 bg-accent/30 ring-2 ring-primary/50 shadow-sm"
                            : "border-transparent hover:border-border/40 hover:bg-accent/20 hover:scale-[1.02] hover:shadow-md"}
                    active:scale-[0.98] 
                    ${isDragging ? "opacity-50 scale-95" : ""}
                    ${isCut ? "opacity-50" : ""}
                    ${item.type === "folder" && draggedItem && draggedItem.name !== item.name
                        ? "scale-105 transition-all duration-200 ring-2 ring-primary/50"
                        : ""}`}>
                  <div role="gridcell" className="contents">
                  {/* Google Drive circular checkbox */}
                  {!isRenaming && (<button type="button" onClick={(e) => handleCheckboxClick(e, item, index)} className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center transition-all z-20 ${isSelected
                            ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-background scale-100 opacity-100"
                            : selectedItems.size > 0
                                ? "border-2 border-muted-foreground/70 bg-background/90 hover:border-primary hover:bg-background opacity-80 sm:opacity-75 hover:opacity-100 focus:opacity-100"
                                : "border-2 border-muted-foreground/40 bg-background/80 hover:border-primary opacity-0 group-hover:opacity-90 focus:opacity-100"}`} title={isSelected ? "Deselect" : "Select"} aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}>
                      <Check className={`w-3 h-3 stroke-[3] transition-opacity ${isSelected ? "opacity-100" : "opacity-0"}`}/>
                    </button>)}

                  {/* Star or Restore button */}
                  {!isRenaming && (isTrashMode ? (<button type="button" onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRestoreItem?.(item);
                        }} className="absolute top-1.5 right-7.5 p-1 rounded-full bg-background/80 dark:bg-card/85 backdrop-blur-xs border border-border/40 shadow-xs text-primary hover:text-primary/80 hover:bg-background active:bg-accent transition-colors z-10" title="Restore" aria-label="Restore">
                        <RotateCcw className="w-3.5 h-3.5"/>
                      </button>) : (<button type="button" onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleStar?.(item);
                        }} className={`absolute top-1.5 right-7.5 p-1 rounded-full bg-background/80 dark:bg-card/85 backdrop-blur-xs border border-border/40 shadow-xs transition-all z-10 ${starred
                            ? "text-amber-500 dark:text-amber-400 opacity-100"
                            : "text-muted-foreground hover:text-amber-500 dark:hover:text-amber-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`} title={starred ? "Remove from starred" : "Add to starred"} aria-label={starred ? "Remove from starred" : "Add to starred"}>
                        <Star className={`w-3.5 h-3.5 ${starred ? "fill-amber-500 dark:fill-amber-400 text-amber-500 dark:text-amber-400" : ""}`}/>
                      </button>))}

                  {/* 3-dots action button for touch access */}
                  {!isRenaming && (<button type="button" onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openItemContextMenu(item, index, e.clientX, e.clientY);
                        }} className="absolute top-1.5 right-1.5 p-1 rounded-full bg-background/80 dark:bg-card/85 backdrop-blur-xs border border-border/40 shadow-xs text-muted-foreground hover:text-foreground hover:bg-background active:bg-accent transition-colors z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100" title="Options" aria-label="Options">
                      <MoreVertical className="w-3.5 h-3.5"/>
                    </button>)}

                  <div className="flex flex-col items-center w-full rounded-md p-1 transition-all duration-200 pointer-events-none">
                    <div className="relative w-full aspect-[4/3] max-h-24 sm:max-h-28 rounded-lg bg-muted/20 flex items-center justify-center overflow-hidden mb-1.5">
                      {getFileIcon(item)}
                      {duration && (
                        <span data-testid="duration-badge" className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-white font-mono font-medium leading-none pointer-events-none shadow-sm backdrop-blur-xs">
                          {duration}
                        </span>
                      )}
                    </div>
                    {isRenaming ? (<div className="pointer-events-auto w-full" onClick={(e) => e.stopPropagation()}>
                        <RenameInput initialName={item.name} onSave={onRenameConfirm} onCancel={onRenameCancel}/>
                      </div>) : (<span className={`text-xs text-center break-words w-full line-clamp-2 transition-colors ${isSelected ? "font-semibold text-primary" : "text-foreground group-hover:text-accent-foreground"}`}>
                        {item.name}
                      </span>)}
                  </div>
                  </div>
                </div>);
            })}
          </div>) : (<div ref={listContainerRef} role="grid" aria-label="Files and folders list" tabIndex={-1} data-grid-background="true" className="flex flex-col focus:outline-none">
            {/* Table header - hidden on small mobile screens */}
            <div role="row" className="hidden md:grid grid-cols-12 gap-3 px-3 py-1 text-xs font-medium text-muted-foreground border-b border-border bg-muted/40 items-center">
              <div role="columnheader" className="col-span-5 flex items-center gap-2.5">
                <button type="button" onClick={handleSelectAllToggle} className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${selectedItems.size === items.length && items.length > 0
                ? "bg-primary border-primary text-primary-foreground"
                : selectedItems.size > 0
                    ? "bg-primary/20 border-primary text-primary"
                    : "border-muted-foreground/40 hover:border-foreground"}`} title={selectedItems.size === items.length ? "Deselect all" : "Select all"}>
                  <Check className={`w-2.5 h-2.5 stroke-[3] ${selectedItems.size > 0 ? "opacity-100" : "opacity-0"}`}/>
                </button>
                <span>Name</span>
              </div>
              <div role="columnheader" className="col-span-3">Modified Date</div>
              <div role="columnheader" className="col-span-2">Type</div>
              <div role="columnheader" className="col-span-2 text-right">Size</div>
            </div>
            <div className="space-y-1 sm:space-y-0.5">
              {items.map((item, index) => {
                const itemKey = getItemKey(item);
                const isRenaming = renamingItem?.index === index;
                const isDragging = (draggedItem?.id && item.id) ? draggedItem.id === item.id : draggedItem?.name === item.name;
                const isCut = Boolean((cutItems && cutItems.some(ci => (ci.id && item.id ? ci.id === item.id : ci.name === item.name))) ||
                    (cutItem && (cutItem.id && item.id ? cutItem.id === item.id : cutItem.name === item.name)));
                const isSelected = selectedItems.has(itemKey);
                const isFocused = index === focusedIndex;
                const starred = isItemStarred(item);
                return (<div key={itemKey || index} ref={(el) => { itemElementsRef.current[index] = el; }} role="row" tabIndex={index === (focusedIndex ?? 0) ? 0 : -1} aria-selected={isSelected} aria-label={`${item.name}, ${item.type === 'folder' ? 'Folder' : (item.fileType || 'File')}${isSelected ? ', selected' : ''}`} data-grid-item="true" data-item-index={index} onFocus={() => setFocusedIndex(index)} draggable={!isRenaming} onDragStart={(e) => handleDragStart(e, item)} onDragEnd={handleDragEnd} onDragOver={item.type === "folder" ? (e) => handleItemDragOver(e, item) : undefined} onDrop={item.type === "folder" ? (e) => handleItemDrop(e, item) : undefined} onContextMenu={(e) => {
                        if (!isRenaming) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!selectedItems.has(itemKey)) {
                                setSelectedItems(new Set([itemKey]));
                                setLastSelectedIndex(index);
                            }
                            setFocusedIndex(index);
                            handleContextMenu(e, item, index);
                        }
                    }} onTouchStart={(e) => handleTouchStart(e, item, index)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onClick={(e) => {
                        if (!isRenaming) {
                            handleItemClick(e, item, index);
                        }
                    }} onDoubleClick={(e) => {
                        if (!isRenaming) {
                            e.preventDefault();
                            e.stopPropagation();
                            setFocusedIndex(index);
                            handleItemOpen(item);
                        }
                    }} className={`group transition-all duration-200 cursor-pointer select-none outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${isSelected
                        ? "bg-primary/15 dark:bg-primary/25 border-primary ring-1 ring-primary/30 rounded-lg sm:rounded"
                        : isFocused
                            ? "bg-accent/35 border-primary/50 ring-1 ring-primary/50 rounded-lg sm:rounded"
                            : "hover:bg-accent/40 rounded-lg sm:rounded border border-transparent"} ${isDragging ? "opacity-50" : ""}
                      ${isCut ? "opacity-50" : ""}
                      ${item.type === "folder" && draggedItem && draggedItem.name !== item.name
                        ? "scale-[1.01] ring-2 ring-primary/50"
                        : ""}`}>
                    {/* Desktop table row (md and above): dense 32px height */}
                    <div className="hidden md:grid col-span-12 w-full grid-cols-12 gap-3 px-3 h-8 items-center text-xs">
                      <div role="gridcell" className="col-span-5 flex items-center gap-2.5 min-w-0">
                        {!isRenaming && (<button type="button" onClick={(e) => handleCheckboxClick(e, item, index)} className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-all flex-shrink-0 ${isSelected
                            ? "bg-primary text-primary-foreground border border-primary"
                            : selectedItems.size > 0
                                ? "border border-muted-foreground/60 bg-background/80 hover:border-primary opacity-80"
                                : "border border-muted-foreground/40 bg-background/60 hover:border-primary opacity-0 group-hover:opacity-100 focus:opacity-100"}`} title={isSelected ? "Deselect" : "Select"} aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}>
                            <Check className={`w-2.5 h-2.5 stroke-[3] ${isSelected ? "opacity-100" : "opacity-0"}`}/>
                          </button>)}
                        <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center pointer-events-none">{getFileIcon(item)}</div>
                        {isRenaming ? (<div className="flex-1 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                            <RenameInput initialName={item.name} onSave={onRenameConfirm} onCancel={onRenameCancel}/>
                          </div>) : (<span className={`truncate pointer-events-none ${isSelected ? "font-medium text-primary" : "text-foreground group-hover:text-accent-foreground"}`}>
                            {item.name}
                          </span>)}
                        {starred && (
                          <Star className="w-3 h-3 fill-amber-500 dark:fill-amber-400 text-amber-500 dark:text-amber-400 shrink-0 pointer-events-none"/>
                        )}
                      </div>
                      <div role="gridcell" className="col-span-3 flex items-center text-muted-foreground pointer-events-none truncate">
                        {item.modified ? new Date(item.modified).toLocaleDateString() : ''}
                      </div>
                      <div role="gridcell" className="col-span-2 flex items-center text-muted-foreground capitalize pointer-events-none truncate">
                        {item.type === 'folder' ? 'Folder' : (item.fileType || 'File')}
                      </div>
                      <div role="gridcell" className="col-span-2 flex items-center justify-end text-muted-foreground pointer-events-none truncate">
                        {item.type === 'folder' ? '' : (item.size ? formatFileSize(item.size) : '')}
                      </div>
                    </div>

                    {/* Mobile optimized list row (< md): comfortable touch target */}
                    <div role="gridcell" className="md:hidden flex items-center justify-between min-h-[44px] p-2.5 rounded-xl gap-3 border border-border/30">
                      {/* Selection checkbox */}
                      {!isRenaming && (<button type="button" onClick={(e) => handleCheckboxClick(e, item, index)} className={`w-5 h-5 rounded-full flex items-center justify-center transition-all shrink-0 ${isSelected
                            ? "bg-primary text-primary-foreground ring-1 ring-background scale-100 opacity-100"
                            : selectedItems.size > 0
                                ? "border-2 border-muted-foreground/70 bg-background/90 hover:border-primary opacity-90"
                                : "border-2 border-muted-foreground/40 bg-background/70 opacity-0 group-hover:opacity-70 w-0 p-0 border-0 overflow-hidden"}`} title={isSelected ? "Deselect" : "Select"} aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}>
                          <Check className={`w-3 h-3 stroke-[3] ${isSelected ? "opacity-100" : "opacity-0"}`}/>
                        </button>)}

                      <div className="flex items-center gap-3 min-w-0 flex-1 pointer-events-none">
                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                          {getFileIcon(item)}
                        </div>
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (<div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                              <RenameInput initialName={item.name} onSave={onRenameConfirm} onCancel={onRenameCancel}/>
                            </div>) : (<>
                              <p className={`text-sm font-medium truncate ${isSelected ? "text-primary" : "text-foreground"}`}>
                                {item.name}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {item.type === 'folder'
                            ? 'Folder'
                            : `${item.size ? formatFileSize(item.size) : ''}${item.size && item.modified ? ' • ' : ''}${item.modified ? new Date(item.modified).toLocaleDateString() : ''}`}
                              </p>
                            </>)}
                        </div>
                      </div>

                      {!isRenaming && (<div className="flex items-center gap-1 shrink-0 z-10">
                          {isTrashMode ? (<button type="button" onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onRestoreItem?.(item);
                            }} className="p-1.5 sm:p-2 rounded-full text-primary hover:text-primary/80 hover:bg-accent active:bg-accent/80 transition-colors" title="Restore" aria-label="Restore">
                              <RotateCcw className="w-4 h-4"/>
                            </button>) : (<button type="button" onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onToggleStar?.(item);
                            }} className={`p-1.5 sm:p-2 rounded-full transition-colors ${starred
                                ? "text-amber-500 dark:text-amber-400 opacity-100"
                                : "text-muted-foreground hover:text-amber-500 dark:hover:text-amber-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`} title={starred ? "Remove from starred" : "Add to starred"} aria-label={starred ? "Remove from starred" : "Add to starred"}>
                              <Star className={`w-4 h-4 ${starred ? "fill-amber-500 dark:fill-amber-400 text-amber-500 dark:text-amber-400" : ""}`}/>
                            </button>)}
                          <button type="button" onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openItemContextMenu(item, index, e.clientX, e.clientY);
                        }} className="p-1.5 sm:p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80" title="Options" aria-label="Options">
                            <MoreVertical className="w-4 h-4"/>
                          </button>
                        </div>)}
                    </div>
                  </div>);
            })}
            </div>
          </div>)}
      </div>

      {/* Context Menu */}
      {contextMenu && (() => {
            const cmExt = (contextMenu.item?.extension || contextMenu.item?.name?.split('.').pop() || '').toLowerCase();
            const isArchiveItem = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z'].includes(cmExt);
            const isVideo = contextMenu.item ? isVideoItem(contextMenu.item) : false;
            const selectedCount = selectedItems.size > 0 ? selectedItems.size : 1;
            return (<ContextMenu x={contextMenu.x} y={contextMenu.y} itemType={contextMenu.itemType} itemName={contextMenu.itemName} isVideo={isVideo} onCopyStreamUrl={() => {
                    if (!contextMenu.item)
                        return;
                    if (isCloudMode) {
                        const streamUrl = api.getCloudStreamUrl(cloudAccountId || contextMenu.item.cloud_account_id, contextMenu.item.cloud_file_id || contextMenu.item.id);
                        navigator.clipboard.writeText(streamUrl);
                        toast.success("Cloud streaming URL copied to clipboard");
                    }
                    else {
                        copyStreamUrl(contextMenu.item.name);
                    }
                }} onOpen={() => contextMenu.item && handleItemOpen(contextMenu.item)} onCopy={() => {
                    if (!contextMenu.item)
                        return;
                    const itemKey = getItemKey(contextMenu.item);
                    if (selectedItems.size > 1 && selectedItems.has(itemKey)) {
                        const multi = items.filter(it => selectedItems.has(getItemKey(it)));
                        onCopy(multi);
                    }
                    else {
                        onCopy(contextMenu.item);
                    }
                }} onCut={() => {
                    if (!contextMenu.item)
                        return;
                    const itemKey = getItemKey(contextMenu.item);
                    if (selectedItems.size > 1 && selectedItems.has(itemKey)) {
                        const multi = items.filter(it => selectedItems.has(getItemKey(it)));
                        onCut(multi);
                    }
                    else {
                        onCut(contextMenu.item);
                    }
                }} onPaste={onPaste} onDelete={() => contextMenu.item && onDelete(contextMenu.item, contextMenu.index)} onRename={() => contextMenu.item && onRename(contextMenu.item, contextMenu.index)} onNewFolder={onNewFolder} onDownload={() => contextMenu.item && onDownload(contextMenu.item)} onUploadFiles={triggerFileUpload} // Use the trigger function
             onUploadFolder={triggerDirectoryUpload} // Use the trigger function
             onClose={() => setContextMenu(null)} hasClipboard={hasClipboard} isClipboardPasted={isClipboardPasted} disableDelete={
                // Disable delete for specific virtual folders in Home
                Boolean(currentPath && currentPath.length === 1 &&
                    currentPath[0] === "Home" &&
                    ["Images", "Documents", "Audio", "Voice Messages", "Videos"].includes(contextMenu.itemName))} onProperties={() => contextMenu.item && setPropertiesItem(contextMenu.item)} isArchive={isArchiveItem} selectedCount={selectedCount} isVaultMode={isVaultMode} onMoveToVault={() => contextMenu.item && onMoveToVault?.(contextMenu.item)} onMoveToHome={() => contextMenu.item && onMoveToHome?.(contextMenu.item)} onInspectArchive={() => {
                    if (contextMenu.item) {
                        setArchiveInspect({
                            fileId: getItemKey(contextMenu.item),
                            fileName: contextMenu.item.name,
                        });
                    }
                }} onExtractArchive={async () => {
                    if (contextMenu.item) {
                        const targetItem = contextMenu.item;
                        try {
                            const baseUrl = getApiBaseUrl();
                            const res = await fetchWithTimeout(`${baseUrl ? baseUrl : ""}/api/archive/extract`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    file_id: getItemKey(targetItem),
                                    target_path: currentApiPath || (currentPath ? `/${currentPath.join('/')}` : "/Home")
                                })
                            }, 15000);
                            if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                throw new Error(err.detail || `Extraction request failed (${res.status})`);
                            }
                            const data = await res.json();
                            if (data.task_id) {
                                trackArchiveTask(data.task_id, "extract", targetItem.name, onRefresh);
                            }
                            else {
                                toast.success(`Extracted directly into Telegram cloud!`);
                                if (onRefresh)
                                    onRefresh();
                            }
                        }
                        catch (e) {
                            toast.error(e.message || "Cloud extraction failed");
                        }
                    }
                }} onCompress={() => {
                    setCompressDialog(true);
                }} isStarred={isItemStarred(contextMenu.item)} onToggleStar={() => contextMenu.item && onToggleStar?.(contextMenu.item)} isTrashMode={isTrashMode || cloudFolderId === "trash" || Boolean(contextMenu.item?.is_trashed)} onRestore={() => contextMenu.item && onRestoreItem?.(contextMenu.item)} isCloudMode={isCloudMode} isVirtualFolder={Boolean(contextMenu.item?.is_virtual)} isRestrictedEmptyArea={isRestrictedEmptyArea}/>);
        })()}

      {/* Image Viewer */}
      <Suspense fallback={null}>
      {imageViewer && (<ImageViewer imageUrl={imageViewer.imageUrl} fileName={imageViewer.fileName} images={imageViewer.images} initialIndex={imageViewer.initialIndex} onClose={() => setImageViewer(null)}/>)}

      {/* Universal Document & E-Book Reader Modal */}
      {documentReader && (<DocumentReaderModal url={documentReader.url} fileName={documentReader.fileName} fileExtension={documentReader.extension} onClose={() => setDocumentReader(null)}/>)}

      {/* Archive Inspector Dialog */}
      {archiveInspect && (<ArchiveInspectDialog isOpen={Boolean(archiveInspect)} onClose={() => setArchiveInspect(null)} fileId={archiveInspect.fileId} fileName={archiveInspect.fileName} currentPath={currentApiPath || (currentPath ? `/${currentPath.join('/')}` : "/Home")} onExtractSuccess={() => {
                if (onRefresh)
                    onRefresh();
            }}/>)}
      </Suspense>

      {/* Cloud Archive Compress Dialog */}
      {compressDialog && (<CompressDialog isOpen={compressDialog} onClose={() => setCompressDialog(false)} selectedItemIds={selectedItems.size > 0
                ? Array.from(selectedItems)
                : contextMenu?.item
                    ? [getItemKey(contextMenu.item)]
                    : []} selectedItemNames={selectedItems.size > 0
                ? items.filter((it) => selectedItems.has(getItemKey(it))).map((it) => it.name)
                : contextMenu?.item
                    ? [contextMenu.item.name]
                    : []} currentPath={currentApiPath || (currentPath ? `/${currentPath.join('/')}` : "/Home")} onCompressSuccess={() => {
                if (onRefresh)
                    onRefresh();
            }}/>)}

      {/* Telegram Verification Dialog */}
      <TelegramVerificationDialog open={showTelegramVerificationDialog} onOpenChange={setShowTelegramVerificationDialog}/>

      {/* Index Chat Dialog */}
      <IndexChatDialog open={showIndexChatDialog} onOpenChange={setShowIndexChatDialog}/>

      {/* Batch Delete Confirmation Dialog */}
      <AlertDialog open={batchDeleteDialogOpen} onOpenChange={setBatchDeleteDialogOpen}>
        <AlertDialogContent className="bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-2xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isTrashMode
            ? `Permanently delete ${selectedItems.size} ${selectedItems.size === 1 ? 'item' : 'items'}?`
            : `Move ${selectedItems.size} ${selectedItems.size === 1 ? 'item' : 'items'} to Trash?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isTrashMode
            ? `Are you sure you want to permanently delete ${selectedItems.size} selected ${selectedItems.size === 1 ? 'item' : 'items'}? Any selected folders will also have their contents permanently deleted. This action cannot be undone.`
            : `Are you sure you want to move ${selectedItems.size} selected ${selectedItems.size === 1 ? 'item' : 'items'} to Trash? You can restore them later from the Trash.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBatchDeleting} onClick={() => setBatchDeleteDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction disabled={isBatchDeleting} onClick={(e) => {
            e.preventDefault();
            handleConfirmBatchDelete();
        }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isBatchDeleting
            ? "Processing..."
            : isTrashMode
                ? `Delete Forever (${selectedItems.size})`
                : `Move to Trash (${selectedItems.size})`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Properties Dialog */}
      <PropertiesDialog open={propertiesItem !== null} item={propertiesItem} currentPath={currentPath} currentApiPath={currentApiPath} onClose={() => setPropertiesItem(null)} onDownload={onDownload}/>
    </div>);
};
