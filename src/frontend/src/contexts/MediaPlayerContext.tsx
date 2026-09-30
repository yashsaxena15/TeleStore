import React, { createContext, useContext, useState, ReactNode } from "react";
import { MediaPlayer } from "@/components/MediaPlayer";
import { PersistentAudioPlayer } from "@/components/PersistentAudioPlayer";
import { FileItem } from "@/components/types";
import { downloadManager } from "@/lib/downloadManager";

export interface AudioTrack {
  id: string;
  name: string;
  url: string;
  size?: number;
  duration?: number;
  artist?: string;
  fileItem?: FileItem;
}

export interface ActiveMedia {
  url: string;
  fileName: string;
  fileType: "video" | "audio" | "voice";
  fileItem?: FileItem;
  playlist?: AudioTrack[];
}

interface MediaPlayerContextType {
  // Video player modal state
  currentMedia: ActiveMedia | null;
  playMedia: (media: ActiveMedia, playlist?: AudioTrack[]) => void;
  closeMedia: () => void;

  // Persistent Audio player state & controls
  activeAudioTrack: AudioTrack | null;
  audioPlaylist: AudioTrack[];
  currentTrackIndex: number;
  playAudio: (track: AudioTrack, playlist?: AudioTrack[]) => void;
  closeAudioPlayer: () => void;
}

const MediaPlayerContext = createContext<MediaPlayerContextType | undefined>(undefined);

export const MediaPlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Video modal media
  const [currentMedia, setCurrentMedia] = useState<ActiveMedia | null>(null);

  // Persistent audio player state
  const [activeAudioTrack, setActiveAudioTrack] = useState<AudioTrack | null>(null);
  const [audioPlaylist, setAudioPlaylist] = useState<AudioTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);

  const closeMedia = () => {
    if (currentMedia?.url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(currentMedia.url);
      } catch (e) {}
    }
    setCurrentMedia(null);
  };

  const closeAudioPlayer = () => {
    setActiveAudioTrack(null);
    setAudioPlaylist([]);
    setCurrentTrackIndex(0);
  };

  const playAudio = (track: AudioTrack, playlist?: AudioTrack[]) => {
    // If video modal is open, close it
    closeMedia();

    if (playlist && playlist.length > 0) {
      setAudioPlaylist(playlist);
      const foundIdx = playlist.findIndex(
        (t) => (t.fileItem?.id && t.fileItem.id === track.fileItem?.id) || t.url === track.url || t.name === track.name
      );
      const idx = foundIdx >= 0 ? foundIdx : 0;
      setCurrentTrackIndex(idx);
      setActiveAudioTrack(playlist[idx] || track);
    } else {
      setAudioPlaylist([track]);
      setCurrentTrackIndex(0);
      setActiveAudioTrack(track);
    }
  };

  const playMedia = (media: ActiveMedia, playlist?: AudioTrack[]) => {
    const isAudio = media.fileType === "audio" || media.fileType === "voice";

    if (isAudio) {
      const track: AudioTrack = {
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
      } catch (e) {}
    }
    setCurrentMedia(media);
  };

  return (
    <MediaPlayerContext.Provider
      value={{
        currentMedia,
        playMedia,
        closeMedia,
        activeAudioTrack,
        audioPlaylist,
        currentTrackIndex,
        playAudio,
        closeAudioPlayer,
      }}
    >
      {children}

      {/* Video Modal Player */}
      {currentMedia && currentMedia.fileType === "video" && (
        <MediaPlayer
          key={currentMedia.url}
          mediaUrl={currentMedia.url}
          fileName={currentMedia.fileName}
          fileType={currentMedia.fileType}
          onDownload={() => {
            downloadManager.addDownload(currentMedia.url, currentMedia.fileName);
          }}
          onClose={closeMedia}
        />
      )}

      {/* Persistent Floating Bottom Audio Player */}
      {activeAudioTrack && (
        <PersistentAudioPlayer
          key={activeAudioTrack.id || activeAudioTrack.url}
          activeTrack={activeAudioTrack}
          playlist={audioPlaylist}
          currentIndex={currentTrackIndex}
          onTrackChange={(newIdx) => {
            if (newIdx >= 0 && newIdx < audioPlaylist.length) {
              setCurrentTrackIndex(newIdx);
              setActiveAudioTrack(audioPlaylist[newIdx]);
            }
          }}
          onClose={closeAudioPlayer}
        />
      )}
    </MediaPlayerContext.Provider>
  );
};

export const useMediaPlayer = () => {
  const context = useContext(MediaPlayerContext);
  if (!context) {
    throw new Error("useMediaPlayer must be used within a MediaPlayerProvider");
  }
  return context;
};
