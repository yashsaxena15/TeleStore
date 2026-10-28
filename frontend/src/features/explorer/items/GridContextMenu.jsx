// The right-click / ⋯ menu for an item or for empty space in the file grid.
import { canAddToPlaylist, requestAddToPlaylist } from "@/features/playlists/playlists";
import { canSaveOffline, makeAvailableOffline, offlineSupported, removeOffline } from "@/features/offline/offlineStore";
import { folderPathOf } from "@/features/offline/offlineIndex";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { canProtect } from "@/features/protection/protection";
import { setFolderColor, setProtection } from "@/features/protection/protectionActions";
import { api, fetchWithTimeout, getApiBaseUrl } from "@/lib/api";
import { copyStreamUrl } from "@/lib/utils";
import { trackArchiveTask } from "@/features/archives/archiveTracker";
import { ContextMenu } from "../ContextMenu";
import { isVideoItem } from "../fileTypes";
import { getItemKey, isItemStarred } from "../lib/fileCardHelpers";

export const GridContextMenu = ({ offlineIndex, cloudAccountId, cloudFolderId, contextMenu, currentApiPath, currentPath, handleItemOpen, hasClipboard, isClipboardPasted, isCloudMode, isRestrictedEmptyArea, isTrashMode, isVaultMode, items, onCopy, onCut, onDelete, onDownload, onMoveToHome, onMoveToVault, onNewFolder, onPaste, onRefresh, onRename, onRestoreItem, onSelectionAction, onToggleStar, openDetails, selectedItems, setArchiveInspect, setCompressDialog, setContextMenu, triggerDirectoryUpload, triggerFileUpload }) => {
    // Right-clicking one of several selected items acts on all of them (the menu shows the count)
    const onSelection = Boolean(contextMenu.item && selectedItems.size > 1 && selectedItems.has(getItemKey(contextMenu.item)) && onSelectionAction);
    const forSelection = (id, single) => () => {
        if (!contextMenu.item)
            return;
        if (onSelection)
            onSelectionAction(id);
        else
            single(contextMenu.item);
    };
    const cmExt = (contextMenu.item?.extension || contextMenu.item?.name?.split('.').pop() || '').toLowerCase();
    const isArchiveItem = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z'].includes(cmExt);
    const isVideo = contextMenu.item ? isVideoItem(contextMenu.item) : false;
    const selectedCount = selectedItems.size > 0 ? selectedItems.size : 1;
    // Music and videos (all of the selection when right-clicking one of it) can go in a playlist
    const targets = !contextMenu.item ? [] : (onSelection ? items.filter((it) => selectedItems.has(getItemKey(it))) : [contextMenu.item]);
    const addTargets = targets.filter(canAddToPlaylist);
    // Available offline: offer to save what isn't saved yet, and to remove what is
    const offlineTargets = offlineSupported() && !isTrashMode && !isCloudMode && !isVaultMode ? targets.filter(canSaveOffline) : [];
    const isOffline = (it) => (it.type === "folder" ? Boolean(offlineIndex?.folders?.[folderPathOf(it)]) : Boolean(offlineIndex?.files?.[it.id]));
    const toSave = offlineTargets.filter((it) => !isOffline(it));
    const toRemove = offlineTargets.filter(isOffline);
    // Protect from deletion (not in Trash, the Vault or Google Drive); colours for folders
    const queryClient = useQueryClient();
    const refreshFiles = () => queryClient.invalidateQueries({ queryKey: ["files"] });
    const inTrash = isTrashMode || cloudFolderId === "trash" || Boolean(contextMenu.item?.is_trashed);
    const protectTargets = !inTrash && !isCloudMode && !isVaultMode ? targets.filter(canProtect) : [];
    const toProtect = protectTargets.filter((it) => !it.protected);
    const toUnprotect = toProtect.length ? [] : protectTargets;
    const colorTargets = !inTrash && !isCloudMode ? targets.filter((it) => it.type === "folder" && canProtect(it)) : [];
    const canColor = colorTargets.length > 0 && colorTargets.length === targets.length;
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
        }} onPaste={onPaste} onDelete={forSelection(isTrashMode || cloudFolderId === "trash" ? "delete-forever" : "delete", (item) => onDelete(item, contextMenu.index))} onRename={() => contextMenu.item && onRename(contextMenu.item, contextMenu.index)} onNewFolder={onNewFolder} onDownload={() => contextMenu.item && onDownload(contextMenu.item)} onUploadFiles={triggerFileUpload} // Use the trigger function
     onUploadFolder={triggerDirectoryUpload} // Use the trigger function
     onClose={() => setContextMenu(null)} hasClipboard={hasClipboard} isClipboardPasted={isClipboardPasted} disableDelete={false} onProperties={() => contextMenu.item && openDetails(contextMenu.item)} isArchive={isArchiveItem} selectedCount={selectedCount} isVaultMode={isVaultMode} onMoveToVault={forSelection("to-vault", (item) => onMoveToVault?.(item))} onMoveToHome={forSelection("to-home", (item) => onMoveToHome?.(item))} onInspectArchive={() => {
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
        }} isStarred={isItemStarred(contextMenu.item)} onToggleStar={() => contextMenu.item && onToggleStar?.(contextMenu.item)} isTrashMode={isTrashMode || cloudFolderId === "trash" || Boolean(contextMenu.item?.is_trashed)} onRestore={forSelection("restore", (item) => onRestoreItem?.(item))} isCloudMode={isCloudMode} isVirtualFolder={Boolean(contextMenu.item?.is_virtual)} isRestrictedEmptyArea={isRestrictedEmptyArea} onRefresh={onRefresh} onAddToPlaylist={addTargets.length > 0 && !isTrashMode ? () => requestAddToPlaylist(addTargets) : undefined} onMakeOffline={toSave.length ? () => makeAvailableOffline(toSave) : undefined} onRemoveOffline={toRemove.length ? () => removeOffline(toRemove) : undefined} onProtect={toProtect.length ? () => setProtection(toProtect, true, refreshFiles) : undefined} onUnprotect={toUnprotect.length ? () => setProtection(toUnprotect, false, refreshFiles) : undefined} folderColor={canColor && colorTargets.every((f) => f.color === colorTargets[0].color) ? colorTargets[0].color : undefined} onSetFolderColor={canColor ? (color) => setFolderColor(colorTargets, color, refreshFiles) : undefined}/>);
};
