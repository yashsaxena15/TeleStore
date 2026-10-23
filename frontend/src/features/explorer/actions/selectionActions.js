// Selecting in the file grid (click, Ctrl/Shift-click, double-tap, checkboxes, select all) and
// the batch download and delete that act on the selection (Telegram and Google Drive items).
import { toast } from "sonner";
import { api, fetchWithTimeout, getApiBaseUrl } from "@/lib/api";
import { getItemKey } from "../lib/fileCardHelpers";

export function createSelectionActions({ cloudAccountId, cloudFolderId, currentPath, handleItemOpen, isCloudMode, isLongPressRef, isSelectionMode, isTrashMode, items, lastSelectedIndex, lastTapRef, onDownload, onRefresh, selectedItems, setBatchDeleteDialogOpen, setFocusedIndex, setIsBatchDeleting, setIsSelectionMode, setLastSelectedIndex, setSelectedItems }) {
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
    const validItemsToDelete = itemsToDelete;
    if (validItemsToDelete.length === 0) {
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
            if (isCloudMode || item.is_cloud) {
                const accId = cloudAccountId || item.cloud_account_id;
                const fileId = item.cloud_file_id || item.id;
                const isAlreadyTrashed = cloudFolderId === "trash" || Boolean(item.is_trashed);
                await api.deleteCloudFile(accId, fileId, isAlreadyTrashed);
                successCount++;
            }
            else {
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
        const isCloudDelete = isCloudMode || validItemsToDelete.some(it => it.is_cloud);
        const isPermanent = isTrashMode || cloudFolderId === "trash";
        toast.success(isPermanent
            ? `Permanently deleted ${successCount} item${successCount > 1 ? 's' : ''}${isCloudDelete ? ' from Google Drive' : ''}`
            : `Moved ${successCount} item${successCount > 1 ? 's' : ''} to ${isCloudDelete ? 'Google Drive ' : ''}Trash`);
        if (onRefresh) {
            onRefresh();
        }
    }
    if (failCount > 0) {
        toast.error(`Failed to process ${failCount} item${failCount > 1 ? 's' : ''}`);
    }
};
    return { handleItemClick, handleCheckboxClick, handleSelectAllToggle, handleBatchDownload, handleConfirmBatchDelete };
}
