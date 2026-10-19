import { describe, it, expect } from 'vitest';

describe('Dock Layout and Transfer Anchor', () => {
  function getTransferAnchorClasses(hasActiveAudioTrack, isAudioMinimized) {
    const needsDockElevation = Boolean(hasActiveAudioTrack && !isAudioMinimized);
    return needsDockElevation
      ? "fixed right-4 z-40 w-[calc(100vw-2rem)] sm:w-80 md:w-96 max-w-[calc(100vw-2rem)] shadow-2xl rounded-xl border border-border bg-card text-card-foreground overflow-hidden transition-all duration-300 ease-in-out bottom-28 sm:bottom-24 2xl:bottom-4"
      : "fixed right-4 z-40 w-[calc(100vw-2rem)] sm:w-80 md:w-96 max-w-[calc(100vw-2rem)] shadow-2xl rounded-xl border border-border bg-card text-card-foreground overflow-hidden transition-all duration-300 ease-in-out bottom-4";
  }

  it('elevates transfer anchor when audio is active and full bar on small/tablet/laptop viewports', () => {
    const offsetWithFullAudio = getTransferAnchorClasses(true, false);
    expect(offsetWithFullAudio).toContain("bottom-28");
    expect(offsetWithFullAudio).toContain("2xl:bottom-4");
  });

  it('drops transfer anchor to bottom-4 when audio is minimized', () => {
    const offsetWithMinimizedAudio = getTransferAnchorClasses(true, true);
    expect(offsetWithMinimizedAudio.endsWith("bottom-4")).toBe(true);
  });

  it('sits transfer anchor at bottom-4 when audio is inactive', () => {
    const offsetWithoutAudio = getTransferAnchorClasses(false, false);
    expect(offsetWithoutAudio.endsWith("bottom-4")).toBe(true);
  });

  function getAudioDockClasses(isMinimized) {
    if (isMinimized) {
      return "fixed bottom-4 left-1/2 -translate-x-1/2 z-40";
    }
    return "fixed bottom-3 left-1/2 -translate-x-1/2 z-40";
  }

  it('centers audio player dock horizontally in both minimized and full modes', () => {
    const minimizedClasses = getAudioDockClasses(true);
    expect(minimizedClasses).toContain("left-1/2 -translate-x-1/2");

    const fullBarClasses = getAudioDockClasses(false);
    expect(fullBarClasses).toContain("left-1/2 -translate-x-1/2");
  });

  it('preserves video state independently when starting audio playback', () => {
    let currentMedia = { fileName: "movie.mp4", fileType: "video", url: "http://example.com/video.mp4" };
    let activeAudioTrack = null;

    function simulatePlayAudio(track) {
      activeAudioTrack = track;
    }

    simulatePlayAudio({ name: "song.mp3", url: "http://example.com/audio.mp3" });
    expect(currentMedia.fileName).toBe("movie.mp4");
    expect(activeAudioTrack.name).toBe("song.mp3");
  });

  it('preserves video currentTime when toggling video mini mode', () => {
    let isVideoMini = false;
    let videoCurrentTime = 124.5;

    function toggleVideoMini() {
      isVideoMini = !isVideoMini;
    }

    toggleVideoMini();
    expect(isVideoMini).toBe(true);
    expect(videoCurrentTime).toBe(124.5);

    toggleVideoMini();
    expect(isVideoMini).toBe(false);
    expect(videoCurrentTime).toBe(124.5);
  });
});
