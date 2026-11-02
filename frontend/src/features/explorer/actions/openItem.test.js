// Opening is guarded against one double-click opening an item twice, but only for that item: on a
// fast machine a folder opens and a file in it can be double-clicked well within the guard's 250 ms.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: {}, getApiBaseUrl: () => "" }));
vi.mock("@/features/offline/offlineStore", () => ({ isSavedOffline: () => false, offlineUrlSync: () => null, prepareOfflineUrls: async () => {} }));

import { createOpenItem } from "./openItem";

const setup = () => {
    const onNavigate = vi.fn();
    const ref = { current: 0 };
    const open = createOpenItem({ items: [], lastOpenTimeRef: ref, onNavigate, setIsSelectionMode: vi.fn(), setLastSelectedIndex: vi.fn(), setSelectedItems: vi.fn() });
    return { open, onNavigate };
};

describe("opening an item", () => {
    it("opens it once for a double-click", () => {
        const { open, onNavigate } = setup();
        const music = { id: "m", name: "Music", type: "folder" };
        open(music);
        open(music);
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it("opens another item straight after", () => {
        const { open, onNavigate } = setup();
        open({ id: "m", name: "Music", type: "folder" });
        open({ id: "a", name: "Albums", type: "folder" });
        expect(onNavigate).toHaveBeenCalledTimes(2);
    });
});
