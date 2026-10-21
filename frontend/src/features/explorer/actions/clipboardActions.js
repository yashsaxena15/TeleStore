// Copy, cut and paste between Telegram folders, Google Drive and the two of them.
// FileExplorer passes in where the user is; the handlers are rebuilt on each render.
import { toast } from "sonner";
import { api } from "@/lib/api";

export function createClipboardActions({ isInboxMode, isEffectiveTrashMode, isCloudMode, currentApiPath, currentPath, currentFolder, cloudAccountId, cloudFolderId, refetch, clipboard, copyItem, cutItem, clearClipboard, pasteItem }) {
const handleCopy = (itemsToCopy) => {
    const itemsList = Array.isArray(itemsToCopy) ? itemsToCopy : [itemsToCopy];
    if (itemsList.length === 0)
        return;
    const firstItem = itemsList[0];
    const sourcePath = isInboxMode
        ? "/Telegram Inbox"
        : (firstItem.file_path || currentApiPath || (currentPath.length > 1 ? `/${currentPath.join('/')}` : "/Home"));
    copyItem(itemsList, sourcePath);
    if (itemsList.length === 1) {
        toast.success(`Copied "${itemsList[0].name}"`);
    }
    else {
        toast.success(`Copied ${itemsList.length} items`);
    }
};
const handleCut = (itemsToCut) => {
    const itemsList = Array.isArray(itemsToCut) ? itemsToCut : [itemsToCut];
    if (itemsList.length === 0)
        return;
    const firstItem = itemsList[0];
    const sourcePath = isInboxMode
        ? "/Telegram Inbox"
        : (firstItem.file_path || currentApiPath || (currentPath.length > 1 ? `/${currentPath.join('/')}` : "/Home"));
    cutItem(itemsList, sourcePath);
    if (itemsList.length === 1) {
        toast.success(`Cut "${itemsList[0].name}"`);
    }
    else {
        toast.success(`Cut ${itemsList.length} items`);
    }
};
const handlePaste = async () => {
    try {
        if (isInboxMode || currentFolder === "Telegram Inbox" || currentApiPath === "/inbox") {
            toast.error("Cannot paste items into Telegram Inbox. Inbox is reserved for incoming messages.");
            return;
        }
        if (currentFolder === "Starred" || currentApiPath === "/starred") {
            toast.error("Cannot paste items into Starred.");
            return;
        }
        if (isEffectiveTrashMode || currentFolder === "Trash" || currentApiPath === "/trash") {
            toast.error("Cannot paste items into Trash.");
            return;
        }
        if (isCloudMode) {
            if (!cloudAccountId) {
                toast.error("No cloud account selected.");
                return;
            }
            if (clipboard?.items && clipboard.items.length > 0) {
                // Check if items are from Telegram (not is_cloud)
                const tgItems = clipboard.items.filter((it) => !it.is_cloud);
                if (tgItems.length > 0) {
                    if (!cloudFolderId || ["root", "google_drive", "trash", "starred", "shared_with_me"].includes(cloudFolderId)) {
                        toast.error("Cannot transfer files to root level or virtual sections. Please navigate inside My Drive first.");
                        return;
                    }
                    const targetFolderId = cloudFolderId;
                    const fileIds = tgItems
                        .filter((it) => it.type !== "folder" && !it.is_folder)
                        .map((it) => it.id || it.file_unique_id)
                        .filter(Boolean);
                    const folderPaths = tgItems
                        .filter((it) => it.type === "folder" || it.is_folder)
                        .map((it) => it.path || it.file_path || it.name)
                        .filter(Boolean);
                    const res = await api.transferTelegramToCloud(cloudAccountId, fileIds, folderPaths, targetFolderId, clipboard.operation === "cut" ? "cut" : "copy");
                    toast.success(res.message || `Queued ${tgItems.length} item(s) for transfer to Google Drive. Track in Transfers.`);
                    clearClipboard();
                    refetch();
                    return;
                }
                else {
                    // Internal Google Drive Copy / Cut (Move)
                    const targetFolderId = cloudFolderId || "root";
                    if (!cloudFolderId || ["root", "google_drive", "trash", "starred", "shared_with_me"].includes(targetFolderId)) {
                        toast.error("Cannot paste items into Google Drive root, Starred, Trash, or Shared with me. Please open a folder in My Drive.");
                        return;
                    }
                    const cloudFileIds = clipboard.items.map((it) => it.cloud_file_id || it.id).filter(Boolean);
                    if (cloudFileIds.length === 0) {
                        toast.error("No valid cloud items found in clipboard.");
                        return;
                    }
                    const op = clipboard.operation === "cut" ? "cut" : "copy";
                    const toastId = toast.loading(`${op === "cut" ? "Moving" : "Copying"} ${cloudFileIds.length} item(s) in Google Drive...`);
                    try {
                        const res = await api.transferCloudInternal(cloudAccountId, cloudFileIds, targetFolderId, op);
                        toast.dismiss(toastId);
                        toast.success(res.message || `Successfully ${op === "cut" ? "moved" : "copied"} ${cloudFileIds.length} item(s) in Google Drive!`);
                        clearClipboard();
                        refetch();
                    }
                    catch (err) {
                        toast.dismiss(toastId);
                        toast.error(err.message || `Failed to ${op} items in Google Drive`);
                    }
                    return;
                }
            }
            toast.info("Clipboard is empty.");
            return;
        }
        if (clipboard?.items && clipboard.items.some((it) => it.is_cloud)) {
            const targetPath = currentApiPath || (currentPath.length > 1 ? `/${currentPath.join('/')}` : "/Home");
            const cloudItemsToTransfer = clipboard.items.filter((it) => it.is_cloud);
            for (const item of cloudItemsToTransfer) {
                const cloudAccId = item.cloud_account_id || cloudAccountId;
                const cloudFileId = item.cloud_file_id || item.id;
                if (cloudAccId && cloudFileId) {
                    await api.transferCloudToTelegram(cloudAccId, cloudFileId, targetPath, clipboard.operation === "cut" ? "cut" : "copy");
                }
            }
            toast.success(`Queued ${cloudItemsToTransfer.length} cloud item(s) to ${targetPath}. Track progress in Transfers.`);
            clearClipboard();
            refetch();
            return;
        }
        // Construct the target path using current location
        const targetPath = currentApiPath || (currentPath.length > 1 ? `/${currentPath.join('/')}` : "/Home");
        await pasteItem(targetPath);
        toast.success("Operation completed successfully");
        // Refresh current location after paste
        refetch();
    }
    catch (error) {
        toast.error(error.message || "Failed to complete operation");
    }
};
    return { handleCopy, handleCut, handlePaste };
}
