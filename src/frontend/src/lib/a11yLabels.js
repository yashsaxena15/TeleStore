/**
 * Accessibility label generators and validators for Phase 6 Batch 1.
 */

export function getAudioPlayPauseLabel(isPlaying) {
  return isPlaying ? "Pause audio" : "Play audio";
}

export function getAudioRepeatLabel(repeatMode) {
  if (repeatMode === "one") return "Repeat current track";
  if (repeatMode === "all") return "Repeat all tracks";
  return "Enable repeat";
}

export function getAudioShuffleLabel(isShuffle) {
  return isShuffle ? "Disable shuffle" : "Enable shuffle";
}

export function getAudioSpeedLabel(rate) {
  return `Playback speed, current ${rate}x`;
}

export function getAudioMuteLabel(isMuted) {
  return isMuted ? "Unmute audio" : "Mute audio";
}

export function getTransfersExpandLabel(isExpanded) {
  return isExpanded ? "Collapse transfers panel" : "Expand transfers panel";
}

export function getTransfersItemActionLabel(action, filename, isGroup = false) {
  const cleanName = filename ? ` ${filename}` : '';
  if (action === "pause") return `Pause transfer${cleanName}`.trim();
  if (action === "resume") return `Resume transfer${cleanName}`.trim();
  if (action === "cancel") {
    return isGroup ? `Cancel entire folder${cleanName}`.trim() : `Cancel transfer${cleanName}`.trim();
  }
  return `${action} transfer${cleanName}`.trim();
}

export function getFloatingUploadTriggerLabel(isOpen) {
  return isOpen ? "Close upload menu" : "Upload or create folder";
}

export function getVideoPlayPauseLabel(isPlaying) {
  return isPlaying ? "Pause video" : "Play video";
}

export function getVideoFullscreenLabel(isFullscreen) {
  return isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
}
