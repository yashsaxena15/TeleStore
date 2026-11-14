// What this account may use (the owner turns compress & extract and the cloud features on or off in
// Settings › Users).
// One shared answer for every component, asked again when the window comes back into focus.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

let features = { archives: true, cloud: false, isOwner: false };
const listeners = new Set();
let loading = null;

const publish = (next) => {
    features = next;
    listeners.forEach((l) => l());
};

export const refreshFeatures = () => {
    loading ??= api.fetchFeatures()
        .then((data) => { if (data) publish({ archives: data.archives !== false, cloud: data.cloud === true, isOwner: Boolean(data.is_owner) }); })
        .finally(() => { loading = null; });
    return loading;
};

const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export function useFeatures() {
    useEffect(() => {
        refreshFeatures();
        window.addEventListener("focus", refreshFeatures);
        return () => window.removeEventListener("focus", refreshFeatures);
    }, []);
    return useSyncExternalStore(subscribe, () => features);
}

// For tests
export const setFeaturesForTest = (next) => publish({ ...features, ...next });
