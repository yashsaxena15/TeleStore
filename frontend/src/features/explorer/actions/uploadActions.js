// Uploading into Files: the file picker, files and folders dropped from the computer (walking
// folders with the modern FileSystemHandle API or the older Entry API), Google Drive uploads,
// and the checks that stop uploads into Trash, Inbox and Drive's virtual sections.
import { toast } from "sonner";
import { api } from "@/lib/api";
import { uploadManager } from "@/features/transfers/uploadManager";

export function createUploadActions({ cloudAccountId, cloudFolderId, currentApiPath, currentFolder, currentPath, dragCounter, isCloudMode, isCloudVirtualSection, isEffectiveInboxMode, isRestrictedEmptyArea, isTrashMode, onFileUploaded, onRefresh, setDraggedItem, setIsDragActive, setShowIndexChatDialog, setShowTelegramVerificationDialog, setUploadProgressMap, setUploadingFiles, uploadProgressMap }) {
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
            toast.info(`Uploading ${filesToUpload.length} file(s) to Google Drive...`);
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
                toast.success(`Successfully uploaded ${uploadedCount} file(s) to Google Drive`);
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
            toast.error("Unable to process the dropped files. Please try dragging files directly from your file manager.");
            return;
        }
    }
    catch (error) {
        toast.error("Failed to handle file drop. Please try again.");
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
    return { handleFileUpload, handleDragEnter, handleDragLeave, handleFileDragOver, handleFileDrop, processItemsWithModernAPI, processItemsWithLegacyAPI, traverseDirectoryWithHandle, traverseDirectoryWithEntry };
}
