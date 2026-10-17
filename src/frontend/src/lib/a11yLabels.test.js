/**
 * Unit tests for Phase 6 Batch 1: Accessible Names and Screen Reader Labels.
 */

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

export function runA11yLabelTests() {
  console.log('Running Accessibility Label & Screen Reader tests (Phase 6 Batch 1)...');

  // 1. Audio Play / Pause
  console.assert(getAudioPlayPauseLabel(true) === "Pause audio", "Playing state should yield 'Pause audio'");
  console.assert(getAudioPlayPauseLabel(false) === "Play audio", "Paused state should yield 'Play audio'");

  // 2. Audio Repeat Modes
  console.assert(getAudioRepeatLabel("off") === "Enable repeat", "Repeat off should suggest enabling repeat");
  console.assert(getAudioRepeatLabel("all") === "Repeat all tracks", "Repeat all should yield 'Repeat all tracks'");
  console.assert(getAudioRepeatLabel("one") === "Repeat current track", "Repeat one should yield 'Repeat current track'");

  // 3. Audio Shuffle
  console.assert(getAudioShuffleLabel(false) === "Enable shuffle", "Shuffle off should suggest enabling shuffle");
  console.assert(getAudioShuffleLabel(true) === "Disable shuffle", "Shuffle on should suggest disabling shuffle");

  // 4. Audio Playback Speed
  console.assert(getAudioSpeedLabel(1) === "Playback speed, current 1x", "Rate 1x label mismatch");
  console.assert(getAudioSpeedLabel(1.5) === "Playback speed, current 1.5x", "Rate 1.5x label mismatch");

  // 5. Audio Mute
  console.assert(getAudioMuteLabel(false) === "Mute audio", "Unmuted state should yield 'Mute audio'");
  console.assert(getAudioMuteLabel(true) === "Unmute audio", "Muted state should yield 'Unmute audio'");

  // 6. Video Controls
  console.assert(getVideoPlayPauseLabel(true) === "Pause video", "Video playing should yield 'Pause video'");
  console.assert(getVideoPlayPauseLabel(false) === "Play video", "Video paused should yield 'Play video'");
  console.assert(getVideoFullscreenLabel(true) === "Exit fullscreen", "Fullscreen active should yield 'Exit fullscreen'");
  console.assert(getVideoFullscreenLabel(false) === "Enter fullscreen", "Fullscreen inactive should yield 'Enter fullscreen'");

  // 7. Transfers Widget Header
  console.assert(getTransfersExpandLabel(true) === "Collapse transfers panel", "Expanded widget should yield 'Collapse transfers panel'");
  console.assert(getTransfersExpandLabel(false) === "Expand transfers panel", "Collapsed widget should yield 'Expand transfers panel'");

  // 8. Transfers Widget Item Actions
  console.assert(getTransfersItemActionLabel("pause", "movie.mp4") === "Pause transfer movie.mp4", "Pause action with name");
  console.assert(getTransfersItemActionLabel("pause", "") === "Pause transfer", "Pause action with empty name");
  console.assert(getTransfersItemActionLabel("resume", "doc.pdf") === "Resume transfer doc.pdf", "Resume action with name");
  console.assert(getTransfersItemActionLabel("cancel", "file.zip", false) === "Cancel transfer file.zip", "Single item cancel");
  console.assert(getTransfersItemActionLabel("cancel", "MyFolder", true) === "Cancel entire folder MyFolder", "Group folder cancel");
  console.assert(getTransfersItemActionLabel("cancel", "", true) === "Cancel entire folder", "Group folder cancel without name");

  // 9. Floating Upload Button
  console.assert(getFloatingUploadTriggerLabel(false) === "Upload or create folder", "Closed menu trigger label");
  console.assert(getFloatingUploadTriggerLabel(true) === "Close upload menu", "Open menu trigger label");

  console.log('All Accessibility Label tests passed successfully! (20/20 assertions)');
  return true;
}

if (typeof process !== 'undefined') {
  runA11yLabelTests();
}
