/**
 * Pure helpers for FileGrid card formatting, video duration badges, and metadata resolution.
 */

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return null;
  const num = Number(seconds);
  if (!isFinite(num) || num <= 0) return null;
  const totalSeconds = Math.floor(num);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function getItemDuration(item) {
  if (!item) return null;
  const raw = item.duration ?? item.metadata?.duration ?? item.video_duration ?? item.video?.duration;
  return formatDuration(raw);
}

export function isItemStarred(item) {
  if (!item) return false;
  return Boolean(item.starred || item.is_starred);
}
