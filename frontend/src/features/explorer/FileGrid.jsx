import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { Folder, MoreVertical, Check, Info, Star, RotateCcw } from "lucide-react";
import { useMediaPlayer } from "@/features/player/MediaPlayerContext";
import { Thumbnail } from "./Thumbnail";
import { CompressDialog } from "@/features/archives/CompressDialog";
import { UploadProgressWidget } from "@/features/transfers/UploadProgressWidget";
import { TelegramVerificationDialog } from "@/features/auth/TelegramVerificationDialog";
import { IndexChatDialog } from "@/features/explorer/dialogs/IndexChatDialog"; // Add this import
import { FolderPickerModal } from "@/features/explorer/dialogs/FolderPickerModal";
import { SelectionBar } from "./SelectionBar";
import { GridTile, ListHeader, ListRow, GRID_CLASS } from "./items/FileItems";
import { VirtualItems } from "./items/VirtualItems";
import { shouldVirtualize } from "./lib/virtualLayout";
import { createUploadActions } from "./actions/uploadActions";
import { useGridKeyboard } from "./hooks/useGridKeyboard";
import { createOpenItem } from "./actions/openItem";
import { createSelectionActions } from "./actions/selectionActions";
import { GridContextMenu } from "./items/GridContextMenu";
import { DetailsPane } from "./DetailsPane";
import { getSection, getSelectionActions } from "./lib/explorerItems";
import { api } from "@/lib/api";
import { useBatchThumbnailLoader } from "@/features/explorer/hooks/useBatchThumbnailLoader"; // Add this import
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, } from "@/components/ui/alert-dialog";
import authService from "@/features/auth/authService";
import { isItemStarred, getItemKey } from "@/features/explorer/lib/fileCardHelpers";

