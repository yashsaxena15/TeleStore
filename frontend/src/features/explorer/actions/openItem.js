// Opening an item: folders navigate, video and audio go to the player (with the folder's other
// videos or tracks as a playlist), images to the viewer, documents to the reader, archives to the
// inspector, anything else downloads. Builds the stream URLs for Telegram and Google Drive files;
// a file saved offline plays from its copy in this browser instead (faster, and works offline).
import { api, getApiBaseUrl } from "@/lib/api";
import { isSavedOffline, offlineUrlSync, prepareOfflineUrls } from "@/features/offline/offlineStore";
import { getItemKey } from "../lib/fileCardHelpers";

export function createOpenItem({ cloudAccountId, items, lastOpenTimeRef, onDownload, onNavigate, playMedia, setArchiveInspect, setDocumentReader, setImageViewer, setIsSelectionMode, setLastSelectedIndex, setSelectedItems }) {
const handleItemOpen = (item) => {
    const now = Date.now();
    if (now - lastOpenTimeRef.current < 250)
        return;
    lastOpenTimeRef.current = now;
    // Saved copies need a blob: address first (a moment's work); make them for the whole folder at once
    const saved = item.type === "folder" ? [] : [item, ...items].filter((it) => !it.is_cloud && isSavedOffline(it.id));
    if (saved.some((it) => !offlineUrlSync(it.id))) {
        prepareOfflineUrls(saved).finally(() => openNow(item));
        return;
    }
    openNow(item);
};
const openNow = (item) => {
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
    // A Telegram file's stream: the saved offline copy when there is one, else the server
    const fileUrl = (it) => {
        const local = offlineUrlSync(it.id);
        if (local) return local;
        const fId = it.id ? `&file_id=${encodeURIComponent(it.id)}` : '';
        const fPath = it.file_path ? `&path=${encodeURIComponent(it.file_path)}` : '';
        return `${baseUrl ? baseUrl : ''}/dl/${encodeURIComponent(it.name)}${tokenParam}${sep}inline=1${fId}${fPath}`;
    };
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
        const allImages = photoItems.map((it) => ({ url: fileUrl(it), fileName: it.name }));
        const currentIdx = allImages.findIndex((img) => img.fileName === item.name);
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
                        url: fileUrl(item),
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
            mediaUrl = fileUrl(item);
        }
        // If audio or video, construct a full playlist of items in current folder/view
        let folderMediaPlaylist;
        if (isAudio) {
            const audioExtensions = new Set(["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "wma"]);
            folderMediaPlaylist = items
                .filter((it) => {
                if (it.type === "folder") return false;
                const itExt = (it.extension || it.name.split('.').pop() || '').toLowerCase();
                return it.type === "audio" || it.fileType === "audio" || it.fileType === "voice" || audioExtensions.has(itExt);
            })
                .map((it) => {
                let trackUrl;
                if (it.is_cloud) {
                    trackUrl = api.getCloudStreamUrl(cloudAccountId || it.cloud_account_id, it.cloud_file_id || it.id);
                }
                else {
                    trackUrl = fileUrl(it);
                }
                return {
                    id: it.id || it.name,
                    name: it.name,
                    fileName: it.name,
                    fileType: "audio",
                    url: trackUrl,
                    size: it.size,
                    fileItem: it,
                };
            });
        }
        else if (isVideo) {
            const videoExtensions = new Set(VIDEO_EXTS);
            folderMediaPlaylist = items
                .filter((it) => {
                if (it.type === "folder") return false;
                const itExt = (it.extension || it.name.split('.').pop() || '').toLowerCase();
                return it.type === "video" || it.fileType === "video" || videoExtensions.has(itExt);
            })
                .map((it) => {
                let trackUrl;
                if (it.is_cloud) {
                    trackUrl = api.getCloudStreamUrl(cloudAccountId || it.cloud_account_id, it.cloud_file_id || it.id);
                }
                else {
                    trackUrl = fileUrl(it);
                }
                return {
                    id: it.id || it.name,
                    name: it.name,
                    fileName: it.name,
                    fileType: "video",
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
        }, folderMediaPlaylist);
    }
    else if (isDoc) {
        let docUrl;
        if (item.is_cloud) {
            docUrl = api.getCloudStreamUrl(cloudAccountId || item.cloud_account_id, item.cloud_file_id || item.id);
        }
        else {
            docUrl = fileUrl(item);
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
// Details pane: shows the single selected item, else the focused one (so it follows the arrow keys)
    return handleItemOpen;
}
