import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { explorerUrl, pathFromUrl, sameLocation, viewFromPathname } from "../lib/explorerRoutes";

/**
 * Keeps the Files location (folder path, section filter, Drive breadcrumbs) and the browser
 * address in step through react-router:
 * - moving to another folder adds a history entry, so Back/Forward walk through folders;
 * - Back/Forward (or any address change) restores the location saved with that entry;
 * - opening a page (Settings, Storage…) leaves the Files location alone until Files is shown again.
 *
 * Returns { view, showFiles }: the page the address shows, and a function that switches to Files.
 */
export function useExplorerHistory({ currentPath, selectedFilter, cloudBreadcrumbs, setCurrentPath, setSelectedFilter, setCloudBreadcrumbs }) {
    const location = useLocation();
    const navigate = useNavigate();
    const view = viewFromPathname(location.pathname);
    const wantFiles = useRef(false);
    const [showFilesRequest, setShowFilesRequest] = useState(0);
    const here = {
        path: currentPath,
        filter: selectedFilter,
        crumbs: selectedFilter.startsWith("cloud:") ? cloudBreadcrumbs : null,
    };
    const hereRef = useRef(here);
    hereRef.current = here;

    const showFiles = useCallback(() => {
        wantFiles.current = true;
        setShowFilesRequest((n) => n + 1);
    }, []);

    // The Files location changed (or Files was asked for): record it in the address
    useEffect(() => {
        if (view !== "files" && !wantFiles.current)
            return;
        wantFiles.current = false;
        const saved = location.state?.explorer;
        if (view === "files" && sameLocation(saved, here))
            return;
        // Drive folders have no address of their own; their history entry carries the location
        const url = here.filter.startsWith("cloud:") ? "/" : explorerUrl(here.path);
        navigate(url, { state: { explorer: here }, replace: view === "files" && !saved });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the location itself changes
    }, [currentPath, selectedFilter, cloudBreadcrumbs, showFilesRequest]);

    // The address changed (Back/Forward, a link): restore the Files location it carries
    useEffect(() => {
        if (view !== "files")
            return;
        const saved = location.state?.explorer || { path: pathFromUrl(location.pathname), filter: null, crumbs: null };
        const now = hereRef.current;
        if (sameLocation(saved, now))
            return;
        if (JSON.stringify(saved.path) !== JSON.stringify(now.path))
            setCurrentPath(saved.path);
        if (saved.filter && saved.filter !== now.filter)
            setSelectedFilter(saved.filter);
        if (saved.crumbs)
            setCloudBreadcrumbs(saved.crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on each new history entry
    }, [location.key]);

    return { view, showFiles };
}
