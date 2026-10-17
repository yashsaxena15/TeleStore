import React, { createContext, useContext, useState } from "react";
import { MediaPlayer } from "@/components/MediaPlayer";
import { PersistentAudioPlayer } from "@/components/PersistentAudioPlayer";
import { downloadManager } from "@/lib/downloadManager";
const MediaPlayerContext = createContext(undefined);
export const MediaPlayerProvider = ({ children }) => {
    // Video modal media
    const [currentMedia, setCurrentMedia] = useState(null);
    // Persistent audio player state
    const [activeAudioTrack, setActiveAudioTrack] = useState(null);
    const [audioPlaylist, setAudioPlaylist] = useState([]);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
    const [isAudioMinimized, setIsAudioMinimized] = useState(false);
    const closeMedia = () => {
        if (currentMedia?.url.startsWith("blob:")) {
            try {
                URL.revokeObjectURL(currentMedia.url);
            }
            catch (e) { }
        }
        setCurrentMedia(null);
    };
    const closeAudioPlayer = () => {
        setActiveAudioTrack(null);
        setAudioPlaylist([]);
        setCurrentTrackIndex(0);
        setIsAudioMinimized(false);
    };
    const playAudio = (track, playlist) => {
        // Audio and video playback states remain independent
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
        // Video media: open modal player
        if (currentMedia?.url && currentMedia.url !== media.url && currentMedia.url.startsWith("blob:")) {
            try {
                URL.revokeObjectURL(currentMedia.url);
            }
            catch (e) { }
        }
        setCurrentMedia(media);
    };
    return (<MediaPlayerContext.Provider value={{
            currentMedia,
            playMedia,
            closeMedia,
            activeAudioTrack,
            audioPlaylist,
            currentTrackIndex,
            isAudioMinimized,
            setIsAudioMinimized,
            playAudio,
            closeAudioPlayer,
        }}>
      {children}

      {/* Video Modal Player */}
      {currentMedia && currentMedia.fileType === "video" && (<MediaPlayer key={currentMedia.url} mediaUrl={currentMedia.url} fileName={currentMedia.fileName} fileType={currentMedia.fileType} onDownload={() => {
                downloadManager.addDownload(currentMedia.url, currentMedia.fileName);
            }} onClose={closeMedia}/>)}

      {/* Persistent Floating Bottom Audio Player */}
      {activeAudioTrack && (<PersistentAudioPlayer key={activeAudioTrack.id || activeAudioTrack.url} activeTrack={activeAudioTrack} playlist={audioPlaylist} currentIndex={currentTrackIndex} isMinimized={isAudioMinimized} onToggleMinimize={setIsAudioMinimized} onTrackChange={(newIdx) => {
                if (newIdx >= 0 && newIdx < audioPlaylist.length) {
                    setCurrentTrackIndex(newIdx);
                    setActiveAudioTrack(audioPlaylist[newIdx]);
                }
            }} onClose={closeAudioPlayer}/>)}
    </MediaPlayerContext.Provider>);
};
export const useMediaPlayer = () => {
    const context = useContext(MediaPlayerContext);
    if (!context) {
        throw new Error("useMediaPlayer must be used within a MediaPlayerProvider");
    }
    return context;
};