// Heavy viewers are split into their own chunks and load on first open
const ImageViewer = lazy(() => import("@/features/viewers/ImageViewer").then((m) => ({ default: m.ImageViewer })));
const DocumentReaderModal = lazy(() => import("@/features/viewers/DocumentReaderModal").then((m) => ({ default: m.DocumentReaderModal })));
const ArchiveInspectDialog = lazy(() => import("@/features/archives/ArchiveInspectDialog").then((m) => ({ default: m.ArchiveInspectDialog })));
export const FileGrid = ({ items, viewMode, onNavigate, itemCount, onCopy, onCut, onPaste, onDelete, onRename, onMove, onDownload, renamingItem, onRenameConfirm, onRenameCancel, currentFolder, onNewFolder, onUploadFiles, // Add this
onUploadFolder, // Add this
isLoading, cutItem, cutItems = [], hasClipboard, isClipboardPasted, onFileUploaded, onItemsChange, onRefresh, currentPath, currentApiPath, isTrashMode, onRestoreItem, onToggleStar, isVaultMode = false, onMoveToVault, onMoveToHome, isCloudMode = false, cloudAccountId, cloudFolderId, isInboxMode = false, uploadRequest = null, onUploadRequestHandled, detailsOpen = false, onDetailsOpenChange, onBatch = {}, }) => {
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
    const isStarredView = currentFolder === "Starred" || currentApiPath === "/starred";
    const section = getSection({ isTrash: Boolean(isTrashMode || cloudFolderId === "trash"), isVault: isVaultMode, isInbox: isEffectiveInboxMode, isStarred: isStarredView, isCloud: isCloudMode });
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
    const [movePickerOpen, setMovePickerOpen] = useState(false);
    const [batchBusy, setBatchBusy] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(null);
    const gridContainerRef = useRef(null);
    const listContainerRef = useRef(null);
    const itemElementsRef = useRef([]);
    // Long folders render through VirtualItems; it can scroll unrendered items into view
    const scrollRef = useRef(null);
    const virtualRef = useRef(null);
    const virtual = shouldVirtualize(items.length);
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
        if (focusedIndex === null)
            return;
        if (!itemElementsRef.current[focusedIndex] && virtualRef.current) {
            // Not in the page yet: scroll its row in, then focus it once it renders
            virtualRef.current.scrollToIndex(focusedIndex);
            const index = focusedIndex;
            const timer = setTimeout(() => {
                const el = itemElementsRef.current[index];
                if (el) {
                    try {
                        el.focus({ preventScroll: true });
                    } catch (_) {}
                }
            }, 80);
            return () => clearTimeout(timer);
        }
        if (itemElementsRef.current[focusedIndex]) {
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
        if (virtualRef.current) return virtualRef.current.columns;
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
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
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
    useGridKeyboard(stateRef, { setBatchDeleteDialogOpen, setContextMenu, setFocusedIndex, setIsSelectionMode, setLastSelectedIndex, setSelectedItems });
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
    // The New menu / command palette ask for an upload; open the matching file picker
    useEffect(() => {
        if (!uploadRequest)
            return;
        (uploadRequest.kind === "folder" ? directoryInputRef : fileInputRef).current?.click();
        onUploadRequestHandled?.();
    }, [uploadRequest]); // eslint-disable-line react-hooks/exhaustive-deps -- run once per request
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
    const handleItemOpen = createOpenItem({ cloudAccountId, items, lastOpenTimeRef, onDownload, onNavigate, playMedia, setArchiveInspect, setDocumentReader, setImageViewer, setIsSelectionMode, setLastSelectedIndex, setSelectedItems });
    const openDetails = (item) => {
        const idx = items.findIndex((it) => getItemKey(it) === getItemKey(item));
        if (idx !== -1)
            setFocusedIndex(idx);
        if (selectedItems.size > 0 && !selectedItems.has(getItemKey(item))) {
            setSelectedItems(new Set());
            setLastSelectedIndex(null);
        }
        onDetailsOpenChange?.(true);
    };
    const selectedList = items.filter((it) => selectedItems.has(getItemKey(it)));
    const detailsItem = selectedList.length === 1 ? selectedList[0]
        : selectedList.length > 1 ? null
            : (focusedIndex !== null ? items[focusedIndex] || null : null);
    const clearSelection = () => {
        setSelectedItems(new Set());
        setLastSelectedIndex(null);
        setIsSelectionMode(false);
    };
    const runBatch = async (fn, list) => {
        if (!fn || list.length === 0)
            return;
        setBatchBusy(true);
        try {
            await fn(list);
            clearSelection();
        }
        finally {
            setBatchBusy(false);
        }
    };
    const handleSelectionAction = (id) => {
        const list = selectedList;
        switch (id) {
            case "download": return handleBatchDownload();
            case "move-to":
            case "file-to": return setMovePickerOpen(true);
            case "copy": return onCopy(list);
            case "cut": return onCut(list);
            case "star": return runBatch((l) => onBatch.setStarred?.(l, true), list);
            case "unstar": return runBatch((l) => onBatch.setStarred?.(l, false), list);
            case "compress": return setCompressDialog(true);
            case "to-vault": return runBatch(onBatch.toVault, list);
            case "to-home": return runBatch(onBatch.toHome, list);
            case "restore": return runBatch(onBatch.restore, list);
            case "details": return list[0] && openDetails(list[0]);
            case "delete":
            case "delete-forever": return setBatchDeleteDialogOpen(true);
            default: return undefined;
        }
    };
    const selectionActions = getSelectionActions(section, { count: selectedList.length, allStarred: selectedList.length > 0 && selectedList.every(isItemStarred) });
    const locationPath = currentApiPath || (currentPath && currentPath.length > 0 ? `/${currentPath.join("/")}` : "/Home");
    const pickerStartPath = /^\/(Home|Vault)(\/|$)/.test(locationPath) ? locationPath : "/Home";
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
        movePickerOpen,
        detailsOpen,
        onDetailsOpenChange,
        openDetails,
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
    const { handleItemClick, handleCheckboxClick, handleSelectAllToggle, handleBatchDownload, handleConfirmBatchDelete } = createSelectionActions({ cloudAccountId, cloudFolderId, currentPath, handleItemOpen, isCloudMode, isLongPressRef, isSelectionMode, isTrashMode, items, lastSelectedIndex, lastTapRef, onDownload, onRefresh, selectedItems, setBatchDeleteDialogOpen, setFocusedIndex, setIsBatchDeleting, setIsSelectionMode, setLastSelectedIndex, setSelectedItems });
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
    const { handleFileUpload, handleDragEnter, handleDragLeave, handleFileDragOver, handleFileDrop, processItemsWithModernAPI, processItemsWithLegacyAPI, traverseDirectoryWithHandle, traverseDirectoryWithEntry } = createUploadActions({ cloudAccountId, cloudFolderId, currentApiPath, currentFolder, currentPath, dragCounter, isCloudMode, isCloudVirtualSection, isEffectiveInboxMode, isRestrictedEmptyArea, isTrashMode, onFileUploaded, onRefresh, setDraggedItem, setIsDragActive, setShowIndexChatDialog, setShowTelegramVerificationDialog, setUploadProgressMap, setUploadingFiles, uploadProgressMap });
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
            toast.error("Failed to move item. Please try again.");
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
    // Per-item state shared by grid tiles and list rows
    const getItemState = (item, index) => {
        const itemKey = getItemKey(item);
        const sameItem = (a) => (a.id && item.id ? a.id === item.id : a.name === item.name);
        return {
            itemKey,
            isRenaming: renamingItem?.index === index,
            isDragging: Boolean(draggedItem && sameItem(draggedItem)),
            isCut: Boolean((cutItems && cutItems.some(sameItem)) || (cutItem && sameItem(cutItem))),
            isSelected: selectedItems.has(itemKey),
            isFocused: index === focusedIndex,
            isDropTarget: Boolean(item.type === "folder" && draggedItem && draggedItem.name !== item.name),
            starred: isItemStarred(item),
        };
    };
    // Focus, keyboard, drag and drop, touch and click wiring for one item
    const itemRowProps = (item, index, s) => ({
        ref: (el) => { itemElementsRef.current[index] = el; },
        role: "row",
        tabIndex: index === (focusedIndex ?? 0) ? 0 : -1,
        "aria-selected": s.isSelected,
        "aria-label": `${item.name}, ${item.type === "folder" ? "Folder" : (item.fileType || "File")}${s.isSelected ? ", selected" : ""}`,
        "data-grid-item": "true",
        "data-item-index": index,
        onFocus: () => setFocusedIndex(index),
        draggable: !s.isRenaming,
        onDragStart: (e) => handleDragStart(e, item),
        onDragEnd: handleDragEnd,
        onDragOver: item.type === "folder" ? (e) => handleItemDragOver(e, item) : undefined,
        onDrop: item.type === "folder" ? (e) => handleItemDrop(e, item) : undefined,
        onContextMenu: (e) => {
            if (s.isRenaming)
                return;
            e.preventDefault();
            e.stopPropagation();
            setFocusedIndex(index);
            handleContextMenu(e, item, index);
        },
        onTouchStart: (e) => handleTouchStart(e, item, index),
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
        onClick: (e) => {
            if (!s.isRenaming)
                handleItemClick(e, item, index);
        },
        onDoubleClick: (e) => {
            if (s.isRenaming)
                return;
            e.preventDefault();
            e.stopPropagation();
            setFocusedIndex(index);
            handleItemOpen(item);
        },
    });
    // Always visible on touch screens and while selecting; otherwise on hover
    const checkbox = (item, index, s, extra = "") => (<button type="button" onClick={(e) => handleCheckboxClick(e, item, index)} className={cn("w-4 h-4 rounded flex items-center justify-center border-[1.5px] transition-all shrink-0", s.isSelected
            ? "bg-primary border-primary text-primary-foreground motion-safe:animate-select-pop"
            : selectedItems.size > 0
                ? "border-muted-foreground/70 bg-background/80 hover:border-primary"
                : "border-muted-foreground/60 bg-background/70 hover:border-primary opacity-0 group-hover:opacity-100 focus:opacity-100 touch:opacity-100", extra)} title={s.isSelected ? "Deselect" : "Select"} aria-label={s.isSelected ? `Deselect ${item.name}` : `Select ${item.name}`} aria-pressed={s.isSelected}>
        <Check className={cn("w-3 h-3 stroke-[3] transition-[opacity,transform] duration-200", s.isSelected ? "opacity-100 scale-100" : "opacity-0 scale-50")}/>
      </button>);
    const starOrRestore = (item, s, cls, alwaysVisible = false) => (isTrashMode ? (<button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRestoreItem?.(item); }} className={cn("grid place-items-center text-primary", cls)} title="Restore" aria-label={`Restore ${item.name}`}>
        <RotateCcw className="w-3.5 h-3.5"/>
      </button>) : (<button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleStar?.(item); }} className={cn("grid place-items-center transition-opacity", cls, s.starred || alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100 touch:opacity-100")} title={s.starred ? "Remove from starred" : "Add to starred"} aria-label={s.starred ? `Unstar ${item.name}` : `Star ${item.name}`} aria-pressed={s.starred}>
        <Star className={cn("w-3.5 h-3.5", s.starred && "fill-warning text-warning")}/>
      </button>));
    // Desktop list row actions: star (or restore), details, more
    const rowActions = (item, index, s, visibility) => (<>
        {starOrRestore(item, s, cn("w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", visibility), true)}
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDetails(item); }} className={cn("w-7 h-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground", visibility)} title="Details (Alt+Enter)" aria-label={`Details for ${item.name}`}>
          <Info className="w-3.5 h-3.5"/>
        </button>
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openItemContextMenu(item, index, e.clientX, e.clientY); }} className={cn("w-7 h-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground", visibility)} title="More actions" aria-label={`More actions for ${item.name}`}>
          <MoreVertical className="w-3.5 h-3.5"/>
        </button>
      </>);
    // Everything a tile or row needs from here (see items/FileItems.jsx)
    const itemKeyOf = (item, index) => getItemKey(item) || index;
    const itemCtx = { getItemState, itemRowProps, checkbox, starOrRestore, rowActions, openItemContextMenu, getFileIcon, loadedThumbnails, loadingStates, onRenameConfirm, onRenameCancel };
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
      
      <div className="flex-1 flex min-h-0">
      <div className="relative flex-1 min-w-0 flex flex-col min-h-0">
      <div ref={scrollRef} className={`flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 pt-3 pb-20 min-h-0 custom-scrollbar ${isDragActive ? 'bg-primary/5 border-2 border-dashed border-primary rounded-lg' : ''}`} onClick={(e) => {
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
          </div>) : viewMode === "grid" ? (<div ref={gridContainerRef} role="grid" aria-label="Files and folders grid" tabIndex={-1} data-grid-background="true" className={cn(!virtual && GRID_CLASS, "focus:outline-none")}>
            {virtual
                ? <VirtualItems ref={virtualRef} items={items} mode="grid" scrollRef={scrollRef} gridClassName="grid gap-2 sm:gap-2.5" rowGapClassName="pb-2 sm:pb-2.5" renderItem={(item, index) => <GridTile key={itemKeyOf(item, index)} item={item} index={index} ctx={itemCtx}/>}/>
                : items.map((item, index) => <GridTile key={itemKeyOf(item, index)} item={item} index={index} ctx={itemCtx}/>)}
          </div>) : (<div ref={listContainerRef} role="grid" aria-label="Files and folders list" tabIndex={-1} data-grid-background="true" className="flex flex-col focus:outline-none">
            <ListHeader items={items} selectedCount={selectedItems.size} onToggleAll={handleSelectAllToggle}/>
            <div className="flex flex-col gap-0.5 md:gap-0 pt-1">
              {virtual
                ? <VirtualItems ref={virtualRef} items={items} mode="list" scrollRef={scrollRef} gridClassName="flex flex-col" rowGapClassName="pb-0.5 md:pb-0" renderItem={(item, index) => <ListRow key={itemKeyOf(item, index)} item={item} index={index} ctx={itemCtx}/>}/>
                : items.map((item, index) => <ListRow key={itemKeyOf(item, index)} item={item} index={index} ctx={itemCtx}/>)}
            </div>
          </div>)}
      </div>
      {selectedItems.size > 0 && (<SelectionBar count={selectedItems.size} allSelected={selectedItems.size === items.length} actions={selectionActions} onAction={handleSelectionAction} onClear={clearSelection} onToggleAll={handleSelectAllToggle} busy={batchBusy}/>)}
      </div>
      <DetailsPane open={detailsOpen} isMobile={isMobile} onClose={() => onDetailsOpenChange?.(false)} item={detailsItem} selectionCount={selectedList.length} selectionSize={selectedList.reduce((sum, it) => sum + (it.type === "folder" ? 0 : it.size || 0), 0)} thumbnailSrc={detailsItem?.thumbnail ? loadedThumbnails[detailsItem.thumbnail] : undefined} locationPath={locationPath} isTrash={section === "trash" || section === "drive-trash"} isCloud={isCloudMode} cloudAccountId={cloudAccountId} onOpen={handleItemOpen} onDownload={onDownload} onToggleStar={(it) => onToggleStar?.(it)} onRestore={(it) => onRestoreItem?.(it)}/>
      </div>

      {/* Context Menu */}
      {contextMenu && <GridContextMenu onSelectionAction={handleSelectionAction} cloudAccountId={cloudAccountId} cloudFolderId={cloudFolderId} contextMenu={contextMenu} currentApiPath={currentApiPath} currentPath={currentPath} handleItemOpen={handleItemOpen} hasClipboard={hasClipboard} isClipboardPasted={isClipboardPasted} isCloudMode={isCloudMode} isRestrictedEmptyArea={isRestrictedEmptyArea} isTrashMode={isTrashMode} isVaultMode={isVaultMode} items={items} onCopy={onCopy} onCut={onCut} onDelete={onDelete} onDownload={onDownload} onMoveToHome={onMoveToHome} onMoveToVault={onMoveToVault} onNewFolder={onNewFolder} onPaste={onPaste} onRefresh={onRefresh} onRename={onRename} onRestoreItem={onRestoreItem} onToggleStar={onToggleStar} openDetails={openDetails} selectedItems={selectedItems} setArchiveInspect={setArchiveInspect} setCompressDialog={setCompressDialog} setContextMenu={setContextMenu} triggerDirectoryUpload={triggerDirectoryUpload} triggerFileUpload={triggerFileUpload}/>}

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

      {/* Move to… / File to… destination picker */}
      <FolderPickerModal isOpen={movePickerOpen} onClose={() => setMovePickerOpen(false)} currentSelectedPath={pickerStartPath} onSelectPath={(path) => {
            setMovePickerOpen(false);
            runBatch((l) => onBatch.moveTo?.(l, path), selectedList);
        }}/>
    </div>);
};
