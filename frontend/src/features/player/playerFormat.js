// Constants and formatting shared by the video player and its panels.
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const ALL_QUALITIES = [
    { id: "4k", label: "4K (2160p)", height: 2160 },
    { id: "2k", label: "2K (1440p)", height: 1440 },
    { id: "1080p", label: "1080p", height: 1080 },
    { id: "720p", label: "720p", height: 720 },
    { id: "480p", label: "480p", height: 480 },
    { id: "360p", label: "360p", height: 360 },
    { id: "240p", label: "240p", height: 240 },
    { id: "144p", label: "144p", height: 144 },
];
export const formatTime = (seconds) => {
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) {
        return "0:00";
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
};
export const getFileExtension = (name) => {
    const parts = name.split(".");
    if (parts.length > 1) {
        return parts.pop()?.toUpperCase() || "MEDIA";
    }
    return "MEDIA";
};
