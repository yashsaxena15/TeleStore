import { useContext, useEffect } from "react";
import { DockContext } from "./dockContextValue";

export const useDock = () => useContext(DockContext);

// Announce that `key` has something to show in the dock while `active` is true.
export const useDockPresence = (key, active) => {
    const dock = useDock();
    const setPresent = dock?.setPresent;
    useEffect(() => {
        if (!setPresent)
            return undefined;
        setPresent(key, Boolean(active));
        return () => setPresent(key, false);
    }, [setPresent, key, active]);
    return dock;
};
