import { useState, useEffect, useRef } from "react";
import { FileText, Image as ImageIcon, FileVideo, FileAudio, FileArchive, FileSpreadsheet, Presentation } from "lucide-react";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
import { canPreview, firstStage } from "./lib/previews";
// Loaded pictures (object URLs), by Telegram thumbnail id or "preview:<file id>"
const thumbnailCache = new Map();
// Two queues: Telegram thumbnails are quick; previews may be made from the original on the
// server (HEIC, big photos, videos without a thumbnail), so they get fewer slots and more time
const QUEUES = {
    thumb: { jobs: [], active: 0, max: 6, timeout: 5000 },
    preview: { jobs: [], active: 0, max: 3, timeout: 60000 },
};
function processQueue(queue) {
    while (queue.active < queue.max && queue.jobs.length > 0) {
        const job = queue.jobs.shift();
        queue.active++;
        job();
    }
}
function queuePictureLoad(kind, key, url, onLoad, onError) {
    const queue = QUEUES[kind];
    const done = () => {
        queue.active--;
        processQueue(queue);
    };
    queue.jobs.push(() => {
        if (thumbnailCache.has(key)) {
            onLoad(thumbnailCache.get(key));
            done();
            return;
        }
        fetchWithTimeout(url, { method: 'GET' }, queue.timeout)
            .then(response => {
            if (!response.ok)
                throw new Error('Network response was not ok');
            return response.blob();
        })
            .then(blob => {
            const dataUrl = URL.createObjectURL(blob);
            thumbnailCache.set(key, dataUrl);
            onLoad(dataUrl);
        })
            .catch(() => onError())
            .finally(done);
    });
    processQueue(queue);
}
// In the browser a relative address avoids CORS; the desktop app needs the full server address
function apiUrl(path) {
    const isTauri = typeof window !== 'undefined' && !!window.__TAURI__;
    const baseUrl = isTauri ? getApiBaseUrl() : '';
    return `${baseUrl || ''}${path}`;
}
export const Thumbnail = ({ item, size = 'lg', thumbnailSrc: propThumbnailSrc, loadingState: propLoadingState }) => {
    // Define size classes based on the size prop
    const sizeClasses = {
        sm: 'w-5 h-5',
        md: 'w-10 h-10',
        lg: 'w-20 h-20',
        // Fills its box (grid tiles, details preview); real thumbnails crop to cover it
        fill: 'w-full h-full'
    };
    const currentSizeClass = sizeClasses[size];
    // "thumb" → "preview" (when the thumbnail is missing or fails) → "none" (icon)
    const [stage, setStage] = useState(() => firstStage(item));
    const [thumbnailLoading, setThumbnailLoading] = useState(true);
    const [thumbnailSrc, setThumbnailSrc] = useState(null);
    const isMounted = useRef(true);
    const fail = () => {
        setThumbnailSrc(null);
        setThumbnailLoading(true);
        setStage((current) => (current === "thumb" && canPreview(item) ? "preview" : "none"));
    };
    // Start again when the item changes
    useEffect(() => {
        setStage(firstStage(item));
        setThumbnailLoading(true);
        setThumbnailSrc(null);
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, [item.thumbnail, item.id]);
    // Use the thumbnail FileGrid already loaded, when it passes one
    useEffect(() => {
        if (stage !== "thumb" || propThumbnailSrc === undefined)
            return;
        if (propLoadingState === 'error') {
            fail();
            return;
        }
        setThumbnailSrc(propThumbnailSrc);
        setThumbnailLoading(!propThumbnailSrc);
    }, [propThumbnailSrc, propLoadingState, stage]);
    // Otherwise load it here, through the queue
    useEffect(() => {
        if (stage === "none" || (stage === "thumb" && propThumbnailSrc !== undefined))
            return;
        const key = stage === "thumb" ? item.thumbnail : `preview:${item.id}`;
        const url = stage === "thumb" ? apiUrl(`/files/thumbnail/${item.thumbnail}`) : apiUrl(`/files/preview/${encodeURIComponent(item.id)}`);
        queuePictureLoad(stage, key, url, (dataUrl) => {
            if (isMounted.current) {
                setThumbnailSrc(dataUrl);
                setThumbnailLoading(false);
            }
        }, () => {
            if (isMounted.current)
                fail();
        });
    }, [stage, item.thumbnail, item.id, propThumbnailSrc]);
    // If it's a folder, show folder icon
    if (item.type === "folder") {
        return (<div className={`${currentSizeClass} flex items-center justify-center transition-all duration-200 hover:scale-105`}>
        <div className={`${currentSizeClass} text-primary flex items-center justify-center transition-all duration-200 hover:scale-110`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
        </div>
      </div>);
    }
    // Nothing to show, or every picture failed: the type's icon
    if (stage === "none") {
        return (<div className={`${currentSizeClass} flex items-center justify-center transition-all duration-200 hover:scale-105`}>
        {getDefaultFileIcon(item)}
      </div>);
    }
    return (<div className={`relative ${currentSizeClass} flex items-center justify-center`}>
      {thumbnailLoading && (<div className="absolute inset-0 flex items-center justify-center">
          {getDefaultFileIcon(item)}
        </div>)}
      {thumbnailSrc && (<img src={thumbnailSrc} alt={item.name} className={`${size === 'fill' ? 'w-full h-full object-cover' : 'max-w-full max-h-full object-contain rounded-lg hover:scale-105 hover:shadow-lg'} transition-all duration-300 ${thumbnailLoading ? 'opacity-0' : 'opacity-100'}`} onLoad={() => {
                setThumbnailLoading(false);
            }} onError={fail}/>)}
    </div>);
};
const getDefaultFileIcon = (item) => {
    switch (item.fileType) {
        case 'photo':
            return <ImageIcon className="w-10 h-10 text-info"/>;
        case 'video':
            return <FileVideo className="w-10 h-10 text-primary"/>;
        case 'audio':
        case 'voice':
            return <FileAudio className="w-10 h-10 text-success"/>;
        case 'document':
            if (item.extension === 'pdf') {
                return <FileText className="w-10 h-10 text-destructive"/>;
            }
            else if (['doc', 'docx'].includes(item.extension || '')) {
                return <FileText className="w-10 h-10 text-info"/>;
            }
            else if (['xls', 'xlsx', 'xlsm', 'xlsb', 'xltx', 'csv', 'tsv', 'ods'].includes(item.extension || '')) {
                return <FileSpreadsheet className="w-10 h-10 text-success"/>;
            }
            else if (['pptx', 'ppt', 'ppsx', 'potx', 'pptm', 'potm'].includes(item.extension || '')) {
                return <Presentation className="w-10 h-10 text-warning"/>;
            }
            else if (['zip', 'rar', '7z'].includes(item.extension || '')) {
                return <FileArchive className="w-10 h-10 text-cloud"/>;
            }
            return <FileText className="w-10 h-10 text-muted-foreground"/>;
        default:
            return <FileText className="w-10 h-10 text-muted-foreground"/>;
    }
};
