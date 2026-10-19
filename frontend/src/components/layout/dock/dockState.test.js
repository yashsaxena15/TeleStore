import { describe, it, expect } from "vitest";
import { getDockState } from "./dockState";

describe("getDockState", () => {
  it("stays hidden when nothing is playing, uploading or transferring", () => {
    expect(getDockState({}, "/").visible).toBe(false);
  });

  it("shows for a docked video or audio track", () => {
    expect(getDockState({ video: true }, "/").visible).toBe(true);
    expect(getDockState({ audio: true }, "/").hasMedia).toBe(true);
  });

  it("shows for active transfers on file pages", () => {
    const state = getDockState({ transfers: true }, "/Home/Movies");
    expect(state.visible).toBe(true);
    expect(state.showTransfers).toBe(true);
    expect(state.hasMedia).toBe(false);
  });

  it("hides the transfers summary on the Transfers page", () => {
    const state = getDockState({ transfers: true }, "/transfers");
    expect(state.showTransfers).toBe(false);
    expect(state.visible).toBe(false);
  });

  it("keeps playback in the dock on the Transfers page", () => {
    const state = getDockState({ transfers: true, audio: true }, "/transfers");
    expect(state.visible).toBe(true);
    expect(state.showTransfers).toBe(false);
  });

  it("shows for a Google Drive upload panel", () => {
    expect(getDockState({ upload: true }, "/settings").visible).toBe(true);
  });
});
