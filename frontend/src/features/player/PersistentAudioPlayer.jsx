import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Volume1, ListMusic, ListPlus, Disc, X, Download } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDockPresence } from "@/components/layout/dock/useDock";
import { Popover, PopoverContent, PopoverTrigger, } from "@/components/ui/popover";
import { downloadManager } from "@/features/transfers/downloadManager";
import { cn } from "@/lib/utils";
import { LikeButton } from "@/features/playlists/LikeButton";
import { requestAddToPlaylist } from "@/features/playlists/playlists";
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
export const PersistentAudioPlayer = ({ activeTrack, playlist, currentIndex, onTrackChange, onClose }) => {
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
    const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
    // The player's controls live in the app dock; hidden while a video is docked there
    const dock = useDockPresence("audio", true);
    const videoInDock = Boolean(dock?.presence?.video);
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
                            src: "/logo.png",
                            sizes: "1024x1024",
                            type: "image/png",
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
    // While a video plays, the audio pauses (one thing plays at a time)
    useEffect(() => {
        const pause = () => {
            audioRef.current?.pause();
            setIsPlaying(false);
        };
        window.addEventListener("telestore:pause-audio", pause);
        return () => window.removeEventListener("telestore:pause-audio", pause);
    }, []);
    const effectiveCurrentTime = isScrubbing ? scrubValue : currentTime;
    const progressPercent = duration > 0 ? (effectiveCurrentTime / duration) * 100 : 0;
    const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
    const volumeIcon = isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-destructive"/> : volume < 0.5 ? <Volume1 className="w-4 h-4"/> : <Volume2 className="w-4 h-4"/>;
    const iconBtn = "w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors";
    const toggleBtn = (on) => cn(iconBtn, on && "text-primary bg-primary/15 hover:bg-primary/25 hover:text-primary");

    const playButton = (size = "w-9 h-9") => (<button onClick={togglePlay} className={cn(size, "rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shrink-0")} aria-label={isPlaying ? "Pause audio" : "Play audio"}>
        {isLoading ? <span className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin"/> : isPlaying ? <Pause className="w-4 h-4 fill-current"/> : <Play className="w-4 h-4 fill-current ml-0.5"/>}
      </button>);
    const shuffleButton = (<button onClick={() => setIsShuffle((prev) => !prev)} className={toggleBtn(isShuffle)} aria-label={isShuffle ? "Disable shuffle" : "Enable shuffle"} aria-pressed={isShuffle} title={isShuffle ? "Shuffle on" : "Shuffle off"}>
        <Shuffle className="w-4 h-4"/>
      </button>);
    const repeatButton = (<button onClick={cycleRepeatMode} className={toggleBtn(repeatMode !== "off")} aria-label={repeatMode === "one" ? "Repeating this track" : repeatMode === "all" ? "Repeating all tracks" : "Enable repeat"} title={`Repeat: ${repeatMode}`}>
        {repeatMode === "one" ? <Repeat1 className="w-4 h-4"/> : <Repeat className="w-4 h-4"/>}
      </button>);
    const seekBar = (<div className="flex items-center gap-2 w-full text-[11px] font-mono text-muted-foreground">
        <span className="w-10 text-right">{formatTime(effectiveCurrentTime)}</span>
        <div className="relative flex-1 flex items-center py-1">
          <div className="absolute inset-x-0 h-1 rounded-full bg-secondary overflow-hidden pointer-events-none">
            <div className="h-full bg-muted-foreground/30" style={{ width: `${bufferedPercent}%` }}/>
          </div>
          <Slider value={[effectiveCurrentTime]} min={0} max={duration || 100} step={0.5} onValueChange={handleSeekChange} onValueCommit={handleSeekCommit} className="relative z-10 w-full" aria-label="Seek track"/>
        </div>
        <span className="w-10">{formatTime(duration)}</span>
      </div>);
    // Opening a queue shows the song that is playing (once, so scrolling by hand isn't undone)
    const showCurrentTrack = useCallback((list) => {
        if (list)
            requestAnimationFrame(() => list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" }));
    }, []);
    const queueList = (onPick) => (<div className="p-1.5">
        {playlist.map((track, idx) => {
            const isCur = idx === currentIndex;
            return (<button key={track.id || `${track.name}-${idx}`} onClick={() => { onTrackChange(idx); onPick?.(); }} className={cn("w-full flex items-center gap-2.5 p-2 rounded-md text-left text-xs transition-colors", isCur ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")} aria-current={isCur ? "true" : undefined}>
              <span className="w-5 text-center font-mono text-[11px]">{isCur ? "▶" : idx + 1}</span>
              <span className="truncate flex-1" title={track.name}>{track.name.replace(/\.[^/.]+$/, "")}</span>
              <span className="font-mono text-[10px]">{track.size ? formatFileSize(track.size) : ""}</span>
            </button>);
        })}
      </div>);
    const queueHeader = (<div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <ListMusic className="w-4 h-4 text-primary"/>
        <span className="text-xs font-semibold">Queue</span>
        <span className="text-[11px] text-muted-foreground font-mono ml-auto">{currentIndex + 1} of {playlist.length}</span>
      </div>);
    const download = () => downloadManager.addDownload(activeTrack.url, activeTrack.name);

    const dockRow = (<div className={cn("relative flex items-center gap-2.5 w-full min-w-0", videoInDock && "hidden")}>
        {/* Cover + title (on phones, opens Now playing) */}
        <button onClick={() => setIsNowPlayingOpen(true)} className="md:pointer-events-none flex items-center gap-2.5 min-w-0 flex-1 md:flex-none md:w-52 lg:w-64 text-left" aria-label="Open now playing">
          <span className="relative w-10 h-10 rounded-full bg-gradient-to-tr from-primary/40 to-cloud/60 p-[2px] shrink-0">
            <span className={cn("w-full h-full rounded-full bg-card border border-border flex items-center justify-center", isPlaying && "animate-[spin_6s_linear_infinite]")}>
              <Disc className="w-4 h-4 text-primary"/>
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium truncate" title={cleanTrackTitle}>{cleanTrackTitle}</span>
            <span className="block text-[11px] text-muted-foreground truncate"><span className="font-mono">{trackExtension}</span> · track {currentIndex + 1} of {playlist.length}{activeTrack.size ? ` · ${formatFileSize(activeTrack.size)}` : ""}</span>
          </span>
        </button>
        {/* Transport */}
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="hidden md:inline-flex">{shuffleButton}</span>
          <button onClick={handlePrev} className={cn(iconBtn, "hidden sm:flex")} aria-label="Previous track" title="Previous track"><SkipBack className="w-4 h-4 fill-current"/></button>
          {playButton()}
          <button onClick={handleNext} className={iconBtn} aria-label="Next track" title="Next track"><SkipForward className="w-4 h-4 fill-current"/></button>
          <span className="hidden md:inline-flex">{repeatButton}</span>
        </div>
        <div className="hidden md:flex flex-1 min-w-0">{seekBar}</div>
        {/* Extras */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={cyclePlaybackRate} className="hidden lg:flex h-8 px-2 items-center rounded-md text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Playback speed ${playbackRate}x`} title="Playback speed">{playbackRate}x</button>
          <div className="hidden lg:flex items-center gap-1.5 w-28">
            <button onClick={() => setIsMuted((prev) => !prev)} className={iconBtn} aria-label={isMuted ? "Unmute" : "Mute"} title={isMuted ? "Unmute" : "Mute"}>{volumeIcon}</button>
            <Slider value={[isMuted ? 0 : volume]} min={0} max={1} step={0.01} onValueChange={(val) => { setIsMuted(false); setVolume(val[0]); }} className="w-16" aria-label="Volume"/>
          </div>
          <Popover open={isPlaylistOpen} onOpenChange={setIsPlaylistOpen}>
            <PopoverTrigger asChild>
              <button className={cn(toggleBtn(isPlaylistOpen), "hidden md:flex w-auto px-2 gap-1")} aria-label="Queue" title="Queue">
                <ListMusic className="w-4 h-4"/><span className="font-mono text-[11px]">{playlist.length}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={10} className="w-80 p-0 overflow-hidden">
              {queueHeader}
              {/* A plain scrolling box: a Radix ScrollArea with only a max height never scrolls */}
              <div ref={showCurrentTrack} className="max-h-72 overflow-y-auto overscroll-contain" aria-label="Queue list">{queueList(() => setIsPlaylistOpen(false))}</div>
            </PopoverContent>
          </Popover>
          <LikeButton item={activeTrack.fileItem} className={iconBtn}/>
          <button onClick={() => requestAddToPlaylist([activeTrack.fileItem])} className={cn(iconBtn, "hidden md:flex")} aria-label="Add to playlist" title="Add to playlist"><ListPlus className="w-4 h-4"/></button>
          <button onClick={download} className={cn(iconBtn, "hidden md:flex")} aria-label="Download this track" title="Download this track"><Download className="w-4 h-4"/></button>
          <button onClick={onClose} className={cn(iconBtn, "hover:text-destructive hover:bg-destructive/10")} aria-label="Close audio player" title="Close"><X className="w-4 h-4"/></button>
        </div>
        {/* Phone: thin progress line along the bottom of the dock */}
        <span className="md:hidden absolute left-0 right-0 -bottom-[7px] h-0.5 rounded-full bg-secondary overflow-hidden pointer-events-none">
          <span className="block h-full bg-primary" style={{ width: `${progressPercent}%` }}/>
        </span>
      </div>);

    return (<>
      <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={handleEnded} onError={() => {
            setHasError(true);
            setIsLoading(false);
        }} onWaiting={() => setIsLoading(true)} onPlaying={() => setIsLoading(false)}/>
      {dock?.mediaSlot && createPortal(dockRow, dock.mediaSlot)}
      {/* Phone: full controls in a Now playing sheet */}
      <Sheet open={isNowPlayingOpen} onOpenChange={setIsNowPlayingOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] max-h-[88vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="truncate pr-6">{cleanTrackTitle}</SheetTitle>
            <SheetDescription className="text-xs"><span className="font-mono">{trackExtension}</span> · track {currentIndex + 1} of {playlist.length}{activeTrack.size ? ` · ${formatFileSize(activeTrack.size)}` : ""}</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{seekBar}</div>
          <div className="mt-3 flex items-center justify-center gap-3">
            {shuffleButton}
            <button onClick={handlePrev} className={iconBtn} aria-label="Previous track"><SkipBack className="w-5 h-5 fill-current"/></button>
            {playButton("w-12 h-12")}
            <button onClick={handleNext} className={iconBtn} aria-label="Next track"><SkipForward className="w-5 h-5 fill-current"/></button>
            {repeatButton}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <button onClick={cyclePlaybackRate} className="h-9 px-3 rounded-md border border-border text-xs font-mono" aria-label={`Playback speed ${playbackRate}x`}>{playbackRate}x</button>
            <div className="flex items-center gap-2 flex-1">
              <button onClick={() => setIsMuted((prev) => !prev)} className={iconBtn} aria-label={isMuted ? "Unmute" : "Mute"}>{volumeIcon}</button>
              <Slider value={[isMuted ? 0 : volume]} min={0} max={1} step={0.01} onValueChange={(val) => { setIsMuted(false); setVolume(val[0]); }} className="flex-1" aria-label="Volume"/>
            </div>
            <button onClick={download} className="h-9 px-3 rounded-md border border-border text-xs flex items-center gap-1.5" aria-label="Download this track"><Download className="w-4 h-4"/>Download</button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <LikeButton item={activeTrack.fileItem} className="h-9 px-3 rounded-md border border-border flex items-center" iconClassName="w-5 h-5"/>
            <button onClick={() => { setIsNowPlayingOpen(false); requestAddToPlaylist([activeTrack.fileItem]); }} className="h-9 px-3 rounded-md border border-border text-xs flex items-center gap-1.5" aria-label="Add to playlist"><ListPlus className="w-4 h-4"/>Add to playlist</button>
          </div>
          <div className="mt-4 rounded-lg border border-border overflow-hidden">
            {queueHeader}
            <div ref={showCurrentTrack} className="max-h-64 overflow-y-auto overscroll-contain" aria-label="Queue list">{queueList()}</div>
          </div>
        </SheetContent>
      </Sheet>
    </>);
};
