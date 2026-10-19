// Type guard for FileSystemHandle
const isFileSystemFileHandle = (handle) => {
    return handle && typeof handle === 'object' && 'kind' in handle && handle.kind === 'file';
};
const isFileSystemDirectoryHandle = (handle) => {
    return handle && typeof handle === 'object' && 'kind' in handle && handle.kind === 'directory';
};
// Traverse directory using FileSystemDirectoryHandle (Modern API)
const traverseDirectoryWithHandle = async (handle, basePath = '') => {
    const files = [];
    console.log('Traversing directory with handle:', handle.name, 'base path:', basePath);
    try {
        // Using entries() to iterate through directory contents
        for await (const [name, entry] of handle.entries()) {
            const fullPath = basePath ? `${basePath}/${name}` : name;
            console.log('Processing entry:', name, 'full path:', fullPath, 'kind:', entry.kind);
            if (isFileSystemFileHandle(entry)) {
                try {
                    const file = await entry.getFile();
                    console.log('Got file from handle:', file.name);
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
            else if (isFileSystemDirectoryHandle(entry)) {
                try {
                    console.log('Recursively traversing subdirectory:', name);
                    const subFiles = await traverseDirectoryWithHandle(entry, fullPath);
                    console.log('Subdirectory', name, 'returned', subFiles.length, 'files');
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
    console.log('Finished traversing directory', handle.name, 'found', files.length, 'files');
    return files;
};
// Traverse directory using FileSystemEntry (File and Directory Entries API - Fallback)
const traverseDirectoryWithEntry = async (entry, basePath = '') => {
    const files = [];
    console.log('Traversing directory with entry:', entry.name, 'base path:', basePath);
    const readEntriesPromise = () => {
        return new Promise((resolve, reject) => {
            const dirReader = entry.createReader();
            const entries = [];
            const readBatch = () => {
                dirReader.readEntries((batch) => {
                    if (batch.length === 0) {
                        resolve(entries);
                    }
                    else {
                        entries.push(...batch);
                        readBatch();
                    }
                }, reject);
            };
            readBatch();
        });
    };
    try {
        const entries = await readEntriesPromise();
        console.log('Directory reader returned', entries.length, 'entries');
        for (const childEntry of entries) {
            const fullPath = basePath ? `${basePath}/${childEntry.name}` : childEntry.name;
            console.log('Processing child entry:', childEntry.name, 'full path:', fullPath);
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
                    console.warn(`Failed to get file ${fullPath}:`, error);
                }
            }
            else if (childEntry.isDirectory) {
                try {
                    console.log('Recursively traversing subdirectory:', childEntry.name);
                    const subFiles = await traverseDirectoryWithEntry(childEntry, fullPath);
                    console.log('Subdirectory', childEntry.name, 'returned', subFiles.length, 'files');
                    files.push(...subFiles);
                }
                catch (error) {
                    console.warn(`Failed to traverse directory ${fullPath}:`, error);
                }
            }
        }
    }
    catch (error) {
        console.warn(`Failed to read directory entries for ${entry.name}:`, error);
    }
    console.log('Finished traversing directory', entry.name, 'found', files.length, 'files');
    return files;
};
// Process DataTransferItems using the modern FileSystemHandle API
const processDropItemsWithHandle = async (items) => {
    const allFiles = [];
    let hasHandles = false;
    console.log('Processing items with FileSystemHandle API, items count:', items.length);
    for (const item of Array.from(items)) {
        console.log('Checking item:', item);
        // Try modern FileSystemHandle API
        if (item.getAsFileSystemHandle) {
            console.log('Item has getAsFileSystemHandle');
            try {
                const handle = await item.getAsFileSystemHandle();
                console.log('Got handle:', handle);
                if (handle) {
                    console.log('Handle kind:', handle.kind);
                }
                hasHandles = true;
                if (handle) {
                    if (isFileSystemFileHandle(handle)) {
                        console.log('Handle is file');
                        try {
                            const file = await handle.getFile();
                            console.log('Got file:', file);
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
                            console.warn(`Failed to get file from handle ${handle.name}:`, error);
                        }
                    }
                    else if (isFileSystemDirectoryHandle(handle)) {
                        console.log('Handle is directory:', handle.name);
                        try {
                            // For directories, we need to traverse with the directory name as the base path
                            console.log('Traversing directory with base path:', handle.name);
                            const files = await traverseDirectoryWithHandle(handle, handle.name);
                            console.log('Traversed directory files:', files.length);
                            allFiles.push(...files);
                        }
                        catch (error) {
                            console.warn(`Failed to traverse directory ${handle.name}:`, error);
                        }
                    }
                    else {
                        console.log('Handle is neither file nor directory, kind:', handle.kind);
                    }
                }
                else {
                    console.log('Handle is null');
                }
            }
            catch (error) {
                console.warn('Error getting FileSystemHandle:', error);
            }
        }
        else {
            console.log('Item does not have getAsFileSystemHandle');
        }
    }
    console.log('FileSystemHandle processing complete, files found:', allFiles.length, 'hasHandles:', hasHandles);
    return hasHandles ? allFiles : null;
};
// Process DataTransferItems using the File and Directory Entries API (Fallback)
const processDropItemsWithEntry = async (items) => {
    const allFiles = [];
    console.log('Processing items with Entry API, items count:', items.length);
    for (const item of Array.from(items)) {
        console.log('Checking item for Entry API:', item);
        // Try File and Directory Entries API
        if ('webkitGetAsEntry' in item) {
            console.log('Item has webkitGetAsEntry');
            const entry = webkitGetAsEntryPromise(item);
            console.log('Got entry:', entry);
            if (entry) {
                console.log('Entry isFile:', entry.isFile);
                console.log('Entry isDirectory:', entry.isDirectory);
                if (entry.isFile) {
                    console.log('Entry is file');
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
                        console.warn(`Failed to get file from entry ${entry.name}:`, error);
                    }
                }
                else if (entry.isDirectory) {
                    console.log('Entry is directory');
                    try {
                        // For directories, we need to traverse with the directory name as the base path
                        const basePath = entry.fullPath && entry.fullPath.length > 1
                            ? entry.fullPath.substring(1) // Remove leading slash
                            : entry.name;
                        console.log('Traversing directory with base path:', basePath);
                        const files = await traverseDirectoryWithEntry(entry, basePath);
                        console.log('Traversed directory files with Entry API:', files.length);
                        allFiles.push(...files);
                    }
                    catch (error) {
                        console.warn(`Failed to traverse directory ${entry.name}:`, error);
                    }
                }
                else {
                    console.log('Entry is neither file nor directory, isFile:', entry.isFile, 'isDirectory:', entry.isDirectory);
                }
                continue; // Successfully processed with File and Directory Entries API
            }
            else {
                console.log('Entry is null');
            }
        }
        else {
            console.log('Item does not have webkitGetAsEntry');
        }
        // Fallback to File API (for regular files)
        if (item.kind === 'file') {
            console.log('Item is file kind');
            const file = item.getAsFile();
            if (file) {
                console.log('Got file from getAsFile:', file);
                allFiles.push({
                    file,
                    name: file.name,
                    fullPath: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified
                });
            }
            else {
                console.log('getAsFile returned null');
            }
        }
        else {
            console.log('Item is not file kind, kind:', item.kind);
        }
    }
    console.log('Entry API processing complete, files found:', allFiles.length);
    return allFiles;
};
// Export the helper functions
export { isFileSystemFileHandle, isFileSystemDirectoryHandle, traverseDirectoryWithHandle, traverseDirectoryWithEntry };
// Process DataTransferItems using the best available API
export const processDropItems = async (items) => {
    console.log('Starting processDropItems, items count:', items.length);
    // Check if items is accessible
    if (!items || items.length === 0) {
        console.log('No items available in DataTransferItemList');
        return [];
    }
    // Log each item for debugging
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`Item ${i}: kind=${item.kind}, type=${item.type}`);
        if (item.getAsFileSystemHandle) {
            console.log(`Item ${i} has getAsFileSystemHandle method`);
        }
        if ('webkitGetAsEntry' in item) {
            console.log(`Item ${i} has webkitGetAsEntry method`);
        }
    }
    // Try modern API first
    try {
        console.log('Trying modern FileSystemHandle API');
        const filesFromHandle = await processDropItemsWithHandle(items);
        console.log('FileSystemHandle API result:', filesFromHandle);
        if (filesFromHandle !== null) {
            console.log('Returning files from FileSystemHandle API, count:', filesFromHandle.length);
            return filesFromHandle;
        }
    }
    catch (error) {
        console.warn('Error processing with FileSystemHandle API:', error);
    }
    // Fallback to Entry API
    try {
        console.log('Trying Entry API fallback');
        const filesFromEntry = await processDropItemsWithEntry(items);
        console.log('Entry API result, count:', filesFromEntry.length);
        return filesFromEntry;
    }
    catch (error) {
        console.warn('Error processing with Entry API:', error);
        return [];
    }
};
// Promise wrapper for webkitGetAsEntry
const webkitGetAsEntryPromise = (item) => {
    if ('webkitGetAsEntry' in item) {
        const entry = item.webkitGetAsEntry();
        console.log('webkitGetAsEntry returned:', entry);
        if (entry) {
            console.log('Entry name:', entry.name);
            console.log('Entry isFile:', entry.isFile);
            console.log('Entry isDirectory:', entry.isDirectory);
            console.log('Entry fullPath:', entry.fullPath);
        }
        return entry;
    }
    return null;
};
