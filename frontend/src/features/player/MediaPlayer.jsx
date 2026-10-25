import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Play, Pause, SkipBack, SkipForward, ListVideo, RotateCcw, RotateCw, Minimize, Check, Download, X, ArrowLeft, Info, ExternalLink, Minimize2, Maximize2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDockPresence } from "@/components/layout/dock/useDock";
import { downloadManager } from "@/features/transfers/downloadManager";
import { toast } from "sonner";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
import { shouldAutoplayOnBufferReady } from "./videoPlaylistHelpers";
import { ALL_QUALITIES, formatTime, getFileExtension } from "./playerFormat";
import { usePlayerKeyboard } from "./hooks/usePlayerKeyboard";
import { PlayerControlsBar } from "./theater/PlayerControlsBar";
import { PlayerSettingsSheet } from "./theater/PlayerSettingsSheet";

// Holds the video for the instant between leaving the theater and the dock appearing: a video
// taken out of the page pauses, one moved within it keeps playing
let videoParking = null;
function parkVideoHost(host) {
    if (!videoParking) {
        videoParking = document.createElement("div");
        videoParking.setAttribute("aria-hidden", "true");
        videoParking.style.cssText = "position:fixed;left:-10000px;top:0;width:160px;height:90px;opacity:0;pointer-events:none";
        document.body.appendChild(videoParking);
    }
    videoParking.appendChild(host);
}
import { PlayerInfoDialogs } from "./theater/PlayerInfoDialogs";
export const MediaPlayer = ({
    mediaUrl,
    fileName,
    fileType,
    startPosition,
    onClose,
    onDownload,
    playlist = [],
    currentIndex = 0,
    onNext,
    onPrev,
    onSelectTrack,
    isMini: isMiniProp,
    onMiniChange,
}) => {
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
    const userPausedRef = useRef(false);
    // Autoplay happens once per stream; later "canplay" events (after buffering or a seek) must not restart a paused video
    const autoplayedRef = useRef(false);
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
    const [isMiniState, setIsMiniState] = useState(false);
    const isMini = onMiniChange !== undefined ? Boolean(isMiniProp) : isMiniState;
    const setIsMini = onMiniChange !== undefined ? onMiniChange : setIsMiniState;
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
            userPausedRef.current = false;
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
            userPausedRef.current = true;
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
            userPausedRef.current = false;
            el.play().catch(() => { });
        } else {
            userPausedRef.current = true;
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
    // Theater and dock share one <video> element, moved between them (see attachVideo), so the
    // switch keeps playing: no reload, no seek. Only whether it was playing is remembered.
    const switchPlayerMode = useCallback((mini) => {
        modeSwitchRef.current = { play: isPlaying };
        setIsMini(mini);
    }, [isPlaying, setIsMini]);
    const [videoHost] = useState(() => {
        const host = document.createElement("div");
        host.className = "w-full h-full";
        return host;
    });
    const attachVideo = useCallback((place) => {
        if (!place) {
            // Between places (the dock appears a moment later): keep it in the page so it plays on
            parkVideoHost(videoHost);
            return;
        }
        if (videoHost.parentNode !== place)
            place.appendChild(videoHost);
        const pending = modeSwitchRef.current;
        modeSwitchRef.current = null;
        const el = mediaElementRef.current;
        if (pending?.play && el?.paused)
            el.play().catch(() => { });
    }, [videoHost]);
    useEffect(() => () => videoHost.remove(), [videoHost]);
    const handleCanPlay = useCallback(() => {
        setIsBuffering(false);
        setHasPlaybackError(false);
        if (!autoplayedRef.current && shouldAutoplayOnBufferReady(userPausedRef.current, mediaElementRef.current?.paused ?? false, true)) {
            autoplayedRef.current = true;
            mediaElementRef.current?.play().then(() => {
                setIsPlaying(true);
            }).catch((err) => {
                console.warn("Autoplay play() error:", err);
            });
        }
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
    }, []);
    const handleVideoEnded = useCallback(() => {
        if (playlist && playlist.length > 1 && onNext && currentIndex < playlist.length - 1) {
            onNext();
        } else {
            setIsPlaying(false);
            setAreControlsVisible(true);
        }
    }, [playlist, onNext, currentIndex]);
    // Autoplay when stream URL changes and media element buffer is ready
    useEffect(() => {
        userPausedRef.current = false;
        autoplayedRef.current = false;
        const el = mediaElementRef.current;
        if (el && shouldAutoplayOnBufferReady(userPausedRef.current, el.paused, el.readyState)) {
            autoplayedRef.current = true;
            el.play().then(() => setIsPlaying(true)).catch(() => { });
        }
    }, [activeStreamUrl]);
    // Starting audio pauses the video (one thing plays at a time)
    useEffect(() => {
        const pause = () => {
            // Counts as the user pausing, so buffering can't start the video again under the audio
            userPausedRef.current = true;
            mediaElementRef.current?.pause();
        };
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
    usePlayerKeyboard({ activeMenu, handlePlaybackRateChange, handleVolumeChange, isFullscreen, isMini, onClose, onNext, onPrev, playbackRate, seekRelative, setActiveMenu, toggleFullscreen, toggleMute, togglePlay, volume });
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
    // Rendered into videoHost, which attachVideo moves between the theater and the dock
    const videoElement = createPortal((
    <video ref={mediaElementRef} src={activeStreamUrl} autoPlay preload="auto" playsInline crossOrigin="anonymous" className={`w-full h-full pointer-events-none ${isMini ? "object-cover" : "object-contain"}`} onTimeUpdate={handleTimeUpdate} onProgress={handleProgress} onLoadedMetadata={handleLoadedMetadata} onPlay={() => {
          setIsPlaying(true);
          if (!isMini)
              showControls(4500);
      }} onPause={() => {
          setIsPlaying(false);
          if (!isMini)
              setAreControlsVisible(true);
      }} onEnded={handleVideoEnded} onWaiting={() => setIsBuffering(true)} onPlaying={() => {
          setIsBuffering(false);
          setHasPlaybackError(false);
      }} onCanPlay={handleCanPlay} onError={() => {
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
    ), videoHost);
    // Docked (minimized) video: compact controls rendered into the app dock
    if (isMini) {
        const docked = (<div className="flex items-center gap-2.5 w-full min-w-0">
          <button onClick={() => switchPlayerMode(false)} className="group relative w-[84px] h-[47px] rounded-md overflow-hidden bg-black shrink-0 border border-border" title="Open in theater mode" aria-label="Open video in theater mode">
            <span ref={attachVideo} className="block w-full h-full pointer-events-none"/>
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
              <Maximize2 className="w-4 h-4 text-white"/>
            </span>
          </button>
          <div className="min-w-0 flex-1 md:flex-none md:w-44 lg:w-60">
            <div className="text-[13px] font-medium truncate" title={fileName}>{fileName}</div>
            <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1.5">
              {playlist && playlist.length > 1 && (
                <span className="text-[10px] px-1 py-0.2 rounded bg-muted text-muted-foreground font-semibold">
                  {currentIndex + 1}/{playlist.length}
                </span>
              )}
              <span>{isBuffering ? "Buffering…" : `${formatTime(currentTime)} / ${formatTime(duration)}`}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {playlist && playlist.length > 1 && (
              <button onClick={onPrev} disabled={!onPrev || currentIndex <= 0} className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none" title="Previous video" aria-label="Previous video">
                <SkipBack className="w-4 h-4 fill-current"/>
              </button>
            )}
            <button onClick={() => seekTo(currentTime - 10)} className="hidden sm:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="Back 10 seconds" aria-label="Back 10 seconds">
              <RotateCcw className="w-4 h-4"/>
            </button>
            <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 active:scale-95 transition-transform" aria-label={isPlaying ? "Pause video" : "Play video"}>
              {isPlaying ? <Pause className="w-4 h-4 fill-current"/> : <Play className="w-4 h-4 fill-current ml-0.5"/>}
            </button>
            <button onClick={() => seekTo(currentTime + 10)} className="hidden sm:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="Forward 10 seconds" aria-label="Forward 10 seconds">
              <RotateCw className="w-4 h-4"/>
            </button>
            {playlist && playlist.length > 1 && (
              <button onClick={onNext} disabled={!onNext || currentIndex >= playlist.length - 1} className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none" title="Next video" aria-label="Next video">
                <SkipForward className="w-4 h-4 fill-current"/>
              </button>
            )}
          </div>
          <input type="range" min={0} max={duration || 0} step={1} value={Math.min(currentTime, duration || 0)} onChange={(e) => seekTo(Number(e.target.value))} className="hidden md:block flex-1 min-w-0 h-1 accent-primary cursor-pointer" aria-label="Seek video"/>
          <button onClick={() => switchPlayerMode(false)} className="hidden md:flex w-8 h-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0" title="Theater mode" aria-label="Open video in theater mode">
            <Maximize2 className="w-4 h-4"/>
          </button>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0" title="Close video" aria-label="Close video">
            <X className="w-4 h-4"/>
          </button>
        </div>);
        // Same shape as the theater return (video first), so React keeps the one <video>
        return (<>
          {videoElement}
          {dock?.mediaSlot ? createPortal(docked, dock.mediaSlot) : null}
        </>);
    }
    // =========================================================================
    // Google Drive Style Video Player
    // =========================================================================
    return (<>
      {videoElement}
      <div ref={containerRef} onMouseMove={() => showControls(4000)} className={`fixed inset-0 z-50 bg-[#0a0a0a] text-white flex flex-col select-none overflow-hidden ${!areControlsVisible && isPlaying ? "cursor-none" : "cursor-default"}`}>
      {/* The one video element (theater and dock share it) */}
      <div ref={attachVideo} className="w-full h-full"/>

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

        {/* Right: Actions (Playlist, External Player, Download, Info, Close) */}
        <div className="flex items-center space-x-0.5 sm:space-x-1 flex-shrink-0">
          {playlist && playlist.length > 0 && (
            <button onClick={() => {
              setActiveMenu((prev) => (prev === "playlist" ? "none" : "playlist"));
              showControls(5000);
            }} className={`p-2 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center gap-1.5 ${activeMenu === "playlist" ? "bg-primary text-primary-foreground" : ""}`} title="Playlist" aria-label="Playlist">
              <ListVideo className="w-5 h-5"/>
              {playlist.length > 1 && (
                <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-white/20">
                  {currentIndex + 1}/{playlist.length}
                </span>
              )}
            </button>
          )}
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

      <PlayerControlsBar activeMenu={activeMenu} currentTime={currentTime} areControlsVisible={areControlsVisible} bufferedPercent={bufferedPercent} canPiP={canPiP} currentIndex={currentIndex} duration={duration} handleTimelinePointerDown={handleTimelinePointerDown} handleTimelinePointerLeave={handleTimelinePointerLeave} handleTimelinePointerMove={handleTimelinePointerMove} handleTimelinePointerUp={handleTimelinePointerUp} handleVolumeChange={handleVolumeChange} hoverPosPercent={hoverPosPercent} hoverTime={hoverTime} isFullscreen={isFullscreen} isMobile={isMobile} isMuted={isMuted} isPiPActive={isPiPActive} isPlaying={isPlaying} isScrubbing={isScrubbing} onNext={onNext} onPrev={onPrev} playedPercent={playedPercent} playlist={playlist} seekRelative={seekRelative} setActiveMenu={setActiveMenu} showControls={showControls} timelineRef={timelineRef} toggleFullscreen={toggleFullscreen} toggleMute={toggleMute} togglePiP={togglePiP} togglePlay={togglePlay} volume={volume}/>

      <PlayerSettingsSheet activeMenu={activeMenu} audioTracks={audioTracks} availableQualities={availableQualities} currentAudioTrack={currentAudioTrack} currentIndex={currentIndex} currentQuality={currentQuality} currentSubtitle={currentSubtitle} customSubtitleInputRef={customSubtitleInputRef} handleAudioTrackChange={handleAudioTrackChange} handleCustomSubtitleUpload={handleCustomSubtitleUpload} handlePlaybackRateChange={handlePlaybackRateChange} handleQualityChange={handleQualityChange} onSelectTrack={onSelectTrack} playbackRate={playbackRate} playlist={playlist} setActiveMenu={setActiveMenu} setCurrentSubtitle={setCurrentSubtitle} showControls={showControls} subtitlesList={subtitlesList}/>

      <PlayerInfoDialogs activeMenu={activeMenu} duration={duration} fileExt={fileExt} fileName={fileName} fullMediaUrl={fullMediaUrl} setActiveMenu={setActiveMenu} showControls={showControls} videoDimensions={videoDimensions}/>
    </div>
    </>);
};
