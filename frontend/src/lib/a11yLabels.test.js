import { describe, it, expect } from 'vitest';
import {
  getAudioPlayPauseLabel,
  getAudioRepeatLabel,
  getAudioShuffleLabel,
  getAudioSpeedLabel,
  getAudioMuteLabel,
  getTransfersExpandLabel,
  getTransfersItemActionLabel,
  getFloatingUploadTriggerLabel,
  getVideoPlayPauseLabel,
  getVideoFullscreenLabel
} from './a11yLabels.js';

describe('Accessibility Labels (Phase 6 Batch 1)', () => {
  it('handles audio play/pause labels', () => {
    expect(getAudioPlayPauseLabel(true)).toBe("Pause audio");
    expect(getAudioPlayPauseLabel(false)).toBe("Play audio");
  });

  it('handles audio repeat labels', () => {
    expect(getAudioRepeatLabel("off")).toBe("Enable repeat");
    expect(getAudioRepeatLabel("all")).toBe("Repeat all tracks");
    expect(getAudioRepeatLabel("one")).toBe("Repeat current track");
  });

  it('handles audio shuffle labels', () => {
    expect(getAudioShuffleLabel(false)).toBe("Enable shuffle");
    expect(getAudioShuffleLabel(true)).toBe("Disable shuffle");
  });

  it('handles audio speed labels', () => {
    expect(getAudioSpeedLabel(1)).toBe("Playback speed, current 1x");
    expect(getAudioSpeedLabel(1.5)).toBe("Playback speed, current 1.5x");
  });

  it('handles audio mute labels', () => {
    expect(getAudioMuteLabel(false)).toBe("Mute audio");
    expect(getAudioMuteLabel(true)).toBe("Unmute audio");
  });

  it('handles video control labels', () => {
    expect(getVideoPlayPauseLabel(true)).toBe("Pause video");
    expect(getVideoPlayPauseLabel(false)).toBe("Play video");
    expect(getVideoFullscreenLabel(true)).toBe("Exit fullscreen");
    expect(getVideoFullscreenLabel(false)).toBe("Enter fullscreen");
  });

  it('handles transfer widget expand labels', () => {
    expect(getTransfersExpandLabel(true)).toBe("Collapse transfers panel");
    expect(getTransfersExpandLabel(false)).toBe("Expand transfers panel");
  });

  it('handles transfer widget item action labels', () => {
    expect(getTransfersItemActionLabel("pause", "movie.mp4")).toBe("Pause transfer movie.mp4");
    expect(getTransfersItemActionLabel("pause", "")).toBe("Pause transfer");
    expect(getTransfersItemActionLabel("resume", "doc.pdf")).toBe("Resume transfer doc.pdf");
    expect(getTransfersItemActionLabel("cancel", "file.zip", false)).toBe("Cancel transfer file.zip");
    expect(getTransfersItemActionLabel("cancel", "MyFolder", true)).toBe("Cancel entire folder MyFolder");
    expect(getTransfersItemActionLabel("cancel", "", true)).toBe("Cancel entire folder");
  });

  it('handles floating upload trigger labels', () => {
    expect(getFloatingUploadTriggerLabel(false)).toBe("Upload or create folder");
    expect(getFloatingUploadTriggerLabel(true)).toBe("Close upload menu");
  });
});
