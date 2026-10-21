// What the Files view shows: Drive items in the explorer's shape, counts for the type chips,
// and the search / type / size / date filters plus sorting. Pure functions, unit tested.
import { isVideoItem, isPhotoItem, isAudioItem, isArchiveItem, isDocumentItem, DOCUMENT_EXTS } from "../fileTypes";

const DAY = 24 * 60 * 60 * 1000;

// "Other" means what the Storage page counts as other: not media, not an archive and not a
// document by Telegram type or extension. (The Documents chip still holds everything else.)
export const isOtherItem = (item) => {
    if (!item || item.type === "folder" || isVideoItem(item) || isPhotoItem(item) || isAudioItem(item) || isArchiveItem(item))
        return false;
    const ext = (item.extension || item.name?.split(".").pop() || "").toLowerCase();
    return item.fileType !== "document" && !DOCUMENT_EXTS.includes(ext);
};

/** Google Drive listing → explorer items. */
export function mapCloudItems(data, cloudAccountId) {
    if (!data?.items)
        return [];
    const accName = data.account_name || "Google Drive";
    return data.items.map((ci) => ({
        id: ci.id,
        name: ci.name,
        type: ci.type,
        size: ci.size,
        modified: ci.modified,
        file_path: `/Cloud/${accName}`,
        mime_type: ci.mimeType,
        thumbnail_url: ci.thumbnailLink,
        is_cloud: true,
        cloud_account_id: cloudAccountId,
        cloud_file_id: ci.id,
        webViewLink: ci.webViewLink,
        webContentLink: ci.webContentLink,
        is_virtual: ci.is_virtual,
        is_starred: ci.starred,
        starred: ci.starred,
        is_trashed: ci.trashed,
    }));
}

/** How many items of each kind, for the filter chips. */
export function countByType(baseItems) {
    const counts = {
        all: baseItems.length,
        folder: 0,
        video: 0,
        document: 0,
        photo: 0,
        audio: 0,
        archive: 0,
    };
    for (const item of baseItems) {
        if (!item)
            continue;
        if (item.type === "folder") {
            counts.folder += 1;
        }
        else if (isVideoItem(item)) {
            counts.video += 1;
        }
        else if (isPhotoItem(item)) {
            counts.photo += 1;
        }
        else if (isAudioItem(item)) {
            counts.audio += 1;
        }
        else if (isArchiveItem(item)) {
            counts.archive += 1;
        }
        else if (isDocumentItem(item)) {
            counts.document += 1;
        }
    }
    return counts;
}

// Newest first by deletion date, then modified date, then Telegram message order
const dateScore = (item) => {
    for (const value of [item.trashed_at, item.modified]) {
        if (value) {
            const t = new Date(value).getTime();
            if (!isNaN(t))
                return t;
        }
    }
    return typeof item.message_id === "number" ? item.message_id : 0;
};

/** Applies search, type, size and date filters, then sorts (folders first when asked). */
export function filterAndSortItems(baseItems, { searchQuery = "", typeFilter = "all", sizeFilter = "all", dateFilter = "all", sortField = "name", sortOrder = "asc", foldersFirst = true, now = Date.now() } = {}) {
    let result = [...baseItems];
    // 1. Search filter
    if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        result = result.filter((item) => (item?.name || "").toLowerCase().includes(q));
    }
    // 2. Type filter
    if (typeFilter !== "all") {
        result = result.filter((item) => {
            if (!item)
                return false;
            if (typeFilter === "folder")
                return item.type === "folder";
            if (item.type === "folder")
                return false;
            if (typeFilter === "video")
                return isVideoItem(item);
            if (typeFilter === "photo")
                return isPhotoItem(item);
            if (typeFilter === "audio")
                return isAudioItem(item);
            if (typeFilter === "archive")
                return isArchiveItem(item);
            if (typeFilter === "document")
                return isDocumentItem(item);
            if (typeFilter === "other")
                return isOtherItem(item);
            return true;
        });
    }
    // 3. Size filter
    if (sizeFilter !== "all") {
        result = result.filter((item) => {
            if (!item)
                return false;
            if (item.type === "folder")
                return true;
            const size = typeof item.size === "number" ? item.size : 0;
            if (sizeFilter === "small")
                return size < 10 * 1024 * 1024;
            if (sizeFilter === "medium")
                return size >= 10 * 1024 * 1024 && size < 100 * 1024 * 1024;
            if (sizeFilter === "large")
                return size >= 100 * 1024 * 1024 && size < 1024 * 1024 * 1024;
            if (sizeFilter === "huge")
                return size >= 1024 * 1024 * 1024;
            return true;
        });
    }
    // 4. Date filter
    if (dateFilter !== "all") {
        const oneDay = DAY;
        result = result.filter((item) => {
            if (!item)
                return false;
            const dateStr = item.trashed_at || item.modified;
            if (!dateStr)
                return true;
            const time = new Date(dateStr).getTime();
            if (isNaN(time))
                return true;
            const diff = now - time;
            if (dateFilter === "today")
                return diff <= oneDay;
            if (dateFilter === "week")
                return diff <= 7 * oneDay;
            if (dateFilter === "month")
                return diff <= 30 * oneDay;
            return true;
        });
    }
    // 5. Sorting
    result.sort((a, b) => {
        if (!a || !b)
            return 0;
        if (foldersFirst && a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
        }
        let comparison = 0;
        if (sortField === "name") {
            const nameA = a.name || "";
            const nameB = b.name || "";
            comparison = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
        }
        else if (sortField === "size") {
            const sizeA = typeof a.size === "number" ? a.size : 0;
            const sizeB = typeof b.size === "number" ? b.size : 0;
            comparison = sizeA - sizeB;
        }
        else if (sortField === "date") {
            comparison = dateScore(a) - dateScore(b);
        }
        return sortOrder === "asc" ? comparison : -comparison;
    });
    return result;
}
