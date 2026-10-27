// The bell's data: the server's notifications (GET /user/notifications), checked every 30 seconds
// while the tab is visible and again as soon as it becomes visible. New ones can also show as
// browser pop-ups. One poller runs (in FileExplorer); the bell and the phone sheet only read.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import logger from "@/lib/logger";
import { freshItems, markReadLocally, popupPlan, targetRoute } from "./notificationHelpers";

export const NOTIFICATIONS_KEY = ["notifications"];
const LAST_SEEN_KEY = "telestore.notifications.latest";
const POLL_MS = 30_000;
const EMPTY = { items: [], unread: 0, latest: null };

// Signed out (401) or a server without notifications (404): stop asking until the app opens again
let stopped = false;

const readLastSeen = () => {
    try {
        return localStorage.getItem(LAST_SEEN_KEY);
    }
    catch {
        return null;
    }
};
const writeLastSeen = (id) => {
    try {
        if (id) localStorage.setItem(LAST_SEEN_KEY, id);
    }
    catch {
        // storage blocked: pop-ups then rely on this tab's memory only
    }
};

async function fetchListing() {
    if (stopped) return EMPTY;
    try {
        const data = await api.fetchNotifications();
        return { items: Array.isArray(data?.items) ? data.items : [], unread: Number(data?.unread) || 0, latest: data?.latest ?? null };
    }
    catch (error) {
        if (error?.status === 401 || error?.status === 404) {
            stopped = true;
            return EMPTY;
        }
        throw error;
    }
}

export const popupsSupported = () => typeof Notification !== "undefined";

/** Reads the cached notifications (the poller fills them). */
export function useNotifications() {
    const { data } = useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: fetchListing, enabled: false });
    return data || EMPTY;
}

/** Marks some notifications (ids) or "all" as read: at once on screen, then on the server. */
export function useMarkNotificationsRead() {
    const queryClient = useQueryClient();
    return async (ids) => {
        const all = ids === "all";
        if (!all && !ids?.length) return;
        queryClient.setQueryData(NOTIFICATIONS_KEY, (d) => markReadLocally(d, all ? [] : ids, all));
        try {
            const res = await api.markNotificationsRead(ids);
            if (typeof res?.unread === "number")
                queryClient.setQueryData(NOTIFICATIONS_KEY, (d) => (d ? { ...d, unread: res.unread } : d));
        }
        catch (error) {
            logger.warn("Couldn't mark notifications as read", error?.message);
            queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        }
    };
}

/** Goes where a notification points: a page through onNavigateView, a folder through Files. */
export function followTarget(target, onNavigateView) {
    const route = targetRoute(target);
    if (!route) return;
    if (route.folderPath)
        window.dispatchEvent(new CustomEvent("changeCategory", { detail: { folderPath: route.folderPath } }));
    else
        onNavigateView(route.view);
}

/** The one poller. onOpen(notification) runs when a browser pop-up is clicked. */
export function useNotificationPoller(onOpen) {
    const onOpenRef = useRef(onOpen);
    onOpenRef.current = onOpen;
    const firstRef = useRef(true);
    const lastSeenRef = useRef(null);
    useEffect(() => {
        stopped = false;
    }, []);
    const { data } = useQuery({
        queryKey: NOTIFICATIONS_KEY,
        queryFn: fetchListing,
        // react-query pauses the interval while the tab is hidden and refetches when it is shown
        refetchInterval: () => (stopped ? false : POLL_MS),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: () => !stopped,
        staleTime: 0,
        retry: 1,
    });
    useEffect(() => {
        if (!data || stopped) return;
        const newest = data.items[0]?.id || null;
        // The first answer only sets where "new" starts; nothing pops up for old news
        if (firstRef.current) {
            firstRef.current = false;
            lastSeenRef.current = newest;
            writeLastSeen(newest);
            return;
        }
        // Another tab may already have shown these (it moved the stored id on)
        const fresh = freshItems(data.items, readLastSeen() || lastSeenRef.current);
        if (newest) {
            lastSeenRef.current = newest;
            writeLastSeen(newest);
        }
        if (!fresh.length || !popupsSupported() || Notification.permission !== "granted") return;
        for (const p of popupPlan(fresh)) {
            try {
                const pop = new Notification(p.title, { body: p.body, tag: p.id, icon: "/logo.png" });
                pop.onclick = () => {
                    window.focus();
                    pop.close();
                    if (p.id !== "summary") onOpenRef.current?.(p);
                };
            }
            catch (error) {
                // Some browsers (Android Chrome) only allow pop-ups from a service worker
                logger.warn("Couldn't show a pop-up", error?.message);
                return;
            }
        }
    }, [data]);
}
