import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Play, Pause, RotateCcw, RotateCw, Volume2, Volume1, VolumeX, Settings, Maximize, Minimize, PictureInPicture2, Captions, Check, Download, X, ArrowLeft, Info, ExternalLink, Upload, Minimize2, Maximize2, Smartphone, Copy } from "lucide-react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDockPresence } from "@/components/layout/dock/useDock";
import { downloadManager } from "@/features/transfers/downloadManager";
import { toast } from "sonner";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const ALL_QUALITIES = [
    { id: "4k", label: "4K (2160p)", height: 2160 },
    { id: "2k", label: "2K (1440p)", height: 1440 },
    { id: "1080p", label: "1080p", height: 1080 },
    { id: "720p", label: "720p", height: 720 },
    { id: "480p", label: "480p", height: 480 },
    { id: "360p", label: "360p", height: 360 },
    { id: "240p", label: "240p", height: 240 },
    { id: "144p", label: "144p", height: 144 },
];
const formatTime = (seconds) => {
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
const getFileExtension = (name) => {
    const parts = name.split(".");
    if (parts.length > 1) {
        return parts.pop()?.toUpperCase() || "MEDIA";
    }
    return "MEDIA";
};
export const MediaPlayer = ({ mediaUrl, fileName, fileType, startPosition, onClose, onDownload, }) => {
    const isMobile = useIsMobile();
    const isAudio = fileType === "audio" || fileType === "voice";
    const fullMediaUrl = useMemo(() => {
        if (!mediaUrl)
            return "";
        if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
            return mediaUrl;
        }
        if (typeof window !== "undefined") {
            return `${window.location.origin}${mediaUrl.startsWith("/") ? "" : "/"}${mediaUrl}`;
        }
        return mediaUrl;
    }, [mediaUrl]);
    // Elements
    const containerRef = useRef(null);
    const mediaElementRef = useRef(null);
    const timelineRef = useRef(null);
    const controlsTimeoutRef = useRef(null);
    const singleTapTimerRef = useRef(null);
    const lastTapTimeRef = useRef(0);
    const lastTapZoneRef = useRef("center");
    const retryCountRef = useRef(0);
    // Playback states
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedEnd, setBufferedEnd] = useState(0);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem("player_volume");
        return saved !== null ? parseFloat(saved) : 1.0;
    });
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isBuffering, setIsBuffering] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isPiPActive, setIsPiPActive] = useState(false);
    const [canPiP, setCanPiP] = useState(false);
    const [hasPlaybackError, setHasPlaybackError] = useState(false);
    const [isMini, setIsMini] = useState(false);
    // Minimized playback lives in the dock; remember position when switching theater <-> dock
    const dock = useDockPresence("video", isMini);
    const modeSwitchRef = useRef(null);
    // UI visibility states
    const [areControlsVisible, setAreControlsVisible] = useState(true);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [hoverTime, setHoverTime] = useState(null);
    const [hoverPosPercent, setHoverPosPercent] = useState(0);
    const [videoDimensions, setVideoDimensions] = useState(null);
    // Stream offset, master duration, native dimensions, and pending seek refs
    const masterDurationRef = useRef(0);
    const streamStartTimeRef = useRef(0);
    const pendingSeekRef = useRef(null);
    const nativeVideoDimensionsRef = useRef(null);
    // Format detection: browsers natively support mp4, webm, etc. MKV, avi, ts require fMP4 remuxing
    const isBrowserNative = useMemo(() => {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        return ["mp4", "m4v", "webm", "mp3", "ogg", "wav", "m4a"].includes(ext);
    }, [fileName]);
    // Dynamic stream, quality, audio & subtitle states
    const [activeStreamUrl, setActiveStreamUrl] = useState(() => {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const native = ["mp4", "m4v", "webm", "mp3", "ogg", "wav", "m4a"].includes(ext);
        if (native)
            return mediaUrl;
        const baseUrl = getApiBaseUrl() || "";
        const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
        return `${baseUrl}/media/stream/${encodeURIComponent(fileName)}${tokenParam}`;
    });
    const [currentQuality, setCurrentQuality] = useState("original");
    const [currentAudioTrack, setCurrentAudioTrack] = useState(0);
    const [audioTracks, setAudioTracks] = useState([
        { index: 0, title: "Default Audio (Original)", language: "Default" }
    ]);
    const [subtitlesList, setSubtitlesList] = useState([]);
    const [currentSubtitle, setCurrentSubtitle] = useState("off");
    const customSubtitleInputRef = useRef(null);
    const availableQualities = useMemo(() => {
        const nativeH = nativeVideoDimensionsRef.current?.height || videoDimensions?.height || 1080;
        return ALL_QUALITIES.filter((q) => q.height <= nativeH);
    }, [videoDimensions]);
    // Active overlays / submenus: 'none' | 'settings' | 'speed' | 'quality' | 'audio' | 'subtitles' | 'chapters' | 'transcript' | 'info'
    const [activeMenu, setActiveMenu] = useState("none");
    // Visual feedback states
    const [rippleFeedback, setRippleFeedback] = useState(null);
    const [centralPulse, setCentralPulse] = useState(null);
    const lastNonZeroVolume = useRef(volume > 0 ? volume : 1.0);
    // Check PiP capability on mount
    useEffect(() => {
        if (typeof document !== "undefined") {
            setCanPiP("pictureInPictureEnabled" in document && document.pictureInPictureEnabled);
        }
    }, []);
    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, []);
    // Clean, deterministic controls visibility management
    const showControls = useCallback((delay = 4500) => {
        setAreControlsVisible(true);
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
        }
        // Only auto-hide when playing, not scrubbing, and no modal menu is open
        if (isPlaying && !isScrubbing && activeMenu === "none") {
            controlsTimeoutRef.current = setTimeout(() => {
                setAreControlsVisible(false);
            }, delay);
        }
    }, [isPlaying, isScrubbing, activeMenu]);
    const hideControls = useCallback(() => {
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
        }
        if (activeMenu === "none" && !isScrubbing) {
            setAreControlsVisible(false);
        }
    }, [activeMenu, isScrubbing]);
    // When playing state or active menu changes, update timeout
    useEffect(() => {
        if (isPlaying && activeMenu === "none" && !isScrubbing) {
            showControls(4500);
        }
        else {
            // Keep controls visible when paused or menu is open
            setAreControlsVisible(true);
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
                controlsTimeoutRef.current = null;
            }
        }
        return () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
        };
    }, [isPlaying, activeMenu, isScrubbing, showControls]);
    // Clean up timers on unmount
    useEffect(() => {
        return () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
            if (singleTapTimerRef.current) {
                clearTimeout(singleTapTimerRef.current);
            }
        };
    }, []);
    // Video/Audio playback actions
    const togglePlay = useCallback(() => {
        const el = mediaElementRef.current;
        if (!el)
            return;
        if (el.paused) {
            el.play().then(() => {
                setIsPlaying(true);
                setCentralPulse("play");
                setTimeout(() => setCentralPulse(null), 500);
                showControls(4500);
            }).catch((err) => {
                console.warn("Play failed:", err);
            });
        }
        else {
            el.pause();
            setIsPlaying(false);
            setCentralPulse("pause");
            setTimeout(() => setCentralPulse(null), 500);
            setAreControlsVisible(true);
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
                controlsTimeoutRef.current = null;
            }
        }
    }, [showControls]);
    // Build deterministic stream URL based on quality, audio track, and start time
    const buildStreamUrl = useCallback((q, aTrack, startTimeSec) => {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const native = ["mp4", "m4v", "webm", "mp3", "ogg", "wav", "m4a"].includes(ext);
        if (q === "original" && aTrack === 0 && native) {
            return mediaUrl;
        }
        const baseUrl = getApiBaseUrl() || "";
        const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
        const params = new URLSearchParams();
        if (token)
            params.set("token", token);
        if (q !== "original")
            params.set("quality", q);
        if (aTrack !== 0)
            params.set("audio_track", aTrack.toString());
        if (startTimeSec > 0)
            params.set("start_time", Math.floor(startTimeSec).toString());
        const queryStr = params.toString();
        return `${baseUrl}/media/stream/${encodeURIComponent(fileName)}${queryStr ? `?${queryStr}` : ""}`;
    }, [fileName, mediaUrl]);
    // Seamless unified seek handler: works for both raw stream and transcode stream
    const seekTo = useCallback((targetTime) => {
        const el = mediaElementRef.current;
        if (!el)
            return;
        const totalDur = masterDurationRef.current || duration || 0;
        const clamped = Math.min(Math.max(0, targetTime), totalDur > 0 ? totalDur : Math.max(0, targetTime));
        setCurrentTime(clamped);
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const native = ["mp4", "m4v", "webm", "mp3", "ogg", "wav", "m4a"].includes(ext);
        // If we are playing the original stream on a native format (HTTP Range hits 0ms RAM cache)
        if (native && currentQuality === "original" && currentAudioTrack === 0) {
            streamStartTimeRef.current = 0;
            el.currentTime = clamped;
            return;
        }
        // If we are on a transcoded / remuxed stream: restart stream at offset
        const wasPlaying = isPlaying;
        streamStartTimeRef.current = clamped;
        setIsBuffering(true);
        const newUrl = buildStreamUrl(currentQuality, currentAudioTrack, clamped);
        setActiveStreamUrl(newUrl);
        el.load();
        if (wasPlaying) {
            el.play().catch(() => { });
        }
    }, [currentQuality, currentAudioTrack, duration, isPlaying, buildStreamUrl, fileName]);
    const seekRelative = useCallback((deltaSeconds) => {
        const target = currentTime + deltaSeconds;
        seekTo(target);
        const type = deltaSeconds < 0 ? "rewind" : "forward";
        setRippleFeedback({ type, id: Date.now() });
        setTimeout(() => {
            setRippleFeedback((prev) => (prev?.type === type ? null : prev));
        }, 600);
        showControls(4500);
    }, [currentTime, seekTo, showControls]);
    // Theater and dock use separate <video> elements: carry over position and play state
    const switchPlayerMode = useCallback((mini) => {
        modeSwitchRef.current = { time: currentTime, play: isPlaying };
        setIsMini(mini);
    }, [currentTime, isPlaying]);
    const resumeAfterModeSwitch = () => {
        const pending = modeSwitchRef.current;
        if (!pending)
            return;
        modeSwitchRef.current = null;
        if (pending.time > 1)
            seekTo(pending.time);
        if (pending.play)
            mediaElementRef.current?.play().catch(() => { });
    };
    // Starting audio pauses the video (one thing plays at a time)
    useEffect(() => {
        const pause = () => mediaElementRef.current?.pause();
        window.addEventListener("telestore:pause-video", pause);
        return () => window.removeEventListener("telestore:pause-video", pause);
    }, []);
    const handleVolumeChange = useCallback((newVol) => {
        const el = mediaElementRef.current;
        const clamped = Math.min(1, Math.max(0, newVol));
        setVolume(clamped);
        localStorage.setItem("player_volume", clamped.toString());
        if (clamped > 0) {
            lastNonZeroVolume.current = clamped;
            setIsMuted(false);
        }
        else {
            setIsMuted(true);
        }
        if (el) {
            el.volume = clamped;
            el.muted = clamped === 0;
        }
        showControls(4500);
    }, [showControls]);
    const toggleMute = useCallback(() => {
        const el = mediaElementRef.current;
        if (!el)
            return;
        if (isMuted || volume === 0) {
            const restored = lastNonZeroVolume.current || 1.0;
            setVolume(restored);
            setIsMuted(false);
            el.volume = restored;
            el.muted = false;
        }
        else {
            lastNonZeroVolume.current = volume;
            setVolume(0);
            setIsMuted(true);
            el.volume = 0;
            el.muted = true;
        }
        showControls(4500);
    }, [isMuted, volume, showControls]);
    const handlePlaybackRateChange = useCallback((rate) => {
        const el = mediaElementRef.current;
        setPlaybackRate(rate);
        if (el) {
            el.playbackRate = rate;
        }
        showControls(4500);
    }, [showControls]);
    const toggleFullscreen = useCallback(() => {
        const container = containerRef.current;
        if (!container)
            return;
        if (!document.fullscreenElement) {
            container.requestFullscreen?.().catch((err) => console.warn("Fullscreen request error:", err));
        }
        else {
            document.exitFullscreen?.().catch((err) => console.warn("Exit fullscreen error:", err));
        }
        showControls(4500);
    }, [showControls]);
    const togglePiP = useCallback(async () => {
        const video = mediaElementRef.current;
        if (!video || !canPiP)
            return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                setIsPiPActive(false);
            }
            else {
                await video.requestPictureInPicture();
                setIsPiPActive(true);
            }
        }
        catch (err) {
            console.warn("PiP toggle error:", err);
        }
        showControls(4500);
    }, [canPiP, showControls]);
    const handleDownloadAction = useCallback(() => {
        if (onDownload) {
            onDownload();
        }
        else {
            downloadManager.addDownload(mediaUrl, fileName);
            toast.success(`Download started: ${fileName}`);
        }
    }, [onDownload, mediaUrl, fileName]);
    // Timeline Scrubbing Handlers
    const handleTimelinePointerDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const timeline = timelineRef.current;
        const totalDur = masterDurationRef.current || duration;
        if (!timeline || !totalDur)
            return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsScrubbing(true);
        setAreControlsVisible(true);
        const rect = timeline.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const newTime = ratio * totalDur;
        setCurrentTime(newTime);
    };
    const handleTimelinePointerMove = (e) => {
        const timeline = timelineRef.current;
        const totalDur = masterDurationRef.current || duration;
        if (!timeline || !totalDur)
            return;
        const rect = timeline.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const newTime = ratio * totalDur;
        setHoverPosPercent(ratio * 100);
        setHoverTime(newTime);
        if (isScrubbing) {
            setCurrentTime(newTime);
        }
    };
    const handleTimelinePointerUp = (e) => {
        if (isScrubbing) {
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
            catch { }
            setIsScrubbing(false);
            showControls(4500);
            // Commit the seek cleanly
            seekTo(currentTime);
        }
    };
    const handleTimelinePointerLeave = () => {
        if (!isScrubbing) {
            setHoverTime(null);
        }
    };
    // Keyboard Shortcuts (Desktop)
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Player shortcuts belong to theater mode; while docked, the page owns the keyboard
            if (isMini)
                return;
            const active = document.activeElement;
            if (active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)) {
                return;
            }
            switch (e.key) {
                case " ":
                case "k":
                case "K":
                    e.preventDefault();
                    togglePlay();
                    break;
                case "ArrowLeft":
                case "j":
                case "J":
                    e.preventDefault();
                    seekRelative(-10);
                    break;
                case "ArrowRight":
                case "l":
                case "L":
                    e.preventDefault();
                    seekRelative(10);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    handleVolumeChange(volume + 0.1);
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    handleVolumeChange(volume - 0.1);
                    break;
                case "m":
                case "M":
                    e.preventDefault();
                    toggleMute();
                    break;
                case "f":
                case "F":
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case "Escape":
                    if (isFullscreen) {
                        document.exitFullscreen?.();
                    }
                    else if (activeMenu !== "none") {
                        setActiveMenu("none");
                    }
                    else {
                        onClose();
                    }
                    break;
                case "<":
                case ",": {
                    e.preventDefault();
                    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
                    if (currentIndex > 0) {
                        handlePlaybackRateChange(PLAYBACK_RATES[currentIndex - 1]);
                    }
                    break;
                }
                case ">":
                case ".": {
                    e.preventDefault();
                    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
                    if (currentIndex < PLAYBACK_RATES.length - 1) {
                        handlePlaybackRateChange(PLAYBACK_RATES[currentIndex + 1]);
                    }
                    break;
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        isMini,
        togglePlay,
        seekRelative,
        handleVolumeChange,
        volume,
        toggleMute,
        toggleFullscreen,
        isFullscreen,
        activeMenu,
        onClose,
        playbackRate,
        handlePlaybackRateChange,
    ]);
    // Robust Viewport Pointer/Tap Handler:
    // Handles Single Tap (Toggle controls on touch / Play-Pause on desktop)
    // and Double Tap (Seek -10s left / +10s right) without race conditions.
    const handleViewportPointerUp = (e) => {
        // If a menu or modal is open, tapping the viewport closes it and reveals controls
        if (activeMenu !== "none") {
            setActiveMenu("none");
            showControls(4500);
            return;
        }
        const isTouch = e.pointerType === "touch" || e.pointerType === "pen";
        const rect = e.currentTarget.getBoundingClientRect();
        const xRatio = (e.clientX - rect.left) / rect.width;
        let zone = "center";
        if (xRatio < 0.35)
            zone = "left";
        else if (xRatio > 0.65)
            zone = "right";
        const now = Date.now();
        const timeSinceLastTap = now - lastTapTimeRef.current;
        const isDoubleTap = timeSinceLastTap < 300 && lastTapZoneRef.current === zone;
        if (isDoubleTap) {
            // Double-tap detected: cancel single-tap action
            if (singleTapTimerRef.current) {
                clearTimeout(singleTapTimerRef.current);
                singleTapTimerRef.current = null;
            }
            lastTapTimeRef.current = 0;
            lastTapZoneRef.current = "center";
            if (zone === "left") {
                seekRelative(-10);
            }
            else if (zone === "right") {
                seekRelative(10);
            }
            else {
                togglePlay();
            }
            showControls(4500);
        }
        else {
            // First tap: register timestamp and schedule single-tap action
            lastTapTimeRef.current = now;
            lastTapZoneRef.current = zone;
            if (singleTapTimerRef.current) {
                clearTimeout(singleTapTimerRef.current);
            }
            singleTapTimerRef.current = setTimeout(() => {
                singleTapTimerRef.current = null;
                if (isTouch) {
                    // On touch screens: single tap toggles controls visibility
                    setAreControlsVisible((prev) => {
                        if (!prev) {
                            // If controls were hidden, show them and keep visible for 4.5s
                            showControls(4500);
                            return true;
                        }
                        else {
                            // If controls were already visible, hide them immediately
                            hideControls();
                            return false;
                        }
                    });
                }
                else {
                    // On desktop mouse: single click toggles play/pause
                    togglePlay();
                }
            }, 260);
        }
    };
    // Video event listeners
    const handleTimeUpdate = () => {
        const el = mediaElementRef.current;
        if (!el || isScrubbing)
            return;
        const realTime = streamStartTimeRef.current + el.currentTime;
        setCurrentTime(realTime);
    };
    const handleProgress = () => {
        const el = mediaElementRef.current;
        if (!el || !el.buffered || el.buffered.length === 0)
            return;
        const current = el.currentTime;
        const offset = streamStartTimeRef.current;
        for (let i = 0; i < el.buffered.length; i++) {
            if (el.buffered.start(i) <= current && current <= el.buffered.end(i)) {
                setBufferedEnd(offset + el.buffered.end(i));
                return;
            }
        }
        setBufferedEnd(offset + el.buffered.end(el.buffered.length - 1));
    };
    const handleLoadedMetadata = () => {
        const el = mediaElementRef.current;
        if (!el)
            return;
        // Check if this stream has a valid finite duration
        if (el.duration && isFinite(el.duration) && el.duration > 0) {
            if (masterDurationRef.current === 0 || activeStreamUrl === mediaUrl) {
                masterDurationRef.current = el.duration;
                setDuration(el.duration);
            }
        }
        else if (masterDurationRef.current > 0) {
            setDuration(masterDurationRef.current);
        }
        // Set native video dimensions once (or when on original stream)
        if (!isAudio && el instanceof HTMLVideoElement) {
            if (!nativeVideoDimensionsRef.current || (activeStreamUrl === mediaUrl && currentQuality === "original")) {
                const dims = { width: el.videoWidth, height: el.videoHeight };
                nativeVideoDimensionsRef.current = dims;
                setVideoDimensions(dims);
            }
        }
        // Apply pending seek if returning to original stream or switching
        if (pendingSeekRef.current !== null) {
            const target = pendingSeekRef.current;
            pendingSeekRef.current = null;
            try {
                el.currentTime = target;
            }
            catch (err) {
                console.warn("Failed to set currentTime on loadedmetadata:", err);
            }
        }
        setIsBuffering(false);
    };
    // Fetch media tracks info on mount
    useEffect(() => {
        if (isAudio)
            return;
        const baseUrl = getApiBaseUrl() || "";
        const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
        fetchWithTimeout(`${baseUrl}/media/info/${encodeURIComponent(fileName)}${tokenParam}`, {
            credentials: "include",
        }, 8000)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
            if (!data)
                return;
            if (data.duration && isFinite(data.duration) && data.duration > 0) {
                masterDurationRef.current = data.duration;
                setDuration(data.duration);
            }
            if (data.height && data.width) {
                const dims = { width: data.width, height: data.height };
                nativeVideoDimensionsRef.current = dims;
                setVideoDimensions(dims);
            }
            if (data.audio_tracks && data.audio_tracks.length > 0) {
                setAudioTracks(data.audio_tracks);
            }
            if (data.subtitle_tracks && data.subtitle_tracks.length > 0) {
                const mappedSubs = data.subtitle_tracks.map((sub) => ({
                    id: `embedded-${sub.index}`,
                    label: `${sub.title || sub.language} (Embedded)`,
                    src: `${baseUrl}/media/subtitles/${encodeURIComponent(fileName)}?track=${sub.index}${token ? `&token=${encodeURIComponent(token)}` : ""}`,
                }));
                setSubtitlesList((prev) => {
                    const customOnly = prev.filter((p) => p.isCustom);
                    return [...mappedSubs, ...customOnly];
                });
            }
        })
            .catch((err) => {
            console.warn("Failed to fetch media tracks info:", err);
        });
    }, [fileName, isAudio]);
    // Sync active text tracks when currentSubtitle changes
    useEffect(() => {
        const el = mediaElementRef.current;
        if (!el)
            return;
        const tracks = el.textTracks;
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = currentSubtitle !== "off" ? "showing" : "disabled";
        }
    }, [currentSubtitle]);
    // Quality change handler
    const handleQualityChange = (q) => {
        if (q === currentQuality)
            return;
        const videoEl = mediaElementRef.current;
        const wasPlaying = isPlaying;
        const seekTime = currentTime; // True current playback position!
        setCurrentQuality(q);
        setActiveMenu("none");
        setIsBuffering(true);
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const native = ["mp4", "m4v", "webm", "mp3", "ogg", "wav", "m4a"].includes(ext);
        if (q === "original" && currentAudioTrack === 0 && native) {
            // Switching back to Auto (Original) with default audio on native format
            streamStartTimeRef.current = 0;
            pendingSeekRef.current = seekTime;
            setActiveStreamUrl(mediaUrl);
        }
        else {
            // Transcode / remux stream
            streamStartTimeRef.current = seekTime;
            const newUrl = buildStreamUrl(q, currentAudioTrack, seekTime);
            setActiveStreamUrl(newUrl);
        }
        if (videoEl) {
            videoEl.load();
            if (wasPlaying) {
                videoEl.play().catch(() => { });
            }
        }
        toast.info(`Switched quality to ${q === "original" ? "Auto (Original)" : q}`);
    };
    const handleQualityChangeRef = useRef(handleQualityChange);
    handleQualityChangeRef.current = handleQualityChange;
    // Audio track change handler
    const handleAudioTrackChange = (trackIndex) => {
        if (trackIndex === currentAudioTrack)
            return;
        const videoEl = mediaElementRef.current;
        const wasPlaying = isPlaying;
        const seekTime = currentTime; // True current playback position!
        setCurrentAudioTrack(trackIndex);
        setActiveMenu("none");
        setIsBuffering(true);
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const native = ["mp4", "m4v", "webm", "mp3", "ogg", "wav", "m4a"].includes(ext);
        if (currentQuality === "original" && trackIndex === 0 && native) {
            // Switching back to default audio on original direct stream
            streamStartTimeRef.current = 0;
            pendingSeekRef.current = seekTime;
            setActiveStreamUrl(mediaUrl);
        }
        else {
            // Custom audio track stream (remuxed or transcoded)
            streamStartTimeRef.current = seekTime;
            const newUrl = buildStreamUrl(currentQuality, trackIndex, seekTime);
            setActiveStreamUrl(newUrl);
        }
        const trackLabel = audioTracks[trackIndex]?.title || `Track ${trackIndex + 1}`;
        toast.info(`Switched audio to ${trackLabel}`);
        if (videoEl) {
            videoEl.load();
            if (wasPlaying) {
                videoEl.play().catch(() => { });
            }
        }
    };
    // Stall protection: if buffering stalls on original MKV/non-native stream for > 6s, switch to 1080p
    useEffect(() => {
        if (!isBuffering || currentQuality !== "original")
            return;
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        if (ext !== "mkv" && ext !== "avi" && ext !== "ts")
            return;
        const timer = setTimeout(() => {
            if (isBuffering && currentQuality === "original") {
                console.log("Stall detected on original MKV stream, optimizing with 1080p transcode...");
                toast.info("Buffering detected: optimizing video for your browser...");
                handleQualityChangeRef.current("1080p");
            }
        }, 6000);
        return () => clearTimeout(timer);
    }, [isBuffering, currentQuality, fileName]);
    // Custom subtitle upload handler (.srt / .vtt)
    const handleCustomSubtitleUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result;
            if (!text)
                return;
            let vttContent = text;
            // Convert SRT to WebVTT if it's .srt
            if (file.name.toLowerCase().endsWith(".srt")) {
                vttContent = "WEBVTT\n\n" + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
            }
            const blob = new Blob([vttContent], { type: "text/vtt" });
            const blobUrl = URL.createObjectURL(blob);
            const newSub = {
                id: `upload-${Date.now()}`,
                label: file.name,
                src: blobUrl,
                isCustom: true,
            };
            setSubtitlesList((prev) => [...prev, newSub]);
            setCurrentSubtitle(newSub.id);
            setActiveMenu("none");
            toast.success(`Loaded subtitle: ${file.name}`);
        };
        reader.readAsText(file);
    };
    const playedPercent = useMemo(() => {
        if (!duration || duration === 0)
            return 0;
        return Math.min(100, Math.max(0, (currentTime / duration) * 100));
    }, [currentTime, duration]);
    const bufferedPercent = useMemo(() => {
        if (!duration || duration === 0)
            return 0;
        return Math.min(100, Math.max(0, (bufferedEnd / duration) * 100));
    }, [bufferedEnd, duration]);
    const fileExt = useMemo(() => getFileExtension(fileName), [fileName]);
    // Docked (minimized) video: compact controls rendered into the app dock
    if (isMini) {
        const docked = (<div className="flex items-center gap-2.5 w-full min-w-0">
          <button onClick={() => switchPlayerMode(false)} className="group relative w-[84px] h-[47px] rounded-md overflow-hidden bg-black shrink-0 border border-border" title="Open in theater mode" aria-label="Open video in theater mode">
            <video ref={mediaElementRef} src={activeStreamUrl} preload="auto" playsInline crossOrigin="anonymous" className="w-full h-full object-cover pointer-events-none" onTimeUpdate={handleTimeUpdate} onProgress={handleProgress} onLoadedMetadata={handleLoadedMetadata} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onWaiting={() => setIsBuffering(true)} onPlaying={() => {
                setIsBuffering(false);
                setHasPlaybackError(false);
            }} onCanPlay={() => {
                setIsBuffering(false);
                setHasPlaybackError(false);
                resumeAfterModeSwitch();
            }}/>
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
              <Maximize2 className="w-4 h-4 text-white"/>
            </span>
          </button>
          <div className="min-w-0 flex-1 md:flex-none md:w-44 lg:w-60">
            <div className="text-[13px] font-medium truncate" title={fileName}>{fileName}</div>
            <div className="text-[11px] text-muted-foreground font-mono">{isBuffering ? "Buffering…" : `${formatTime(currentTime)} / ${formatTime(duration)}`}</div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => seekTo(currentTime - 10)} className="hidden sm:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="Back 10 seconds" aria-label="Back 10 seconds">
              <RotateCcw className="w-4 h-4"/>
            </button>
            <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 active:scale-95 transition-transform" aria-label={isPlaying ? "Pause video" : "Play video"}>
              {isPlaying ? <Pause className="w-4 h-4 fill-current"/> : <Play className="w-4 h-4 fill-current ml-0.5"/>}
            </button>
            <button onClick={() => seekTo(currentTime + 10)} className="hidden sm:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="Forward 10 seconds" aria-label="Forward 10 seconds">
              <RotateCw className="w-4 h-4"/>
            </button>
          </div>
          <input type="range" min={0} max={duration || 0} step={1} value={Math.min(currentTime, duration || 0)} onChange={(e) => seekTo(Number(e.target.value))} className="hidden md:block flex-1 min-w-0 h-1 accent-primary cursor-pointer" aria-label="Seek video"/>
          <button onClick={() => switchPlayerMode(false)} className="hidden md:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0" title="Theater mode" aria-label="Open video in theater mode">
            <Maximize2 className="w-4 h-4"/>
          </button>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0" title="Close video" aria-label="Close video">
            <X className="w-4 h-4"/>
          </button>
        </div>);
        return dock?.mediaSlot ? createPortal(docked, dock.mediaSlot) : null;
    }
    // =========================================================================
    // Google Drive Style Video Player
    // =========================================================================
    return (<div ref={containerRef} onMouseMove={() => showControls(4000)} className={`fixed inset-0 z-50 bg-[#0a0a0a] text-white flex flex-col select-none overflow-hidden ${!areControlsVisible && isPlaying ? "cursor-none" : "cursor-default"}`}>
      {/* Native Video Element */}
      <video ref={mediaElementRef} src={activeStreamUrl} preload="auto" playsInline crossOrigin="anonymous" className="w-full h-full object-contain pointer-events-none" onTimeUpdate={handleTimeUpdate} onProgress={handleProgress} onLoadedMetadata={handleLoadedMetadata} onPlay={() => {
            setIsPlaying(true);
            showControls(4500);
        }} onPause={() => {
            setIsPlaying(false);
            setAreControlsVisible(true);
        }} onEnded={() => {
            setIsPlaying(false);
            setAreControlsVisible(true);
        }} onWaiting={() => setIsBuffering(true)} onPlaying={() => {
            setIsBuffering(false);
            setHasPlaybackError(false);
        }} onCanPlay={() => {
            setIsBuffering(false);
            setHasPlaybackError(false);
            resumeAfterModeSwitch();
            if (pendingSeekRef.current !== null && mediaElementRef.current) {
                const target = pendingSeekRef.current;
                pendingSeekRef.current = null;
                try {
                    mediaElementRef.current.currentTime = target;
                }
                catch (err) {
                    console.warn("Failed to set currentTime on canplay:", err);
                }
            }
        }} onError={() => {
            const videoEl = mediaElementRef.current;
            const err = videoEl?.error;
            console.warn("Video playback error code:", err?.code, err?.message);
            // Code 1: MEDIA_ERR_ABORTED - aborted by browser during seek or range change
            if (err && err.code === 1) {
                return;
            }
            // Code 2: MEDIA_ERR_NETWORK - network issue or temporary Telegram hiccup
            if (err && err.code === 2) {
                if (retryCountRef.current < 3) {
                    retryCountRef.current += 1;
                    console.log("Retrying video playback after network error, attempt:", retryCountRef.current);
                    setIsBuffering(true);
                    setTimeout(() => {
                        if (mediaElementRef.current) {
                            mediaElementRef.current.load();
                            mediaElementRef.current.play().catch(() => { });
                        }
                    }, 1200);
                    return;
                }
            }
            // Code 3: MEDIA_ERR_DECODE or Code 4: MEDIA_ERR_SRC_NOT_SUPPORTED
            // Browser cannot decode this format (e.g. 4K HEVC unsupported profile)
            if ((err?.code === 3 || err?.code === 4) && currentQuality === "original") {
                console.log("Codec not supported by browser, falling back to 1080p transcode...");
                toast.info("Optimizing video playback for your browser...");
                handleQualityChange("1080p");
                return;
            }
            setHasPlaybackError(true);
            setIsBuffering(false);
        }}>
        {subtitlesList
            .filter((sub) => sub.id === currentSubtitle)
            .map((sub) => (<track key={sub.id} kind="subtitles" src={sub.src} label={sub.label} srcLang="en" default/>))}
      </video>

      {/* Interactive Video Viewport: Double-tap left/right & Tap to toggle controls */}
      <div className="absolute inset-0 z-10 touch-manipulation cursor-pointer" onPointerUp={handleViewportPointerUp}/>

      {/* Buffering Spinner */}
      {isBuffering && (<div className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none">
          <div className="w-14 h-14 rounded-full border-4 border-white/20 border-t-white animate-spin mb-3 shadow-lg"/>
          <span className="text-xs sm:text-sm text-white/80 font-medium tracking-wide drop-shadow-md">
            Buffering video stream...
          </span>
        </div>)}

      {/* Central Play/Pause Pulse Feedback */}
      {centralPulse && (<div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none animate-out fade-out zoom-out-95 duration-500">
          <div className="w-20 h-20 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-2xl">
            {centralPulse === "play" ? (<Play className="w-10 h-10 fill-current ml-1"/>) : (<Pause className="w-10 h-10 fill-current"/>)}
          </div>
        </div>)}

      {/* Double Tap Ripple Animations (+10s / -10s) */}
      {rippleFeedback && (<div className={`absolute top-1/2 -translate-y-1/2 z-20 pointer-events-none flex flex-col items-center justify-center w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-black/65 backdrop-blur-md border border-white/20 animate-in fade-in zoom-in-75 duration-200 ${rippleFeedback.type === "rewind" ? "left-8 sm:left-24" : "right-8 sm:right-24"}`}>
          {rippleFeedback.type === "rewind" ? (<>
              <RotateCcw className="w-9 h-9 sm:w-10 sm:h-10 text-white animate-spin-once"/>
              <span className="text-xs sm:text-sm font-bold tracking-wider text-white mt-1">-10s</span>
            </>) : (<>
              <RotateCw className="w-9 h-9 sm:w-10 sm:h-10 text-white animate-spin-once"/>
              <span className="text-xs sm:text-sm font-bold tracking-wider text-white mt-1">+10s</span>
            </>)}
        </div>)}

      {/* ================================================================= */}
      {/* Top Header Bar (Google Drive Style)                                */}
      {/* ================================================================= */}
      <div onClick={(e) => {
            e.stopPropagation();
            showControls(5000);
        }} onPointerDown={(e) => {
            e.stopPropagation();
            showControls(5000);
        }} className={`absolute top-0 left-0 right-0 z-30 transition-all duration-300 ease-out bg-gradient-to-b from-black/90 via-black/50 to-transparent pt-3 pb-8 px-3 sm:px-6 flex items-center justify-between ${areControlsVisible || !isPlaying || activeMenu !== "none"
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-full pointer-events-none"}`}>
        {/* Left: Back Arrow + Title + Format Badge */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 pr-2">
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center" title="Back / Close" aria-label="Back / Close">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6"/>
          </button>
          <div className="flex items-center space-x-2 min-w-0">
            <span className="text-white text-sm sm:text-base font-semibold truncate max-w-[170px] sm:max-w-md md:max-w-xl lg:max-w-2xl drop-shadow-sm">
              {fileName}
            </span>
            <span className="px-1.5 py-0.5 text-[10px] sm:text-xs font-mono font-bold uppercase rounded bg-white/15 text-white/80 border border-white/10 flex-shrink-0 tracking-wider">
              {fileExt}
            </span>
          </div>
        </div>

        {/* Right: Actions (External Player, Download, Info, Close) */}
        <div className="flex items-center space-x-0.5 sm:space-x-1 flex-shrink-0">
          <button onClick={() => {
            setActiveMenu((prev) => (prev === "external" ? "none" : "external"));
            showControls(5000);
        }} className={`p-2 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center ${activeMenu === "external" ? "bg-primary text-primary-foreground" : ""}`} title="Open in external player (VLC / MX Player)" aria-label="Open in external player">
            <ExternalLink className="w-5 h-5"/>
          </button>
          <button onClick={handleDownloadAction} className="p-2 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center" title="Download file" aria-label="Download file">
            <Download className="w-5 h-5"/>
          </button>
          <button onClick={() => setActiveMenu((prev) => (prev === "info" ? "none" : "info"))} className={`p-2 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center ${activeMenu === "info" ? "bg-white/20 text-white" : ""}`} title="File details" aria-label="File details">
            <Info className="w-5 h-5"/>
          </button>
          <button onClick={() => {
            switchPlayerMode(true);
            showControls(3000);
        }} className="p-2 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center" title="Minimize to dock" aria-label="Minimize to dock">
            <Minimize2 className="w-5 h-5"/>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Bottom Control Bar (Google Drive Style)                            */}
      {/* ================================================================= */}
      <div onClick={(e) => {
            e.stopPropagation();
            showControls(5000);
        }} onPointerDown={(e) => {
            e.stopPropagation();
            showControls(5000);
        }} className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-300 ease-out bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-10 pb-3 sm:pb-4 px-3 sm:px-6 flex flex-col ${areControlsVisible || !isPlaying || activeMenu !== "none"
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-full pointer-events-none"}`}>
        {/* Timeline Scrubber */}
        <div className="relative w-full pb-1 sm:pb-2">
          {/* Hover Timestamp Tooltip */}
          {hoverTime !== null && (<div className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-zinc-900/90 text-white text-[11px] font-mono border border-white/20 shadow-lg pointer-events-none" style={{ left: `${Math.min(96, Math.max(4, hoverPosPercent))}%` }}>
              {formatTime(hoverTime)}
            </div>)}

          <div ref={timelineRef} onPointerDown={handleTimelinePointerDown} onPointerMove={handleTimelinePointerMove} onPointerUp={handleTimelinePointerUp} onPointerLeave={handleTimelinePointerLeave} className="group relative h-6 flex items-center cursor-pointer touch-none" aria-label="Seek timeline">
            <div className="w-full h-1.5 group-hover:h-2.5 bg-white/20 rounded-full relative overflow-hidden transition-all duration-150">
              {/* Buffered progress bar */}
              <div className="absolute left-0 top-0 h-full bg-white/35 rounded-full transition-all duration-150" style={{ width: `${bufferedPercent}%` }}/>
              {/* Played progress bar */}
              <div className="absolute left-0 top-0 h-full bg-primary rounded-full transition-all duration-75" style={{ width: `${playedPercent}%` }}/>
            </div>
            {/* Scrubber thumb handle */}
            <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-lg transition-transform pointer-events-none ${isScrubbing
            ? "scale-125 bg-primary"
            : isMobile
                ? "scale-100"
                : "scale-0 group-hover:scale-100"}`} style={{ left: `${playedPercent}%` }}/>
          </div>
        </div>

        {/* Playback Controls Row */}
        <div className="flex items-center justify-between text-white">
          {/* Left Controls: Play, Rewind 10s, Forward 10s, Time, Volume */}
          <div className="flex items-center space-x-1 sm:space-x-2">
            {/* Play/Pause Button */}
            <button onClick={togglePlay} className="p-2 sm:p-2.5 rounded-full hover:bg-white/10 text-white transition-transform active:scale-90 focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center" title={isPlaying ? "Pause (Space/k)" : "Play (Space/k)"} aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? (<Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-current"/>) : (<Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current ml-0.5"/>)}
            </button>

            {/* Rewind 10s */}
            <button onClick={() => seekRelative(-10)} className="p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors relative focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title="Rewind 10 seconds (Left Arrow/j)" aria-label="Rewind 10 seconds">
              <RotateCcw className="w-5 h-5"/>
              <span className="absolute text-[8px] font-bold top-2 left-2">10</span>
            </button>

            {/* Forward 10s */}
            <button onClick={() => seekRelative(10)} className="p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors relative focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title="Forward 10 seconds (Right Arrow/l)" aria-label="Forward 10 seconds">
              <RotateCw className="w-5 h-5"/>
              <span className="absolute text-[8px] font-bold top-2 left-2">10</span>
            </button>

            {/* Time Indicator */}
            <div className="text-xs sm:text-sm font-mono text-white/85 tracking-tight px-1 select-none tabular-nums">
              <span>{formatTime(currentTime)}</span>
              <span className="text-white/40 mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Volume Control (desktop / tablet) */}
            <div className="hidden sm:flex items-center space-x-1 pl-2">
              <button onClick={toggleMute} className="p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40" title={isMuted ? "Unmute (m)" : "Mute (m)"} aria-label={isMuted ? "Unmute" : "Mute"}>
                {isMuted || volume === 0 ? (<VolumeX className="w-5 h-5"/>) : volume < 0.5 ? (<Volume1 className="w-5 h-5"/>) : (<Volume2 className="w-5 h-5"/>)}
              </button>
              <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={(e) => handleVolumeChange(parseFloat(e.target.value))} className="w-16 sm:w-20 h-1 accent-primary bg-white/20 rounded-full cursor-pointer transition-all" aria-label="Volume slider"/>
            </div>
          </div>

          {/* Right Controls: Subtitles, Settings, PiP, Fullscreen */}
          <div className="flex items-center space-x-1 sm:space-x-2 relative">
            {/* Subtitles / CC Toggle */}
            <button onClick={(e) => {
            e.stopPropagation();
            setActiveMenu((prev) => (prev === "subtitles" ? "none" : "subtitles"));
            showControls(5000);
        }} className={`p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center ${activeMenu === "subtitles" ? "bg-white/20 text-white" : ""}`} title="Subtitles / CC" aria-label="Subtitles / CC">
              <Captions className="w-5 h-5"/>
            </button>

            {/* Settings Gear */}
            <button onClick={(e) => {
            e.stopPropagation();
            setActiveMenu((prev) => (prev === "settings" ? "none" : "settings"));
            showControls(5000);
        }} className={`p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center ${activeMenu === "settings" ? "bg-white/20 text-white" : ""}`} title="Settings" aria-label="Settings">
              <Settings className="w-5 h-5"/>
            </button>

            {/* Picture-in-Picture (hidden on mobile small screens) */}
            {canPiP && (<button onClick={(e) => {
                e.stopPropagation();
                togglePiP();
            }} className={`hidden sm:inline-flex p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation ${isPiPActive ? "bg-primary text-primary-foreground" : ""}`} title="Picture-in-Picture" aria-label="Picture-in-Picture">
                <PictureInPicture2 className="w-5 h-5"/>
              </button>)}

            {/* Fullscreen Button */}
            <button onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
        }} className="p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title={isFullscreen ? "Exit Fullscreen (f/Esc)" : "Fullscreen (f)"} aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize className="w-5 h-5"/> : <Maximize className="w-5 h-5"/>}
            </button>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Settings Popover (Desktop) & Bottom Sheet (Mobile)                */}
      {/* ================================================================= */}
      <input ref={customSubtitleInputRef} type="file" accept=".srt,.vtt" className="hidden" onChange={handleCustomSubtitleUpload}/>
      {activeMenu !== "none" && activeMenu !== "info" && (<>
          {/* Backdrop on mobile */}
          <div onClick={(e) => {
                e.stopPropagation();
                setActiveMenu("none");
                showControls(4500);
            }} className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 sm:hidden"/>

          <div onClick={(e) => e.stopPropagation()} className="z-50 text-white bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-2xl transition-all duration-200 fixed inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh] p-4 sm:absolute sm:inset-auto sm:bottom-20 sm:right-6 sm:w-72 sm:rounded-2xl sm:p-2.5 sm:max-h-[60vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 sm:animate-in sm:fade-in sm:zoom-in-95">
            {/* Main Menu View */}
            {activeMenu === "settings" && (<div className="space-y-4">
                <div className="flex items-center justify-between px-1 pb-2 border-b border-white/10">
                  <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Player settings</span>
                  <button onClick={() => {
                    setActiveMenu("none");
                    showControls(4500);
                }} className="p-1 rounded-full hover:bg-white/10 text-white/60 hover:text-white" aria-label="Close settings">
                    <X className="w-4 h-4"/>
                  </button>
                </div>
                <section className="px-1" aria-label="Playback speed">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Speed</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {PLAYBACK_RATES.map((rate) => (<button key={rate} onClick={() => handlePlaybackRateChange(rate)} aria-pressed={playbackRate === rate} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${playbackRate === rate ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                        {rate === 1 ? "1×" : `${rate}×`}
                      </button>))}
                  </div>
                </section>
                <section className="px-1" aria-label="Quality">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Quality</h4>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => handleQualityChange("original")} aria-pressed={currentQuality === "original"} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentQuality === "original" ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>Original</button>
                    {availableQualities.map((q) => (<button key={q.id} onClick={() => handleQualityChange(q.id)} aria-pressed={currentQuality === q.id} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentQuality === q.id ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                        {q.id}
                      </button>))}
                  </div>
                  <p className="text-[11px] text-white/45 mt-1.5">Original streams the file directly; lower qualities use less data.</p>
                </section>
                {audioTracks.length > 1 && (<section className="px-1" aria-label="Audio track">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Audio track</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {audioTracks.map((track) => (<button key={track.index} onClick={() => handleAudioTrackChange(track.index)} aria-pressed={currentAudioTrack === track.index} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentAudioTrack === track.index ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                          {track.title || `Track ${track.index + 1}`}
                        </button>))}
                    </div>
                  </section>)}
                <section className="px-1" aria-label="Subtitles">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Subtitles</h4>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setCurrentSubtitle("off")} aria-pressed={currentSubtitle === "off"} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentSubtitle === "off" ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>Off</button>
                    {subtitlesList.map((sub) => (<button key={sub.id} onClick={() => setCurrentSubtitle(sub.id)} aria-pressed={currentSubtitle === sub.id} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentSubtitle === sub.id ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                        {sub.label}
                      </button>))}
                    <button type="button" onClick={() => customSubtitleInputRef.current?.click()} className="h-8 px-2.5 rounded-md text-xs border border-dashed border-white/25 text-white/80 hover:bg-white/10 flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5"/>.srt / .vtt
                    </button>
                  </div>
                </section>
              </div>)}

            {/* Playback Speed Submenu */}
            {activeMenu === "speed" && (<div className="space-y-1">
                <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                  <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                    <ArrowLeft className="w-4 h-4"/>
                  </button>
                  <span>Playback Speed</span>
                </div>
                <div className="py-1 max-h-64 overflow-y-auto space-y-0.5">
                  {PLAYBACK_RATES.map((rate) => (<button key={rate} onClick={() => {
                        handlePlaybackRateChange(rate);
                        setActiveMenu("settings");
                    }} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${playbackRate === rate
                        ? "bg-primary/25 text-primary font-medium"
                        : "hover:bg-white/10 text-white/80"}`}>
                      <span>{rate === 1 ? "1x (Normal)" : `${rate}x`}</span>
                      {playbackRate === rate && <Check className="w-4 h-4 text-primary"/>}
                    </button>))}
                </div>
              </div>)}

            {/* Quality Submenu */}
            {activeMenu === "quality" && (<div className="space-y-1">
                <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                  <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                    <ArrowLeft className="w-4 h-4"/>
                  </button>
                  <span>Video Quality</span>
                </div>
                <div className="py-1 max-h-64 overflow-y-auto space-y-0.5">
                  {/* Auto (Original Source) */}
                  <button onClick={() => handleQualityChange("original")} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${currentQuality === "original"
                    ? "bg-primary/25 text-primary font-medium"
                    : "hover:bg-white/10 text-white/80"}`}>
                    <div className="flex flex-col text-left">
                      <span>Auto (Original Source)</span>
                      <span className="text-[10px] text-white/40">Direct stream • 0% CPU</span>
                    </div>
                    {currentQuality === "original" && <Check className="w-4 h-4 text-primary"/>}
                  </button>

                  {/* Filtered ladder where height <= native video height */}
                  {availableQualities.map((q) => (<button key={q.id} onClick={() => handleQualityChange(q.id)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${currentQuality === q.id
                        ? "bg-primary/25 text-primary font-medium"
                        : "hover:bg-white/10 text-white/80"}`}>
                      <div className="flex flex-col text-left">
                        <span>{q.label}</span>
                        <span className="text-[10px] text-white/40">Downscaled • Low data</span>
                      </div>
                      {currentQuality === q.id && <Check className="w-4 h-4 text-primary"/>}
                    </button>))}
                </div>
              </div>)}

            {/* Audio Tracks Submenu */}
            {activeMenu === "audio" && (<div className="space-y-1">
                <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                  <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                    <ArrowLeft className="w-4 h-4"/>
                  </button>
                  <span>Audio Tracks</span>
                </div>
                <div className="py-1 max-h-64 overflow-y-auto space-y-0.5">
                  {audioTracks.map((track) => (<button key={track.index} onClick={() => handleAudioTrackChange(track.index)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${currentAudioTrack === track.index
                        ? "bg-primary/25 text-primary font-medium"
                        : "hover:bg-white/10 text-white/80"}`}>
                      <div className="flex flex-col text-left">
                        <span>{track.title || `Track ${track.index + 1}`}</span>
                        <span className="text-[10px] text-white/40">{track.language} {track.codec ? `• ${track.codec.toUpperCase()}` : ''}</span>
                      </div>
                      {currentAudioTrack === track.index && <Check className="w-4 h-4 text-primary"/>}
                    </button>))}
                </div>
              </div>)}

            {/* Subtitles Submenu */}
            {activeMenu === "subtitles" && (<div className="space-y-2">
                <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                  <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                    <ArrowLeft className="w-4 h-4"/>
                  </button>
                  <span>Subtitles / CC</span>
                </div>
                <div className="py-1 max-h-64 overflow-y-auto space-y-0.5 px-1">
                  {/* Off Option */}
                  <button onClick={() => {
                    setCurrentSubtitle("off");
                    setActiveMenu("none");
                }} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors touch-manipulation ${currentSubtitle === "off"
                    ? "bg-primary/25 text-primary font-medium"
                    : "hover:bg-white/10 text-white/80"}`}>
                    <span>Off</span>
                    {currentSubtitle === "off" && <Check className="w-4 h-4 text-primary"/>}
                  </button>

                  {/* Available Subtitle Tracks */}
                  {subtitlesList.map((sub) => (<button key={sub.id} onClick={() => {
                        setCurrentSubtitle(sub.id);
                        setActiveMenu("none");
                    }} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors touch-manipulation ${currentSubtitle === sub.id
                        ? "bg-primary/25 text-primary font-medium"
                        : "hover:bg-white/10 text-white/80"}`}>
                      <span className="truncate pr-2">{sub.label}</span>
                      {currentSubtitle === sub.id && <Check className="w-4 h-4 text-primary shrink-0"/>}
                    </button>))}

                  {/* Custom Subtitle Upload Button */}
                  <div className="pt-2 border-t border-white/10 mt-2">
                    
                    <button type="button" onClick={() => customSubtitleInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition-colors">
                      <Upload className="w-3.5 h-3.5"/>
                      <span>Upload Subtitle (.srt / .vtt)</span>
                    </button>
                  </div>
                </div>
              </div>)}

          </div>
        </>)}

      {/* ================================================================= */}
      {/* File Details / Info Modal                                         */}
      {/* ================================================================= */}
      {activeMenu === "info" && (<div onClick={() => {
                setActiveMenu("none");
                showControls(4500);
            }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-5 text-white animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2">
                <Info className="w-5 h-5 text-primary"/>
                <h3 className="text-base font-semibold">Media Details</h3>
              </div>
              <button onClick={() => {
                setActiveMenu("none");
                showControls(4500);
            }} className="p-1 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors">
                <X className="w-4 h-4"/>
              </button>
            </div>

            <div className="py-4 space-y-3 text-sm">
              <div className="flex items-start justify-between">
                <span className="text-white/50 text-xs">File Name</span>
                <span className="text-right font-medium max-w-[240px] truncate text-white/95">
                  {fileName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50 text-xs">Format / Container</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-white/10 text-white/90">
                  {fileExt}
                </span>
              </div>
              {videoDimensions && (<div className="flex items-center justify-between">
                  <span className="text-white/50 text-xs">Resolution</span>
                  <span className="font-mono text-xs text-white/90">
                    {videoDimensions.width} × {videoDimensions.height}
                  </span>
                </div>)}
              <div className="flex items-center justify-between">
                <span className="text-white/50 text-xs">Total Duration</span>
                <span className="font-mono text-xs text-white/90">{formatTime(duration)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50 text-xs">Streaming Mode</span>
                <span className="text-xs text-success font-medium">
                  HTTP/1.1 Range Requests
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-white/10 flex justify-end">
              <button onClick={() => {
                setActiveMenu("none");
                showControls(4500);
            }} className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors">
                Done
              </button>
            </div>
          </div>
        </div>)}

      {/* External Player Menu Dialog (Opened via top bar button only) */}
      {activeMenu === "external" && (<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto" onClick={() => setActiveMenu("none")}>
          <div className="w-full max-w-sm bg-zinc-900 border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2">
                <ExternalLink className="w-5 h-5 text-primary"/>
                <h3 className="font-semibold text-white text-sm sm:text-base">Open in External Player</h3>
              </div>
              <button onClick={() => setActiveMenu("none")} className="p-1 rounded-full text-white/50 hover:text-white hover:bg-white/10">
                <X className="w-4 h-4"/>
              </button>
            </div>

            <p className="text-xs text-white/70 leading-relaxed">
              Play this video directly in an external app installed on your device:
            </p>

            <div className="space-y-2.5">
              {/* VLC Button */}
              <a href={`vlc://${fullMediaUrl}`} target="_blank" rel="noreferrer" className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl bg-card border border-border hover:bg-muted text-foreground font-medium text-xs sm:text-sm transition-colors shadow-sm cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Play className="w-4 h-4 text-warning shrink-0"/>
                  <span>VLC Media Player</span>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground"/>
              </a>

              {/* MX Player / External App Intent */}
              <a href={`intent:${fullMediaUrl}#Intent;type=video/*;end`} className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl bg-card border border-border hover:bg-muted text-foreground font-medium text-xs sm:text-sm transition-colors shadow-sm cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-4 h-4 text-primary shrink-0"/>
                  <span>MX Player / Mobile App</span>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground"/>
              </a>

              {/* Copy Stream Link */}
              <button type="button" onClick={() => {
                navigator.clipboard.writeText(fullMediaUrl);
                toast.success("Stream link copied to clipboard!");
                setActiveMenu("none");
            }} className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl bg-card border border-border hover:bg-muted text-foreground font-medium text-xs sm:text-sm transition-colors cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Copy className="w-4 h-4 text-muted-foreground shrink-0"/>
                  <span>Copy Stream URL</span>
                </div>
                <Check className="w-4 h-4 text-muted-foreground"/>
              </button>
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <button onClick={() => {
                setActiveMenu("none");
                showControls(4500);
            }} className="px-4 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-medium text-foreground transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>)}
    </div>);
};
