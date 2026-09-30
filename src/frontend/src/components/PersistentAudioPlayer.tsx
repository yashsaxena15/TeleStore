import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Volume1,
  ListMusic,
  Disc,
  X,
  Download,
  Minimize2,
  Maximize2,
  Music,
  Check,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { downloadManager } from "@/lib/downloadManager";
import { cn } from "@/lib/utils";
import { AudioTrack } from "@/contexts/MediaPlayerContext";

interface PersistentAudioPlayerProps {
  activeTrack: AudioTrack;
  playlist: AudioTrack[];
  currentIndex: number;
  onTrackChange: (index: number) => void;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const PersistentAudioPlayer: React.FC<PersistentAudioPlayerProps> = ({
  activeTrack,
  playlist,
  currentIndex,
  onTrackChange,
  onClose,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [buffered, setBuffered] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  // Settings
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem("persistent_audio_volume");
    return saved !== null ? parseFloat(saved) : 0.8;
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  // UI state
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isPlaylistOpen, setIsPlaylistOpen] = useState<boolean>(false);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubValue, setScrubValue] = useState<number>(0);

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
    } else {
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
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((e) => console.error("Error playing audio:", e));
    }
  }, [isPlaying]);

  // Cycle repeat mode
  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === "off") return "all";
      if (prev === "all") return "one";
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
  const handleSeekChange = (vals: number[]) => {
    setIsScrubbing(true);
    setScrubValue(vals[0]);
  };

  const handleSeekCommit = (vals: number[]) => {
    setIsScrubbing(false);
    const target = vals[0];
    setCurrentTime(target);
    if (audioRef.current) {
      audioRef.current.currentTime = target;
    }
  };

  // Audio element events
  const handleTimeUpdate = () => {
    if (!audioRef.current || isScrubbing) return;
    setCurrentTime(audioRef.current.currentTime);

    // Update buffered ranges
    if (audioRef.current.buffered.length > 0) {
      setBuffered(
        audioRef.current.buffered.end(audioRef.current.buffered.length - 1)
      );
    }
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration || 0);
    setIsLoading(false);
  };

  const handleEnded = () => {
    if (repeatMode === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
    } else if (repeatMode === "all" || currentIndex < playlist.length - 1 || isShuffle) {
      handleNext();
    } else {
      setIsPlaying(false);
    }
  };

  // Media Session API integration
  useEffect(() => {
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: cleanTrackTitle,
          artist: "Telegram Drive Audio",
          album: activeTrack.fileItem?.file_path?.replace(/^\//, "") || "Music Playlist",
          artwork: [
            {
              src: "/icon-192.png",
              sizes: "192x192",
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
      } catch (err) {
        console.warn("MediaSession assignment error:", err);
      }
    }
  }, [cleanTrackTitle, activeTrack, handleNext, handlePrev]);

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in input or textarea
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.shiftKey && e.code === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.shiftKey && e.code === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.code === "KeyM") {
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
  // Compact / Minimized View
  // -------------------------------------------------------------
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-xl border border-cyan-500/40 shadow-2xl rounded-full px-3.5 py-2 transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 text-slate-100">
        <audio
          ref={audioRef}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onError={() => {
            setHasError(true);
            setIsLoading(false);
          }}
          onWaiting={() => setIsLoading(true)}
          onPlaying={() => setIsLoading(false)}
        />

        {/* Animated Disc */}
        <div
          onClick={() => setIsMinimized(false)}
          className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-600 to-indigo-600 p-[2px] cursor-pointer hover:scale-105 transition-transform"
          title="Click to expand player"
        >
          <div
            className={cn(
              "w-full h-full rounded-full bg-slate-950 flex items-center justify-center text-cyan-400",
              isPlaying && "animate-[spin_4s_linear_infinite]"
            )}
          >
            <Disc className="w-4 h-4" />
          </div>
        </div>

        {/* Info */}
        <div
          onClick={() => setIsMinimized(false)}
          className="flex flex-col cursor-pointer max-w-[140px] md:max-w-[200px]"
          title={cleanTrackTitle}
        >
          <span className="text-xs font-semibold text-slate-200 truncate">
            {cleanTrackTitle}
          </span>
          <span className="text-[10px] text-cyan-400 font-mono">
            {formatTime(effectiveCurrentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="w-7 h-7 text-slate-300 hover:text-white hover:bg-slate-800 rounded-full"
            onClick={togglePlay}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="w-7 h-7 text-slate-300 hover:text-white hover:bg-slate-800 rounded-full"
            onClick={handleNext}
            title="Next Track"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="w-7 h-7 text-slate-300 hover:text-cyan-400 hover:bg-slate-800 rounded-full"
            onClick={() => setIsMinimized(false)}
            title="Expand Full Bar"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="w-7 h-7 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-full"
            onClick={onClose}
            title="Close Audio Player"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Full Spotify-Style Floating Bottom Player Bar
  // -------------------------------------------------------------
  return (
    <div className="fixed bottom-3 inset-x-3 md:inset-x-6 z-50 select-none animate-in fade-in slide-in-from-bottom-4 duration-300">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={() => {
          setHasError(true);
          setIsLoading(false);
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
      />

      <div className="relative bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-2xl border border-slate-700/60 dark:border-slate-800/80 shadow-[0_12px_45px_rgba(0,0,0,0.65)] rounded-2xl p-2.5 md:p-3 text-slate-100 flex flex-col md:flex-row items-center justify-between gap-3 overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-transparent before:via-cyan-500 before:to-transparent">
        
        {/* ============================================================ */}
        {/* LEFT SECTION: Track Info & Vinyl Art */}
        {/* ============================================================ */}
        <div className="flex items-center gap-3 w-full md:w-[28%] min-w-0 justify-between md:justify-start">
          <div className="flex items-center gap-3 min-w-0">
            {/* Vinyl Record */}
            <div className="relative flex-shrink-0 w-11 h-11 md:w-12 md:h-12 rounded-full bg-gradient-to-tr from-cyan-600/40 via-indigo-600/40 to-purple-600/40 p-[2px] shadow-md shadow-cyan-950">
              <div
                className={cn(
                  "w-full h-full rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center text-cyan-400 relative overflow-hidden",
                  isPlaying && "animate-[spin_6s_linear_infinite]"
                )}
                style={{
                  animationPlayState: isPlaying ? "running" : "paused",
                }}
              >
                {/* Vinyl Grooves */}
                <div className="absolute inset-1 rounded-full border border-slate-800/60" />
                <div className="absolute inset-2.5 rounded-full border border-slate-800/80" />
                <Disc className="w-5 h-5 text-cyan-400 relative z-10" />
                <div className="absolute w-2 h-2 rounded-full bg-cyan-400/80 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              </div>
            </div>

            {/* Title & Metadata */}
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm md:text-base text-slate-100 truncate hover:text-cyan-400 transition-colors" title={cleanTrackTitle}>
                  {cleanTrackTitle}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 text-[10px] font-mono tracking-wider border-cyan-500/40 text-cyan-400 bg-cyan-950/30"
                >
                  {trackExtension}
                </Badge>
                <span className="text-[11px] text-slate-400 truncate">
                  Track {currentIndex + 1} of {playlist.length}
                </span>
                {activeTrack.size && (
                  <span className="text-[10px] text-slate-500 hidden sm:inline">
                    • {formatFileSize(activeTrack.size)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Right Controls: Close & Minimize */}
          <div className="flex md:hidden items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7 text-slate-400 hover:text-white"
              onClick={() => setIsMinimized(true)}
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7 text-slate-400 hover:text-red-400"
              onClick={onClose}
            >
              <X className="w-3.5 h-3.5" />
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
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "w-8 h-8 rounded-full transition-colors",
                isShuffle
                  ? "text-cyan-400 bg-cyan-950/40 hover:bg-cyan-900/50"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              )}
              onClick={() => setIsShuffle((prev) => !prev)}
              title={isShuffle ? "Shuffle On" : "Shuffle Off"}
            >
              <Shuffle className="w-4 h-4" />
            </Button>

            {/* Prev */}
            <Button
              size="icon"
              variant="ghost"
              className="w-8 h-8 text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-full"
              onClick={handlePrev}
              title="Previous Track"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </Button>

            {/* Play/Pause Main Button */}
            <Button
              size="icon"
              className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 hover:scale-105 active:scale-95 transition-all flex items-center justify-center relative"
              onClick={togglePlay}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </Button>

            {/* Next */}
            <Button
              size="icon"
              variant="ghost"
              className="w-8 h-8 text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-full"
              onClick={handleNext}
              title="Next Track"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </Button>

            {/* Repeat */}
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "w-8 h-8 rounded-full relative transition-colors",
                repeatMode !== "off"
                  ? "text-cyan-400 bg-cyan-950/40 hover:bg-cyan-900/50"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              )}
              onClick={cycleRepeatMode}
              title={`Repeat: ${repeatMode.toUpperCase()}`}
            >
              {repeatMode === "one" ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
              {repeatMode !== "off" && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-cyan-400" />
              )}
            </Button>
          </div>

          {/* Scrubber & Time Display */}
          <div className="flex items-center gap-2.5 w-full text-xs font-mono text-slate-400 px-1">
            <span className="w-10 text-right select-none text-[11px]">
              {formatTime(effectiveCurrentTime)}
            </span>

            {/* Seek Bar with buffer underlay */}
            <div className="relative flex-1 flex items-center group cursor-pointer py-1">
              {/* Buffered progress track */}
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-800 overflow-hidden pointer-events-none">
                <div
                  className="h-full bg-slate-700/70 transition-all duration-200"
                  style={{ width: `${bufferedPercent}%` }}
                />
              </div>

              {/* Interactive Radix Slider */}
              <Slider
                value={[effectiveCurrentTime]}
                min={0}
                max={duration || 100}
                step={0.5}
                onValueChange={handleSeekChange}
                onValueCommit={handleSeekCommit}
                className="relative z-10 w-full"
              />
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
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs font-mono text-slate-400 hover:text-cyan-400 hover:bg-slate-800/70 rounded-md"
            onClick={cyclePlaybackRate}
            title="Playback Speed"
          >
            {playbackRate}x
          </Button>

          {/* Volume Control */}
          <div className="flex items-center gap-2 group w-28">
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7 text-slate-400 hover:text-white rounded-full p-0 flex-shrink-0"
              onClick={() => setIsMuted((prev) => !prev)}
              title={isMuted ? "Unmute (M)" : "Mute (M)"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
            <Slider
              value={[isMuted ? 0 : volume]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(val) => {
                setIsMuted(false);
                setVolume(val[0]);
              }}
              className="w-16"
            />
          </div>

          {/* Playlist Drawer Popover */}
          <Popover open={isPlaylistOpen} onOpenChange={setIsPlaylistOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className={cn(
                  "h-8 px-2.5 gap-1.5 text-xs rounded-lg transition-colors",
                  isPlaylistOpen
                    ? "text-cyan-400 bg-cyan-950/50 border border-cyan-500/30"
                    : "text-slate-300 hover:text-white hover:bg-slate-800"
                )}
                title="Playlist Queue"
              >
                <ListMusic className="w-4 h-4" />
                <span className="font-mono text-[11px] font-semibold">
                  {playlist.length}
                </span>
              </Button>
            </PopoverTrigger>

            <PopoverContent
              side="top"
              align="end"
              className="w-80 md:w-96 p-0 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-2xl border border-slate-700/80 shadow-2xl rounded-xl text-slate-100 overflow-hidden mb-2"
            >
              {/* Popover Header */}
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800 bg-slate-950/60">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-cyan-400" />
                  <span className="font-semibold text-xs text-slate-200">
                    Playlist Queue
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-slate-800">
                    {playlist.length} tracks
                  </Badge>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Playing #{currentIndex + 1}
                </div>
              </div>

              {/* Track list */}
              <ScrollArea className="max-h-72 overflow-y-auto p-1.5 divide-y divide-slate-800/40">
                {playlist.map((track, idx) => {
                  const isCur = idx === currentIndex;
                  const trackClean = track.name.replace(/\.[^/.]+$/, "");
                  return (
                    <div
                      key={track.id || `${track.name}-${idx}`}
                      onClick={() => {
                        onTrackChange(idx);
                        setIsPlaylistOpen(false);
                      }}
                      className={cn(
                        "flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all text-xs group",
                        isCur
                          ? "bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 font-medium"
                          : "hover:bg-slate-800/60 text-slate-300"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        {isCur ? (
                          <div className="flex items-end gap-[2px] w-4 h-4 justify-center">
                            <span className="w-1 bg-cyan-400 rounded-sm animate-[bounce_0.8s_infinite] h-3" />
                            <span className="w-1 bg-cyan-400 rounded-sm animate-[bounce_1.1s_infinite] h-4" />
                            <span className="w-1 bg-cyan-400 rounded-sm animate-[bounce_0.9s_infinite] h-2" />
                          </div>
                        ) : (
                          <span className="font-mono text-slate-500 w-4 text-center text-[11px] group-hover:text-slate-300">
                            {idx + 1}
                          </span>
                        )}

                        <span className="truncate" title={track.name}>
                          {trackClean}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-slate-500 font-mono">
                        {track.size ? formatFileSize(track.size) : ""}
                      </div>
                    </div>
                  );
                })}
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* Download Track */}
          <Button
            size="icon"
            variant="ghost"
            className="w-8 h-8 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
            onClick={() => {
              downloadManager.addDownload(activeTrack.url, activeTrack.name);
            }}
            title="Download this Track"
          >
            <Download className="w-4 h-4" />
          </Button>

          {/* Minimize into Pill */}
          <Button
            size="icon"
            variant="ghost"
            className="w-8 h-8 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg"
            onClick={() => setIsMinimized(true)}
            title="Minimize to Floating Pill"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>

          {/* Close Player */}
          <Button
            size="icon"
            variant="ghost"
            className="w-8 h-8 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg"
            onClick={onClose}
            title="Close Audio Player"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
