import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Volume1, ListMusic, Disc, X, Download, Minimize2, Maximize2, Music, } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger, } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { downloadManager } from "@/features/transfers/downloadManager";
import { cn } from "@/lib/utils";
function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || !isFinite(seconds))
        return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}
function formatFileSize(bytes) {
    if (!bytes || bytes <= 0)
        return "";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
export const PersistentAudioPlayer = ({ activeTrack, playlist, currentIndex, onTrackChange, onClose, isMinimized: propMinimized, onToggleMinimize, }) => {
    const audioRef = useRef(null);
    // Playback state
    const [isPlaying, setIsPlaying] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    // Settings
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem("persistent_audio_volume");
        return saved !== null ? parseFloat(saved) : 0.8;
    });
    const [isMuted, setIsMuted] = useState(false);
    const [isShuffle, setIsShuffle] = useState(false);
    const [repeatMode, setRepeatMode] = useState("off");
    const [playbackRate, setPlaybackRate] = useState(1.0);
    // UI state - controlled via MediaPlayerContext or fallback to local state
    const [internalMinimized, setInternalMinimized] = useState(false);
    const isMinimized = propMinimized !== undefined ? propMinimized : internalMinimized;
    const setIsMinimized = (val) => {
        const next = typeof val === "function" ? val(isMinimized) : val;
        if (onToggleMinimize) {
            onToggleMinimize(next);
        } else {
            setInternalMinimized(next);
        }
    };
    const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [scrubValue, setScrubValue] = useState(0);
    // Clean track name without extension
    const cleanTrackTitle = useMemo(() => {
        return activeTrack.name.replace(/\.[^/.]+$/, "");
    }, [activeTrack.name]);
    // File extension badge
    const trackExtension = useMemo(() => {
        const parts = activeTrack.name.split(".");
        return parts.length > 1 ? parts.pop()?.toUpperCase() : "AUDIO";
    }, [activeTrack.name]);
    // Sync volume with audio element
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = isMuted ? 0 : volume;
        }
        localStorage.setItem("persistent_audio_volume", volume.toString());
    }, [volume, isMuted]);
    // Sync playback rate with audio element
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);
    // Play audio when track changes
    useEffect(() => {
        setCurrentTime(0);
        setBuffered(0);
        setIsLoading(true);
        setHasError(false);
        if (audioRef.current) {
            audioRef.current.src = activeTrack.url;
            audioRef.current.load();
            audioRef.current
                .play()
                .then(() => setIsPlaying(true))
                .catch((err) => {
                console.warn("Auto-play blocked or waiting for user gesture:", err);
                setIsPlaying(false);
                setIsLoading(false);
            });
        }
    }, [activeTrack.url]);
    // Next track logic
    const handleNext = useCallback(() => {
        if (playlist.length <= 1) {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play();
            }
            return;
        }
        if (isShuffle) {
            let nextIdx = Math.floor(Math.random() * playlist.length);
            if (nextIdx === currentIndex && playlist.length > 1) {
                nextIdx = (nextIdx + 1) % playlist.length;
            }
            onTrackChange(nextIdx);
        }
        else {
            const nextIdx = (currentIndex + 1) % playlist.length;
            onTrackChange(nextIdx);
        }
    }, [playlist.length, isShuffle, currentIndex, onTrackChange]);
    // Previous track logic
    const handlePrev = useCallback(() => {
        if (audioRef.current && audioRef.current.currentTime > 3) {
            audioRef.current.currentTime = 0;
            setCurrentTime(0);
            return;
        }
        if (playlist.length <= 1) {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
            }
            return;
        }
        const prevIdx = (currentIndex - 1 + playlist.length) % playlist.length;
        onTrackChange(prevIdx);
    }, [playlist.length, currentIndex, onTrackChange]);
    // Toggle play/pause
    const togglePlay = useCallback(() => {
        if (!audioRef.current)
            return;
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        }
        else {
            audioRef.current
                .play()
                .then(() => setIsPlaying(true))
                .catch((e) => console.error("Error playing audio:", e));
        }
    }, [isPlaying]);
    // Cycle repeat mode
    const cycleRepeatMode = useCallback(() => {
        setRepeatMode((prev) => {
            if (prev === "off")
                return "all";
            if (prev === "all")
                return "one";
            return "off";
        });
    }, []);
    // Cycle speed
    const cyclePlaybackRate = useCallback(() => {
        const rates = [1.0, 1.25, 1.5, 2.0];
        const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
        setPlaybackRate(nextRate);
    }, [playbackRate]);
    // Seek bar
    const handleSeekChange = (vals) => {
        setIsScrubbing(true);
        setScrubValue(vals[0]);
    };
    const handleSeekCommit = (vals) => {
        setIsScrubbing(false);
        const target = vals[0];
        setCurrentTime(target);
        if (audioRef.current) {
            audioRef.current.currentTime = target;
        }
    };
    // Audio element events
    const handleTimeUpdate = () => {
        if (!audioRef.current || isScrubbing)
            return;
        setCurrentTime(audioRef.current.currentTime);
        // Update buffered ranges
        if (audioRef.current.buffered.length > 0) {
            setBuffered(audioRef.current.buffered.end(audioRef.current.buffered.length - 1));
        }
    };
    const handleLoadedMetadata = () => {
        if (!audioRef.current)
            return;
        setDuration(audioRef.current.duration || 0);
        setIsLoading(false);
    };
    const handleEnded = () => {
        if (repeatMode === "one") {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play();
            }
        }
        else if (repeatMode === "all" || currentIndex < playlist.length - 1 || isShuffle) {
            handleNext();
        }
        else {
            setIsPlaying(false);
        }
    };
    // Media Session API integration
    useEffect(() => {
        if ("mediaSession" in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: cleanTrackTitle,
                    artist: "TeleStore Audio",
                    album: activeTrack.fileItem?.file_path?.replace(/^\//, "") || "Music Playlist",
                    artwork: [
                        {
                            src: "/logo.jpg",
                            sizes: "192x192",
                            type: "image/jpeg",
                        },
                    ],
                });
                navigator.mediaSession.setActionHandler("play", () => {
                    if (audioRef.current) {
                        audioRef.current.play();
                        setIsPlaying(true);
                    }
                });
                navigator.mediaSession.setActionHandler("pause", () => {
                    if (audioRef.current) {
                        audioRef.current.pause();
                        setIsPlaying(false);
                    }
                });
                navigator.mediaSession.setActionHandler("previoustrack", handlePrev);
                navigator.mediaSession.setActionHandler("nexttrack", handleNext);
                navigator.mediaSession.setActionHandler("seekto", (details) => {
                    if (details.seekTime !== undefined && audioRef.current) {
                        audioRef.current.currentTime = details.seekTime;
                        setCurrentTime(details.seekTime);
                    }
                });
            }
            catch (err) {
                console.warn("MediaSession assignment error:", err);
            }
        }
    }, [cleanTrackTitle, activeTrack, handleNext, handlePrev]);
    // Global Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Don't trigger if user is typing in input or textarea
            const target = e.target;
            if (target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)) {
                return;
            }
            if (e.code === "Space") {
                e.preventDefault();
                togglePlay();
            }
            else if (e.shiftKey && e.code === "ArrowRight") {
                e.preventDefault();
                handleNext();
            }
            else if (e.shiftKey && e.code === "ArrowLeft") {
                e.preventDefault();
                handlePrev();
            }
            else if (e.code === "KeyM") {
                setIsMuted((prev) => !prev);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [togglePlay, handleNext, handlePrev]);
    const effectiveCurrentTime = isScrubbing ? scrubValue : currentTime;
    const progressPercent = duration > 0 ? (effectiveCurrentTime / duration) * 100 : 0;
    const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
    // -------------------------------------------------------------
    // Compact / Minimized View (Centered Floating Dock Pill)
    // -------------------------------------------------------------
    if (isMinimized) {
        return (<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-card/95 backdrop-blur-xl border border-border shadow-2xl rounded-full px-3.5 py-2 transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 text-card-foreground select-none max-w-[calc(100vw-2rem)]">
        <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={handleEnded} onError={() => {
                setHasError(true);
                setIsLoading(false);
            }} onWaiting={() => setIsLoading(true)} onPlaying={() => setIsLoading(false)}/>

        {/* Animated Disc */}
        <div onClick={() => setIsMinimized(false)} className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-primary/30 to-primary/80 p-[2px] cursor-pointer hover:scale-105 transition-transform" title="Click to expand player">
          <div className={cn("w-full h-full rounded-full bg-card border border-border flex items-center justify-center text-primary", isPlaying && "animate-[spin_4s_linear_infinite]")}>
            <Disc className="w-4 h-4"/>
          </div>
        </div>

        {/* Info */}
        <div onClick={() => setIsMinimized(false)} className="flex flex-col cursor-pointer max-w-[140px] md:max-w-[200px]" title={cleanTrackTitle}>
          <span className="text-xs font-semibold text-foreground truncate">
            {cleanTrackTitle}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTime(effectiveCurrentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full" onClick={togglePlay} aria-label={isPlaying ? "Pause audio" : "Play audio"} title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current"/> : <Play className="w-3.5 h-3.5 fill-current ml-0.5"/>}
          </Button>

          <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full" onClick={handleNext} aria-label="Next track" title="Next Track">
            <SkipForward className="w-3.5 h-3.5"/>
          </Button>

          <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-primary hover:bg-muted rounded-full" onClick={() => setIsMinimized(false)} aria-label="Expand audio player" title="Expand Full Bar">
            <Maximize2 className="w-3.5 h-3.5"/>
          </Button>

          <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full" onClick={onClose} aria-label="Close audio player" title="Close Audio Player">
            <X className="w-3.5 h-3.5"/>
          </Button>
        </div>
      </div>);
    }
    // -------------------------------------------------------------
    // Full Media Dock - Centered Floating Bottom Player Bar
    // -------------------------------------------------------------
    return (<div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-1.5rem)] sm:w-[calc(100vw-2rem)] md:w-[calc(100vw-4rem)] lg:max-w-4xl xl:max-w-5xl select-none animate-in fade-in slide-in-from-bottom-4 duration-300 pointer-events-none">
      <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={handleEnded} onError={() => {
            setHasError(true);
            setIsLoading(false);
        }} onWaiting={() => setIsLoading(true)} onPlaying={() => setIsLoading(false)}/>

      <div className="relative pointer-events-auto bg-card/95 backdrop-blur-2xl border border-border shadow-[0_12px_45px_rgba(0,0,0,0.5)] rounded-2xl p-2.5 md:p-3 text-card-foreground flex flex-col md:flex-row items-center justify-between gap-3 overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-transparent before:via-primary before:to-transparent">
        
        {/* ============================================================ */}
        {/* LEFT SECTION: Track Info & Vinyl Art */}
        {/* ============================================================ */}
        <div className="flex items-center gap-3 w-full md:w-[28%] min-w-0 justify-between md:justify-start">
          <div className="flex items-center gap-3 min-w-0">
            {/* Vinyl Record */}
            <div className="relative flex-shrink-0 w-11 h-11 md:w-12 md:h-12 rounded-full bg-gradient-to-tr from-primary/30 via-primary/50 to-primary/80 p-[2px] shadow-md shadow-black/20">
              <div className={cn("w-full h-full rounded-full bg-card border border-border flex items-center justify-center text-primary relative overflow-hidden", isPlaying && "animate-[spin_6s_linear_infinite]")} style={{
            animationPlayState: isPlaying ? "running" : "paused",
        }}>
                {/* Vinyl Grooves */}
                <div className="absolute inset-1 rounded-full border border-border/60"/>
                <div className="absolute inset-2.5 rounded-full border border-border/80"/>
                <Disc className="w-5 h-5 text-primary relative z-10"/>
                <div className="absolute w-2 h-2 rounded-full bg-primary/80 shadow-[0_0_8px_rgba(99,102,241,0.8)]"/>
              </div>
            </div>

            {/* Title & Metadata */}
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm md:text-base text-foreground truncate hover:text-primary transition-colors" title={cleanTrackTitle}>
                  {cleanTrackTitle}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-mono tracking-wider border-primary/40 text-primary bg-primary/10">
                  {trackExtension}
                </Badge>
                <span className="text-[11px] text-muted-foreground truncate">
                  Track {currentIndex + 1} of {playlist.length}
                </span>
                {activeTrack.size && (<span className="text-[10px] text-muted-foreground/75 hidden sm:inline">
                    • {formatFileSize(activeTrack.size)}
                  </span>)}
              </div>
            </div>
          </div>

          {/* Mobile Right Controls: Close & Minimize */}
          <div className="flex md:hidden items-center gap-1">
            <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-foreground" onClick={() => setIsMinimized(true)} aria-label="Minimize audio player" title="Minimize">
              <Minimize2 className="w-3.5 h-3.5"/>
            </Button>
            <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={onClose} aria-label="Close audio player" title="Close">
              <X className="w-3.5 h-3.5"/>
            </Button>
          </div>
        </div>

        {/* ============================================================ */}
        {/* CENTER SECTION: Controls & Progress Scrubber */}
        {/* ============================================================ */}
        <div className="flex flex-col items-center w-full md:w-[44%] max-w-xl gap-1">
          {/* Main Playback Buttons */}
          <div className="flex items-center gap-3 md:gap-5">
            {/* Shuffle */}
            <Button size="icon" variant="ghost" className={cn("w-8 h-8 rounded-full transition-colors", isShuffle
            ? "text-primary bg-primary/15 hover:bg-primary/25"
            : "text-muted-foreground hover:text-foreground hover:bg-muted")} onClick={() => setIsShuffle((prev) => !prev)} aria-label={isShuffle ? "Disable shuffle" : "Enable shuffle"} title={isShuffle ? "Shuffle On" : "Shuffle Off"}>
              <Shuffle className="w-4 h-4"/>
            </Button>

            {/* Prev */}
            <Button size="icon" variant="ghost" className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full" onClick={handlePrev} aria-label="Previous track" title="Previous Track">
              <SkipBack className="w-4 h-4 fill-current"/>
            </Button>

            {/* Play/Pause Main Button */}
            <Button size="icon" className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 hover:scale-105 active:scale-95 transition-all flex items-center justify-center relative" onClick={togglePlay} aria-label={isPlaying ? "Pause audio" : "Play audio"} title={isPlaying ? "Pause (Space)" : "Play (Space)"}>
              {isLoading ? (<div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"/>) : isPlaying ? (<Pause className="w-5 h-5 fill-current"/>) : (<Play className="w-5 h-5 fill-current ml-0.5"/>)}
            </Button>

            {/* Next */}
            <Button size="icon" variant="ghost" className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full" onClick={handleNext} aria-label="Next track" title="Next Track">
              <SkipForward className="w-4 h-4 fill-current"/>
            </Button>

            {/* Repeat */}
            <Button size="icon" variant="ghost" className={cn("w-8 h-8 rounded-full relative transition-colors", repeatMode !== "off"
            ? "text-primary bg-primary/15 hover:bg-primary/25"
            : "text-muted-foreground hover:text-foreground hover:bg-muted")} onClick={cycleRepeatMode} aria-label={repeatMode === "one" ? "Repeat current track" : repeatMode === "all" ? "Repeat all tracks" : "Enable repeat"} title={`Repeat: ${repeatMode.toUpperCase()}`}>
              {repeatMode === "one" ? (<Repeat1 className="w-4 h-4"/>) : (<Repeat className="w-4 h-4"/>)}
              {repeatMode !== "off" && (<span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary"/>)}
            </Button>
          </div>

          {/* Scrubber & Time Display */}
          <div className="flex items-center gap-2.5 w-full text-xs font-mono text-muted-foreground px-1">
            <span className="w-10 text-right select-none text-[11px]">
              {formatTime(effectiveCurrentTime)}
            </span>

            {/* Seek Bar with buffer underlay */}
            <div className="relative flex-1 flex items-center group cursor-pointer py-1">
              {/* Buffered progress track */}
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-secondary overflow-hidden pointer-events-none">
                <div className="h-full bg-muted-foreground/30 transition-all duration-200" style={{ width: `${bufferedPercent}%` }}/>
              </div>

              {/* Interactive Radix Slider */}
              <Slider value={[effectiveCurrentTime]} min={0} max={duration || 100} step={0.5} onValueChange={handleSeekChange} onValueCommit={handleSeekCommit} className="relative z-10 w-full"/>
            </div>

            <span className="w-10 select-none text-[11px]">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* ============================================================ */}
        {/* RIGHT SECTION: Volume, Speed, Playlist Popover, Actions */}
        {/* ============================================================ */}
        <div className="hidden md:flex items-center justify-end gap-2.5 w-[28%] min-w-0">
          {/* Speed Selector */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs font-mono text-muted-foreground hover:text-primary hover:bg-muted rounded-md" onClick={cyclePlaybackRate} aria-label={`Playback speed, current ${playbackRate}x`} title="Playback Speed">
            {playbackRate}x
          </Button>

          {/* Volume Control */}
          <div className="flex items-center gap-2 group w-28">
            <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-foreground rounded-full p-0 flex-shrink-0" onClick={() => setIsMuted((prev) => !prev)} aria-label={isMuted ? "Unmute audio" : "Mute audio"} title={isMuted ? "Unmute (M)" : "Mute (M)"}>
              {isMuted || volume === 0 ? (<VolumeX className="w-4 h-4 text-destructive"/>) : volume < 0.5 ? (<Volume1 className="w-4 h-4"/>) : (<Volume2 className="w-4 h-4"/>)}
            </Button>
            <Slider value={[isMuted ? 0 : volume]} min={0} max={1} step={0.01} onValueChange={(val) => {
            setIsMuted(false);
            setVolume(val[0]);
        }} className="w-16"/>
          </div>

          {/* Playlist Drawer Popover */}
          <Popover open={isPlaylistOpen} onOpenChange={setIsPlaylistOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className={cn("h-8 px-2.5 gap-1.5 text-xs rounded-lg transition-colors", isPlaylistOpen
            ? "text-primary bg-primary/15 border border-primary/30"
            : "text-muted-foreground hover:text-foreground hover:bg-muted")} aria-label={isPlaylistOpen ? "Close playlist drawer" : "Open playlist drawer"} title="Playlist Queue">
                <ListMusic className="w-4 h-4"/>
                <span className="font-mono text-[11px] font-semibold">
                  {playlist.length}
                </span>
              </Button>
            </PopoverTrigger>

            <PopoverContent side="top" align="end" className="w-80 md:w-96 p-0 bg-popover/95 backdrop-blur-2xl border border-border shadow-2xl rounded-xl text-popover-foreground overflow-hidden mb-2">
              {/* Popover Header */}
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-muted/40">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-primary"/>
                  <span className="font-semibold text-xs text-foreground">
                    Playlist Queue
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-secondary">
                    {playlist.length} tracks
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  Playing #{currentIndex + 1}
                </div>
              </div>

              {/* Track list */}
              <ScrollArea className="max-h-72 overflow-y-auto p-1.5 divide-y divide-border/40">
                {playlist.map((track, idx) => {
            const isCur = idx === currentIndex;
            const trackClean = track.name.replace(/\.[^/.]+$/, "");
            return (<div key={track.id || `${track.name}-${idx}`} onClick={() => {
                    onTrackChange(idx);
                    setIsPlaylistOpen(false);
                }} className={cn("flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all text-xs group", isCur
                    ? "bg-primary/15 border border-primary/30 text-primary font-medium"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground")}>
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        {isCur ? (<div className="flex items-end gap-[2px] w-4 h-4 justify-center">
                            <span className="w-1 bg-primary rounded-sm animate-[bounce_0.8s_infinite] h-3"/>
                            <span className="w-1 bg-primary rounded-sm animate-[bounce_1.1s_infinite] h-4"/>
                            <span className="w-1 bg-primary rounded-sm animate-[bounce_0.9s_infinite] h-2"/>
                          </div>) : (<span className="font-mono text-muted-foreground w-4 text-center text-[11px] group-hover:text-foreground">
                            {idx + 1}
                          </span>)}

                        <span className="truncate" title={track.name}>
                          {trackClean}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-muted-foreground font-mono">
                        {track.size ? formatFileSize(track.size) : ""}
                      </div>
                    </div>);
        })}
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* Download Track */}
          <Button size="icon" variant="ghost" className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg" onClick={() => {
            downloadManager.addDownload(activeTrack.url, activeTrack.name);
        }} aria-label="Download current track" title="Download this Track">
            <Download className="w-4 h-4"/>
          </Button>

          {/* Minimize into Pill */}
          <Button size="icon" variant="ghost" className="w-8 h-8 text-muted-foreground hover:text-primary hover:bg-muted rounded-lg" onClick={() => setIsMinimized(true)} aria-label="Minimize audio player" title="Minimize to Floating Pill">
            <Minimize2 className="w-4 h-4"/>
          </Button>

          {/* Close Player */}
          <Button size="icon" variant="ghost" className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg" onClick={onClose} aria-label="Close audio player" title="Close Audio Player">
            <X className="w-4 h-4"/>
          </Button>
        </div>
      </div>
    </div>);
};
