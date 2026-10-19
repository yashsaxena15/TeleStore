import { useCallback, useMemo, useState } from "react";
import { DockContext } from "./dockContextValue";

// The dock is one bar at the bottom of the app. Players and the upload panel render their
// compact UI into its slots (React portals), so their media elements and logic stay put.
export const DockProvider = ({ children }) => {
    const [mediaSlot, setMediaSlot] = useState(null);
    const [panelSlot, setPanelSlot] = useState(null);
    // Which parts currently want the dock: { video, audio, upload, transfers }
    const [presence, setPresence] = useState({});
    const setPresent = useCallback((key, on) => setPresence((prev) => (Boolean(prev[key]) === on ? prev : { ...prev, [key]: on })), []);
    const value = useMemo(() => ({ mediaSlot, setMediaSlot, panelSlot, setPanelSlot, presence, setPresent }), [mediaSlot, panelSlot, presence, setPresent]);
    return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
};
