// What happens when the user acts on items in Files: drop on the sidebar, new folder, move,
// download (folders in parts), rename, delete, star, restore and emptying the trash.
// FileExplorer passes in where the user is and the state setters; rebuilt on each render.
import { toast } from "sonner";
import { api, fetchWithTimeout, getApiBaseUrl } from "@/lib/api";
import logger from "@/lib/logger";
import { downloadManager } from "@/features/transfers/downloadManager";
import { TRASH_MOVE_MESSAGE } from "./batchActions";
import { isProtectionCancelled, withProtection } from "@/features/protection/protection";

export function createItemActions({ cloudAccountId, cloudFolderId, currentApiPath, currentFolder, currentPath, deleteDialog, isCloudMode, isEffectiveTrashMode, isInboxMode, isTrashMode, moveItem, refetch, renamingItem, setDeleteDialog, setEmptyTrashDialogOpen, setFolderDownloadInfo, setIsEmptyingTrash, setNewFolderDialogOpen, setRenamingItem }) {
const handleSidebarDrop = async (item, targetFolderName) => {
    if (isEffectiveTrashMode || item.trashed) {
        toast.error(TRASH_MOVE_MESSAGE);
        return;
    }
    try {
        // Construct the source path correctly
        let sourcePath = "/";
        if (isInboxMode) {
            sourcePath = "/Telegram Inbox";
        }
        else if (currentPath.length > 1) {
            // For all folder types, we construct the path consistently
            sourcePath = `/${currentPath.join('/')}`;
        }
        // Construct the target path
        let targetPath = "/Home";
        if (targetFolderName === "Telegram Inbox") {
            targetPath = "/Telegram Inbox";
        }
        else if (targetFolderName !== "Home") {
            // Since folders are now in the database, we can construct the path directly
            targetPath = `/Home/${targetFolderName}`;
        }
        const baseUrl = getApiBaseUrl();
        // For the default case, we need to append /api to the base URL
        const apiUrl = baseUrl ? `${baseUrl}` : '';
        const response = await fetchWithTimeout(`${apiUrl}/files/move`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include", // Add this to include cookies for authentication
            body: JSON.stringify({
                file_id: item.id, // Use file_id instead of file_path
                target_path: targetPath,
            }),
        }, 3000); // 3 second timeout
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "Failed to move file");
        }
        toast.success(`Moved "${item.name}" to ${targetFolderName}`);
        // Refresh current location after drag and drop
        refetch();
    }
    catch (error) {
        toast.error(error.message || "Failed to move file");
    }
};
const handleNewFolder = async (folderName) => {
    try {
        if (isInboxMode || currentFolder === "Telegram Inbox" || currentApiPath === "/inbox") {
            toast.error("Cannot create folders in Telegram Inbox. Inbox is reserved for incoming messages.");
            return;
        }
        if (currentFolder === "Starred" || currentApiPath === "/starred") {
            toast.error("Cannot create folders in Starred.");
            return;
        }
        if (isEffectiveTrashMode || currentFolder === "Trash" || currentApiPath === "/trash") {
            toast.error("Cannot create folders in Trash.");
            return;
        }
        if (isCloudMode) {
            if (!cloudFolderId || ["root", "google_drive", "trash", "starred", "shared_with_me"].includes(cloudFolderId)) {
                toast.error("Cannot create folders at root level or in virtual sections. Please navigate inside My Drive first.");
                return;
            }
            const effectiveParent = cloudFolderId === "my_drive" ? "root" : cloudFolderId;
            await api.createCloudFolder(cloudAccountId, folderName, effectiveParent);
            toast.success(`Folder "${folderName}" created in Google Drive`);
            setNewFolderDialogOpen(false);
            refetch();
            return;
        }
        // Use currentApiPath which correctly handles /Home and subfolders
        const backendPath = currentApiPath;
        const baseUrl = getApiBaseUrl();
        // For the default case, we need to append /api to the base URL
        const apiUrl = baseUrl ? `${baseUrl}` : '';
        const response = await fetchWithTimeout(`${apiUrl}/folders/create`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include", // Add this to include cookies for authentication
            body: JSON.stringify({
                folderName,
                currentPath: backendPath,
            }),
        }, 3000); // 3 second timeout
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "Failed to create folder");
        }
        toast.success(`Folder "${folderName}" created successfully`);
        setNewFolderDialogOpen(false);
        // Refresh current location after creating folder
        refetch();
    }
    catch (error) {
        toast.error(error.message || "Failed to create folder");
    }
};
// Add the missing functions
const handleDelete = (item, index) => {
    setDeleteDialog({ item, index });
};
const handleRename = (item, index) => {
    setRenamingItem({ item, index });
};
const handleMove = async (item, targetFolder) => {
    try {
        if (isEffectiveTrashMode || item.trashed || targetFolder.trashed) {
            toast.error(TRASH_MOVE_MESSAGE);
            return;
        }
        if (isCloudMode && cloudAccountId) {
            if (targetFolder.is_virtual || ["trash", "starred", "shared_with_me"].includes(targetFolder.id)) {
                toast.error("Cannot move items into virtual folders.");
                return;
            }
            const fileId = item.cloud_file_id || item.id;
            const targetId = targetFolder.cloud_file_id || targetFolder.id;
            if (!fileId || !targetId) {
                toast.error("Invalid cloud items for move operation.");
                return;
            }
            const toastId = toast.loading(`Moving "${item.name}" into "${targetFolder.name}"...`);
            try {
                await api.transferCloudInternal(cloudAccountId, [fileId], targetId, "cut");
                toast.dismiss(toastId);
                toast.success(`Moved "${item.name}" to "${targetFolder.name}"`);
                refetch();
            }
            catch (err) {
                toast.dismiss(toastId);
                toast.error(err.message || "Failed to move item in Google Drive");
            }
            return;
        }
        // Determine source path from item or current path
        let sourcePath = item.file_path || (currentPath.length > 1 ? `/${currentPath.join('/')}` : "/Home");
        // Construct the target path dynamically based on targetFolder's actual location
        let targetPath = "/Home";
        if (targetFolder.name === "Home") {
            targetPath = "/Home";
        }
        else if (targetFolder.file_path) {
            // Use the folder's actual parent path in the file tree
            const parent = targetFolder.file_path.replace(/\/+$/, '');
            targetPath = parent && parent !== "/" ? `${parent}/${targetFolder.name}` : `/${targetFolder.name}`;
        }
        else {
            // Fallback using currentApiPath
            const current = currentApiPath || (currentPath.length > 1 ? `/${currentPath.join('/')}` : "/Home");
            targetPath = `${current.replace(/\/+$/, '')}/${targetFolder.name}`;
        }
        // Ensure paths are properly formatted
        sourcePath = sourcePath.replace(/\/+/g, '/'); // Remove duplicate slashes
        targetPath = targetPath.replace(/\/+/g, '/'); // Remove duplicate slashes
        // Ensure targetPath doesn't end with a slash unless it's root
        if (targetPath !== "/" && targetPath.endsWith("/")) {
            targetPath = targetPath.slice(0, -1);
        }
        await moveItem(item, targetPath, sourcePath);
        toast.success(`Moved "${item.name}" to ${targetFolder.name}`);
        // Refresh current location after move
        refetch();
    }
    catch (error) {
        logger.error("Error moving file", { error, item, targetFolder });
        toast.error(error.message || "Failed to move file");
    }
};
const handleDownloadFolderPart = (part) => {
    const baseUrl = getApiBaseUrl();
    const downloadUrl = part.download_url.startsWith('http')
        ? part.download_url
        : `${baseUrl || ''}${part.download_url}`;
    downloadManager.addDownload(downloadUrl, part.name);
    toast.success(`Started download for ${part.name}`);
};
const handleDownloadAllFolderParts = (parts) => {
    const baseUrl = getApiBaseUrl();
    parts.forEach((part, index) => {
        setTimeout(() => {
            const downloadUrl = part.download_url.startsWith('http')
                ? part.download_url
                : `${baseUrl || ''}${part.download_url}`;
            downloadManager.addDownload(downloadUrl, part.name);
        }, index * 400);
    });
    toast.success(`Queued ${parts.length} parts for download`);
};
const handleDownload = async (item) => {
    try {
        if (item.is_cloud) {
            if (item.type === "folder") {
                toast.info("Folder download from Google Drive is not supported directly. Please copy files to Telegram storage.");
                return;
            }
            const fileId = item.cloud_file_id || item.id;
            const dlUrl = api.getCloudDownloadUrl(cloudAccountId || item.cloud_account_id, fileId);
            downloadManager.addDownload(dlUrl, item.name);
            toast.success(`Download queued: ${item.name}`);
            return;
        }
        const baseUrl = getApiBaseUrl();
        if (item.type === "folder") {
            toast.info(`Preparing zip for "${item.name}"...`);
            const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
            const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
            const param = item.id
                ? `id=${encodeURIComponent(item.id)}`
                : `path=${encodeURIComponent(item.file_path ? `${item.file_path}/${item.name}` : (currentApiPath ? `${currentApiPath}/${item.name}` : `/Home/${item.name}`))}`;
            const response = await fetchWithTimeout(`${baseUrl || ""}/folders/download-info?${param}${tokenParam}`, { credentials: "include" });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || `Failed to prepare folder download: ${response.status}`);
            }
            const info = await response.json();
            if (!info.parts || info.parts.length === 0) {
                toast.warning("Folder is empty or has no files to download.");
                return;
            }
            if (info.parts.length === 1) {
                // Single part (<= 2GB), start download directly
                const part = info.parts[0];
                handleDownloadFolderPart(part);
            }
            else {
                // Multiple parts (> 2GB), show part selection dialog
                setFolderDownloadInfo(info);
            }
            return;
        }
        console.log('[FileExplorer] handleDownload - baseUrl:', baseUrl);
        // Construct the download URL - for the new path structure, we just need the file name
        // The backend will handle extracting the file name from paths like /Home/Images/filename.jpg
        // The file's ID picks exactly this file (a name alone can match a same-named file in
        // another folder); the name is encoded so "#", "?" or "%" in it don't break the address
        const fileName = encodeURIComponent(item.name);
        const fileIdParam = item.id ? `?file_id=${encodeURIComponent(item.id)}` : "";
        let downloadUrl = baseUrl
            ? `${baseUrl}/dl/${fileName}${fileIdParam}`
            : `/dl/${fileName}${fileIdParam}`;
        console.log('[FileExplorer] handleDownload - constructed URL:', downloadUrl);
        // Add to download manager for tracking - this will automatically start the download
        // The download manager will handle adding auth tokens as needed
        const downloadId = downloadManager.addDownload(downloadUrl, item.name);
        // The download is now handled by the download manager's queue system
        // We don't need to call downloadFile directly
    }
    catch (error) {
        logger.error("Failed to download file:", error);
        toast.error(error.message || "Failed to download file");
    }
};
const confirmRename = async (newName) => {
    if (!renamingItem)
        return;
    try {
        const item = renamingItem.item;
        if (isCloudMode) {
            const fileId = item.cloud_file_id || item.id;
            await api.renameCloudFile(cloudAccountId, fileId, newName);
            toast.success(`Renamed "${item.name}" to "${newName}"`);
            setRenamingItem(null);
            refetch();
            return;
        }
        const backendPath = currentApiPath;
        const baseUrl = getApiBaseUrl();
        // For the default case, we need to append /api to the base URL
        const apiUrl = baseUrl ? `${baseUrl}` : '';
        const response = await fetchWithTimeout(`${apiUrl}/files/rename`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include", // Add this to include cookies for authentication
            body: JSON.stringify({
                file_id: item.id, // Use file_id instead of file_path
                new_name: newName,
            }),
        }, 3000); // 3 second timeout
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "Failed to rename file");
        }
        toast.success(`Renamed "${item.name}" to "${newName}"`);
        setRenamingItem(null);
        // Refresh current location after renaming file
        refetch();
    }
    catch (error) {
        toast.error(error.message || "Failed to rename file");
    }
};
const confirmDelete = async () => {
    if (!deleteDialog)
        return;
    try {
        const item = deleteDialog.item;
        if (!item.id)
            return;
        if (isCloudMode) {
            const fileId = item.cloud_file_id || item.id;
            const isAlreadyTrashed = cloudFolderId === "trash" || Boolean(item.is_trashed);
            await api.deleteCloudFile(cloudAccountId, fileId, isAlreadyTrashed);
            toast.success(isAlreadyTrashed ? `Permanently deleted "${item.name}" from Google Drive` : `Moved "${item.name}" to Google Drive Trash`);
            setDeleteDialog(null);
            refetch();
            return;
        }
        // A protected item asks for the password first (see features/protection)
        if (isTrashMode) {
            await withProtection((token) => api.deleteForever(item.id, token));
            toast.success(`Permanently deleted "${item.name}"`);
        }
        else {
            await withProtection((token) => api.trashFile(item.id, token));
            toast.success(`Moved "${item.name}" to Trash`);
        }
        setDeleteDialog(null);
        // Refresh current location after deleting file
        refetch();
    }
    catch (error) {
        if (isProtectionCancelled(error)) {
            setDeleteDialog(null);
            toast.info("Not deleted");
            return;
        }
        toast.error(error.message || "Failed to delete item");
    }
};
const handleToggleStar = async (item) => {
    if (!item.id)
        return;
    try {
        if (isCloudMode) {
            const fileId = item.cloud_file_id || item.id;
            const newStarred = !(item.starred || item.is_starred);
            await api.starCloudFile(cloudAccountId || item.cloud_account_id, fileId, newStarred);
            toast.success(newStarred ? `Added "${item.name}" to Starred in Google Drive` : `Removed "${item.name}" from Starred in Google Drive`);
            refetch();
            return;
        }
        const newStarred = !item.starred;
        await api.toggleStar(item.id, newStarred);
        toast.success(newStarred ? `Added "${item.name}" to Starred` : `Removed "${item.name}" from Starred`);
        refetch();
    }
    catch (error) {
        toast.error(error.message || "Failed to update star status");
    }
};
const handleRestoreItem = async (item) => {
    if (!item.id)
        return;
    try {
        if (isCloudMode) {
            const fileId = item.cloud_file_id || item.id;
            await api.restoreCloudFile(cloudAccountId || item.cloud_account_id, fileId);
            toast.success(`Restored "${item.name}" in Google Drive`);
            refetch();
            return;
        }
        await api.restoreFile(item.id);
        toast.success(`Restored "${item.name}"`);
        refetch();
    }
    catch (error) {
        toast.error(error.message || "Failed to restore item");
    }
};
const handleEmptyTrash = async () => {
    try {
        setIsEmptyingTrash(true);
        if (isCloudMode) {
            await api.emptyCloudTrash(cloudAccountId);
            toast.success("Google Drive trash emptied successfully");
        }
        else {
            const res = await withProtection((token) => api.emptyTrash(token));
            toast.success(res?.message || "Trash emptied successfully");
        }
        setEmptyTrashDialogOpen(false);
        refetch();
    }
    catch (error) {
        if (isProtectionCancelled(error)) {
            setEmptyTrashDialogOpen(false);
            toast.info("Not deleted");
            return;
        }
        toast.error(error.message || "Failed to empty trash");
    }
    finally {
        setIsEmptyingTrash(false);
    }
};
    return { handleSidebarDrop, handleNewFolder, handleDelete, handleRename, handleMove, handleDownloadFolderPart, handleDownloadAllFolderParts, handleDownload, confirmRename, confirmDelete, handleToggleStar, handleRestoreItem, handleEmptyTrash };
}
