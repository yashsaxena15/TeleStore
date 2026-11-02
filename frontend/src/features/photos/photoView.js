// The "Photos view" choices (layout and stacks), kept in this browser like the app keeps its own.
import { useCallback, useState } from "react";
import { LAYOUTS } from "./timeline";

const KEY = "photos_view";
const DEFAULT = { layout: "day", stackSimilar: false };

export function readPhotosView() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
        return {
            layout: LAYOUTS.includes(saved.layout) ? saved.layout : DEFAULT.layout,
            stackSimilar: Boolean(saved.stackSimilar),
        };
    } catch {
        return { ...DEFAULT };
    }
}

export function usePhotosView() {
    const [view, setView] = useState(readPhotosView);
    const update = useCallback((change) => setView((prev) => {
        const next = { ...prev, ...change };
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: this visit only */ }
        return next;
    }), []);
    return [view, update];
}
