import { describe, it, expect } from "vitest";
import {
  isVideoItem,
  findVideoIndex,
  getNextVideoIndex,
  getPrevVideoIndex,
  shouldAutoplayOnBufferReady,
  buildFolderVideoPlaylist,
  VIDEO_EXTENSIONS,
} from "./videoPlaylistHelpers";

describe("videoPlaylistHelpers", () => {
  describe("isVideoItem", () => {
    it("recognizes standard video extensions from strings", () => {
      for (const ext of VIDEO_EXTENSIONS) {
        expect(isVideoItem(`movie.${ext}`)).toBe(true);
        expect(isVideoItem(`MOVIE.${ext.toUpperCase()}`)).toBe(true);
      }
    });

    it("rejects non-video extensions", () => {
      expect(isVideoItem("song.mp3")).toBe(false);
      expect(isVideoItem("doc.pdf")).toBe(false);
      expect(isVideoItem("image.png")).toBe(false);
      expect(isVideoItem(null)).toBe(false);
      expect(isVideoItem(undefined)).toBe(false);
    });

    it("recognizes video items by fileType or type", () => {
      expect(isVideoItem({ name: "clip", fileType: "video" })).toBe(true);
      expect(isVideoItem({ name: "clip", type: "video" })).toBe(true);
      expect(isVideoItem({ name: "clip.mp4", type: "file" })).toBe(true);
    });

    it("rejects folders even if folder name looks like video", () => {
      expect(isVideoItem({ name: "season1.mp4", type: "folder" })).toBe(false);
    });
  });

  describe("findVideoIndex", () => {
    const playlist = [
      { id: "101", name: "Episode 1.mp4", url: "/dl/ep1.mp4" },
      { id: "102", name: "Episode 2.mp4", url: "/dl/ep2.mp4" },
      { id: "103", name: "Episode 3.mp4", url: "/dl/ep3.mp4" },
    ];

    it("matches item by id", () => {
      expect(findVideoIndex(playlist, { id: "102" })).toBe(1);
    });

    it("matches item by fileItem.id", () => {
      expect(findVideoIndex(playlist, { fileItem: { id: "103" } })).toBe(2);
    });

    it("matches item by url", () => {
      expect(findVideoIndex(playlist, { url: "/dl/ep1.mp4" })).toBe(0);
    });

    it("matches item by fileName or name", () => {
      expect(findVideoIndex(playlist, { fileName: "Episode 3.mp4" })).toBe(2);
      expect(findVideoIndex(playlist, { name: "Episode 2.mp4" })).toBe(1);
    });

    it("returns 0 if not found or playlist is empty", () => {
      expect(findVideoIndex(playlist, { id: "999" })).toBe(0);
      expect(findVideoIndex([], { id: "101" })).toBe(0);
      expect(findVideoIndex(null, { id: "101" })).toBe(0);
    });
  });

  describe("getNextVideoIndex and getPrevVideoIndex", () => {
    it("returns next index when available", () => {
      expect(getNextVideoIndex(0, 3)).toBe(1);
      expect(getNextVideoIndex(1, 3)).toBe(2);
      expect(getNextVideoIndex(2, 3)).toBe(null); // at the end
    });

    it("returns null for invalid inputs in getNextVideoIndex", () => {
      expect(getNextVideoIndex(3, 3)).toBe(null);
      expect(getNextVideoIndex(-1, 3)).toBe(null);
      expect(getNextVideoIndex(null, 3)).toBe(null);
    });

    it("returns prev index when available", () => {
      expect(getPrevVideoIndex(2)).toBe(1);
      expect(getPrevVideoIndex(1)).toBe(0);
      expect(getPrevVideoIndex(0)).toBe(null); // at start
    });

    it("returns null for invalid inputs in getPrevVideoIndex", () => {
      expect(getPrevVideoIndex(-1)).toBe(null);
      expect(getPrevVideoIndex(null)).toBe(null);
    });
  });

  describe("shouldAutoplayOnBufferReady", () => {
    it("returns true when user has not paused and video is paused and buffer is ready", () => {
      expect(shouldAutoplayOnBufferReady(false, true, true)).toBe(true);
      expect(shouldAutoplayOnBufferReady(false, true, 3)).toBe(true); // HAVE_FUTURE_DATA
      expect(shouldAutoplayOnBufferReady(false, true, 4)).toBe(true); // HAVE_ENOUGH_DATA
    });

    it("returns false if user explicitly paused", () => {
      expect(shouldAutoplayOnBufferReady(true, true, true)).toBe(false);
      expect(shouldAutoplayOnBufferReady(true, true, 4)).toBe(false);
    });

    it("returns false if video is already playing", () => {
      expect(shouldAutoplayOnBufferReady(false, false, true)).toBe(false);
    });

    it("returns false if buffer is not ready yet", () => {
      expect(shouldAutoplayOnBufferReady(false, true, false)).toBe(false);
      expect(shouldAutoplayOnBufferReady(false, true, 1)).toBe(false); // HAVE_METADATA only
      expect(shouldAutoplayOnBufferReady(false, true, 2)).toBe(false); // HAVE_CURRENT_DATA only
    });
  });

  describe("buildFolderVideoPlaylist", () => {
    const rawItems = [
      { id: "f1", name: "Movies", type: "folder" },
      { id: "v1", name: "Video1.mp4", size: 1048576, type: "file" },
      { id: "a1", name: "Audio1.mp3", size: 524288, type: "file" },
      { id: "v2", name: "Video2.mkv", size: 2097152, type: "file", file_path: "/Movies/Video2.mkv" },
      { id: "v3", name: "CloudVideo.webm", size: 4194304, is_cloud: true, cloud_account_id: "acc_1", cloud_file_id: "c_99" },
    ];

    it("filters to video items and formats tracks correctly", () => {
      const getCloudStreamUrl = (acc, fileId) => `https://cloud.stream/${acc}/${fileId}`;
      const playlist = buildFolderVideoPlaylist(rawItems, {
        baseUrl: "http://api.local",
        tokenParam: "?token=abc",
        sep: "&",
        getCloudStreamUrl,
      });

      expect(playlist).toHaveLength(3);
      expect(playlist[0].name).toBe("Video1.mp4");
      expect(playlist[0].fileType).toBe("video");
      expect(playlist[0].url).toBe("http://api.local/dl/Video1.mp4?token=abc&inline=1&file_id=v1");

      expect(playlist[1].name).toBe("Video2.mkv");
      expect(playlist[1].url).toContain("&path=%2FMovies%2FVideo2.mkv");

      expect(playlist[2].name).toBe("CloudVideo.webm");
      expect(playlist[2].url).toBe("https://cloud.stream/acc_1/c_99");
    });

    it("returns empty array for non-array items", () => {
      expect(buildFolderVideoPlaylist(null)).toEqual([]);
      expect(buildFolderVideoPlaylist(undefined)).toEqual([]);
    });
  });
});

