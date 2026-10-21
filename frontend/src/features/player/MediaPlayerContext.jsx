import React, { createContext, useContext, useState, useCallback, lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/feedback/ErrorBoundary";
import { PersistentAudioPlayer } from "./PersistentAudioPlayer";
import { downloadManager } from "@/features/transfers/downloadManager";
import { findVideoIndex, getNextVideoIndex, getPrevVideoIndex } from "./videoPlaylistHelpers";

// The video player is split into its own chunk and loads on first play
const MediaPlayer = lazy(() => import("./MediaPlayer").then((m) => ({ default: m.MediaPlayer })));
export const MediaPlayerContext = createContext(undefined);
export const MediaPlayerProvider = ({ children }) => {
    // Video modal media & playlist state
    const [currentMedia, setCurrentMedia] = useState(null);
    const [videoPlaylist, setVideoPlaylist] = useState([]);
    const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
    const [isVideoMini, setIsVideoMini] = useState(false);

    // Persistent audio player state
    const [activeAudioTrack, setActiveAudioTrack] = useState(null);
    const [audioPlaylist, setAudioPlaylist] = useState([]);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(0);

    const closeMedia = () => {
        if (currentMedia?.url.startsWith("blob:")) {
            try {
                URL.revokeObjectURL(currentMedia.url);
            }
            catch (e) { }
        }
        setCurrentMedia(null);
        setVideoPlaylist([]);
        setCurrentVideoIndex(0);
        setIsVideoMini(false);
    };

    const closeAudioPlayer = () => {
        setActiveAudioTrack(null);
        setAudioPlaylist([]);
        setCurrentTrackIndex(0);
    };

    const playAudio = (track, playlist) => {
        // One thing plays at a time: starting audio pauses a docked or open video
        window.dispatchEvent(new Event("telestore:pause-video"));
        if (playlist && playlist.length > 0) {
            setAudioPlaylist(playlist);
            const foundIdx = playlist.findIndex((t) => (t.fileItem?.id && t.fileItem.id === track.fileItem?.id) || t.url === track.url || t.name === track.name);
            const idx = foundIdx >= 0 ? foundIdx : 0;
            setCurrentTrackIndex(idx);
            setActiveAudioTrack(playlist[idx] || track);
        }
        else {
            setAudioPlaylist([track]);
            setCurrentTrackIndex(0);
            setActiveAudioTrack(track);
        }
    };

    const playMedia = (media, playlist) => {
        const isAudio = media.fileType === "audio" || media.fileType === "voice";
        if (isAudio) {
            const track = {
                id: media.fileItem?.id || media.fileName,
                name: media.fileName,
                url: media.url,
                size: media.fileItem?.size,
                fileItem: media.fileItem,
            };
            playAudio(track, playlist);
            return;
        }

        // Video media: open the theater player and pause any audio
        window.dispatchEvent(new Event("telestore:pause-audio"));
        if (currentMedia?.url && currentMedia.url !== media.url && currentMedia.url.startsWith("blob:")) {
            try {
                URL.revokeObjectURL(currentMedia.url);
            }
            catch (e) { }
        }

        if (playlist && playlist.length > 0) {
            setVideoPlaylist(playlist);
            const idx = findVideoIndex(playlist, media);
            setCurrentVideoIndex(idx);
            setCurrentMedia(playlist[idx] || media);
        } else {
            setVideoPlaylist([media]);
            setCurrentVideoIndex(0);
            setCurrentMedia(media);
        }
    };

    const playNextVideo = useCallback(() => {
        const nextIdx = getNextVideoIndex(currentVideoIndex, videoPlaylist.length);
        if (nextIdx !== null && videoPlaylist[nextIdx]) {
            setCurrentVideoIndex(nextIdx);
            setCurrentMedia(videoPlaylist[nextIdx]);
        }
    }, [currentVideoIndex, videoPlaylist]);

    const playPrevVideo = useCallback(() => {
        const prevIdx = getPrevVideoIndex(currentVideoIndex);
        if (prevIdx !== null && videoPlaylist[prevIdx]) {
            setCurrentVideoIndex(prevIdx);
            setCurrentMedia(videoPlaylist[prevIdx]);
        }
    }, [currentVideoIndex, videoPlaylist]);

    const playVideoAtIndex = useCallback((idx) => {
        if (idx >= 0 && idx < videoPlaylist.length && videoPlaylist[idx]) {
            setCurrentVideoIndex(idx);
            setCurrentMedia(videoPlaylist[idx]);
        }
    }, [videoPlaylist]);

    return (<MediaPlayerContext.Provider value={{
            currentMedia,
            playMedia,
            closeMedia,
            videoPlaylist,
            currentVideoIndex,
            playNextVideo,
            playPrevVideo,
            playVideoAtIndex,
            isVideoMini,
            setIsVideoMini,
            activeAudioTrack,
            audioPlaylist,
            currentTrackIndex,
            playAudio,
            closeAudioPlayer,
        }}>
      {children}

      {/* Video Modal Player */}
      <ErrorBoundary name="Video player" fallback="silent">
      <Suspense fallback={null}>
      {currentMedia && currentMedia.fileType === "video" && (
        <MediaPlayer
          key={currentMedia.url + (currentMedia.id || currentVideoIndex)}
          mediaUrl={currentMedia.url}
          fileName={currentMedia.fileName || currentMedia.name}
          fileType={currentMedia.fileType}
          playlist={videoPlaylist}
          currentIndex={currentVideoIndex}
          onNext={currentVideoIndex < videoPlaylist.length - 1 ? playNextVideo : undefined}
          onPrev={currentVideoIndex > 0 ? playPrevVideo : undefined}
          onSelectTrack={playVideoAtIndex}
          isMini={isVideoMini}
          onMiniChange={setIsVideoMini}
          onDownload={() => {
            downloadManager.addDownload(currentMedia.url, currentMedia.fileName || currentMedia.name);
          }}
          onClose={closeMedia}
        />
      )}
      </Suspense>
      </ErrorBoundary>

      {/* Persistent Floating Bottom Audio Player */}
      <ErrorBoundary name="Audio player" fallback="silent">
      {activeAudioTrack && (<PersistentAudioPlayer key={activeAudioTrack.id || activeAudioTrack.url} activeTrack={activeAudioTrack} playlist={audioPlaylist} currentIndex={currentTrackIndex} onTrackChange={(newIdx) => {
                if (newIdx >= 0 && newIdx < audioPlaylist.length) {
                    setCurrentTrackIndex(newIdx);
                    setActiveAudioTrack(audioPlaylist[newIdx]);
                }
            }} onClose={closeAudioPlayer}/>)}
      </ErrorBoundary>
    </MediaPlayerContext.Provider>);
};
export const useMediaPlayer = () => {
    const context = useContext(MediaPlayerContext);
    if (!context) {
        throw new Error("useMediaPlayer must be used within a MediaPlayerProvider");
    }
    return context;
};
