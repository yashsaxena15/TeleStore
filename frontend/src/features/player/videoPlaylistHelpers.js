/**
 * Pure helper functions for video playlist management and autoplay logic.
 */

export const VIDEO_EXTENSIONS = new Set([
  "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "3gp", "ts"
]);

/**
 * Checks whether an item or extension represents a video file.
 * @param {string|{name?: string, extension?: string, fileType?: string, type?: string}} item
 * @returns {boolean}
 */
export function isVideoItem(item) {
  if (!item) return false;
  if (typeof item === "string") {
    const ext = item.split(".").pop()?.toLowerCase() || "";
    return VIDEO_EXTENSIONS.has(ext);
  }
  if (item.type === "folder") return false;
  if (item.fileType === "video" || item.type === "video") return true;
  const ext = (item.extension || item.name?.split(".").pop() || "").toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Finds the index of a target video within a playlist.
 * Matches on id, fileItem.id, url, name, or fileName.
 * @param {Array<object>} playlist
 * @param {object} target
 * @returns {number} 0-based index, or 0 if not found
 */
export function findVideoIndex(playlist, target) {
  if (!Array.isArray(playlist) || playlist.length === 0 || !target) {
    return 0;
  }

  const targetId = target.id || target.fileItem?.id;
  const targetUrl = target.url;
  const targetName = target.fileName || target.name || target.fileItem?.name;

  const foundIndex = playlist.findIndex((item) => {
    if (!item) return false;
    const itemId = item.id || item.fileItem?.id;
    if (targetId && itemId && String(itemId) === String(targetId)) {
      return true;
    }
    if (targetUrl && item.url && item.url === targetUrl) {
      return true;
    }
    const itemName = item.fileName || item.name || item.fileItem?.name;
    if (targetName && itemName && itemName === targetName) {
      return true;
    }
    return false;
  });

  return foundIndex >= 0 ? foundIndex : 0;
}

/**
 * Returns the index of the next video in the playlist, or null if at the end.
 * @param {number} currentIndex
 * @param {number} playlistLength
 * @returns {number|null}
 */
export function getNextVideoIndex(currentIndex, playlistLength) {
  if (typeof currentIndex !== "number" || typeof playlistLength !== "number") {
    return null;
  }
  if (currentIndex < playlistLength - 1 && currentIndex >= 0) {
    return currentIndex + 1;
  }
  return null;
}

/**
 * Returns the index of the previous video in the playlist, or null if at the start.
 * @param {number} currentIndex
 * @returns {number|null}
 */
export function getPrevVideoIndex(currentIndex) {
  if (typeof currentIndex !== "number" || currentIndex <= 0) {
    return null;
  }
  return currentIndex - 1;
}

/**
 * Determines whether playback should automatically start when buffer is ready.
 * Autoplay triggers if:
 * 1. The user has not explicitly clicked pause (userPaused === false)
 * 2. The media element is currently paused (isPaused === true)
 * 3. The media element has buffered enough data (readyState >= 3 or bufferReady === true)
 *
 * @param {boolean} userPaused
 * @param {boolean} isPaused
 * @param {number|boolean} [readyStateOrBufferReady]
 * @returns {boolean}
 */
export function shouldAutoplayOnBufferReady(userPaused, isPaused, readyStateOrBufferReady = true) {
  if (userPaused) return false;
  if (!isPaused) return false;
  if (typeof readyStateOrBufferReady === "number") {
    return readyStateOrBufferReady >= 3;
  }
  return Boolean(readyStateOrBufferReady);
}

/**
 * Builds a standardized playlist item array from folder items.
 *
 * @param {Array<object>} items
 * @param {object} options
 * @param {Function} [options.getCloudStreamUrl]
 * @param {string} [options.cloudAccountId]
 * @param {string} [options.baseUrl]
 * @param {string} [options.tokenParam]
 * @param {string} [options.sep]
 * @returns {Array<object>}
 */
export function buildFolderVideoPlaylist(items, options = {}) {
  if (!Array.isArray(items)) return [];

  const {
    getCloudStreamUrl,
    cloudAccountId,
    baseUrl = "",
    tokenParam = "",
    sep = "?",
  } = options;

  return items
    .filter(isVideoItem)
    .map((it) => {
      let trackUrl = "";
      if (it.is_cloud && typeof getCloudStreamUrl === "function") {
        trackUrl = getCloudStreamUrl(
          cloudAccountId || it.cloud_account_id,
          it.cloud_file_id || it.id
        );
      } else {
        const itFId = it.id ? `&file_id=${encodeURIComponent(it.id)}` : "";
        const itFPath = it.file_path ? `&path=${encodeURIComponent(it.file_path)}` : "";
        trackUrl = `${baseUrl}/dl/${encodeURIComponent(it.name)}${tokenParam}${sep}inline=1${itFId}${itFPath}`;
      }

      return {
        id: it.id || it.name,
        name: it.name,
        fileName: it.name,
        fileType: "video",
        url: trackUrl,
        size: it.size,
        fileItem: it,
      };
    });
}

