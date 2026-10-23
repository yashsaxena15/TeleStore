import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useFiles } from "@/features/explorer/hooks/useFiles";
import { useFileOperations } from "@/features/explorer/hooks/useFileOperations";
import { toast } from "sonner";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { Dock } from "@/components/layout/dock/Dock";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ErrorBoundary } from "@/components/feedback/ErrorBoundary";
import authService from "@/features/auth/authService";
import { TopBar } from "@/components/layout/TopBar";
import { FileGrid } from "./FileGrid";
import { FilePagination } from "./FilePagination";
import { DeleteDialog } from "@/features/explorer/dialogs/DeleteDialog";
import { NewFolderDialog } from "@/features/explorer/dialogs/NewFolderDialog";
import { api } from "@/lib/api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, } from "@/components/ui/alert-dialog";
import logger from "@/lib/logger";
import { SectionStatus } from "./SectionStatus";
import { getSection } from "./lib/explorerItems";
import { useIsMobile } from "@/hooks/use-mobile";
import { settingsUrl } from "@/features/settings/settingsTabs";
import { pathFromUrl, segmentsFromFilePath, viewFromPathname } from "./lib/explorerRoutes";
import { countByType, filterAndSortItems, mapCloudItems } from "./lib/itemFilters";
import { createClipboardActions } from "./actions/clipboardActions";
import { createBatchActions } from "./actions/batchActions";
import { useVaultSession } from "./hooks/useVaultSession";
import { createItemActions } from "./actions/itemActions";
import { useExplorerHistory } from "./hooks/useExplorerHistory";

// Pages fade in (same feel as before, without a motion library)
const PAGE_CLASS = "flex-1 flex flex-col h-full min-h-0 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300";

// Page panels are split into their own chunks and load when first shown
// Pages and dialogs that are not needed on first load arrive when they are opened
const Transfers = lazy(() => import("@/features/transfers/Transfers"));
const ConnectCloudModal = lazy(() => import("@/features/cloud/ConnectCloudModal").then((m) => ({ default: m.ConnectCloudModal })));
const FolderDownloadDialog = lazy(() => import("@/features/explorer/dialogs/FolderDownloadDialog").then((m) => ({ default: m.FolderDownloadDialog })));
const WebDAVMountDialog = lazy(() => import("@/features/cloud/WebDAVMountDialog").then((m) => ({ default: m.WebDAVMountDialog })));
const VaultModal = lazy(() => import("@/features/vault/VaultModal").then((m) => ({ default: m.VaultModal })));
const RemoteDownloadDialog = lazy(() => import("@/features/cloud/RemoteDownloadDialog").then((m) => ({ default: m.RemoteDownloadDialog })));
const MediaDownloadDialog = lazy(() => import("@/features/cloud/MediaDownloadDialog").then((m) => ({ default: m.MediaDownloadDialog })));
const InstagramImportDialog = lazy(() => import("@/features/cloud/InstagramImportDialog").then((m) => ({ default: m.InstagramImportDialog })));
// Mounts a lazy dialog only while it is open
const WhenOpen = ({ open, children }) => (open ? <Suspense fallback={null}>{children}</Suspense> : null);
const SettingsContent = lazy(() => import("@/features/settings/SettingsContent").then((m) => ({ default: m.SettingsContent })));
const StorageAnalyticsContent = lazy(() => import("@/features/storage/StorageAnalyticsContent").then((m) => ({ default: m.StorageAnalyticsContent })));
const PanelLoading = () => (<div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">Loading…</div>);
export const FileExplorer = () => {
    const location = useLocation();
    const navigate = useNavigate(); // Add navigate hook
    // Initialize currentPath from URL or localStorage or default to ["Home"]
    const [currentPath, setCurrentPath] = useState(() => {
        // A folder address wins (a saved history entry first); page addresses like /settings are not folders
        if (location.state?.explorer?.path)
            return location.state.explorer.path;
        if (location.pathname !== "/" && viewFromPathname(location.pathname) === "files")
            return pathFromUrl(location.pathname);
        // Fallback to localStorage or default
        const savedPath = localStorage.getItem('fileExplorerPath');
        if (savedPath) {
            try {
                const parsedPath = JSON.parse(savedPath);
                if (Array.isArray(parsedPath)) {
                    return parsedPath;
                }
            }
            catch (e) {
                logger.error('Failed to parse saved path', e);
            }
        }
        return ["Home"];
    });
    const isMobile = useIsMobile();
    // Details pane: remembered on desktop; on phones it is a sheet opened per item
    const [detailsPinned, setDetailsPinned] = useState(() => {
        try {
            return localStorage.getItem("telestore.detailsPane") === "1";
        }
        catch {
            return false;
        }
    });
    const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
    const detailsOpen = isMobile ? detailsSheetOpen : detailsPinned;
    const setDetailsOpen = (open) => {
        if (isMobile) {
            setDetailsSheetOpen(open);
            return;
        }
        setDetailsPinned(open);
        try {
            localStorage.setItem("telestore.detailsPane", open ? "1" : "0");
        }
        catch {
            // storage unavailable; the pane still toggles for this session
        }
    };
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem("telestore.sidebarCollapsed") === "1";
        }
        catch {
            return false;
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem("telestore.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
        }
        catch {
            // Storage blocked (private mode): collapse state just isn't remembered
        }
    }, [sidebarCollapsed]);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [connectDriveOpen, setConnectDriveOpen] = useState(false);
    // Upload requests from the New menu / command palette; FileGrid opens the file picker for each new nonce
    const [uploadRequest, setUploadRequest] = useState(null);
    const [emptyTrashDialogOpen, setEmptyTrashDialogOpen] = useState(false); // State to confirm empty trash
    const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState("grid");
    const [selectedFilter, setSelectedFilter] = useState("all");
    const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
    const [deleteDialog, setDeleteDialog] = useState(null);
    const [renamingItem, setRenamingItem] = useState(null);
    const [folderDownloadInfo, setFolderDownloadInfo] = useState(null);
    const [showWebDAVDialog, setShowWebDAVDialog] = useState(false);
    const [showVaultModal, setShowVaultModal] = useState(false);
    const [userEmail, setUserEmail] = useState("");
    const [username, setUsername] = useState("");
    const [remoteDownloadOpen, setRemoteDownloadOpen] = useState(false);
    const [instagramOpen, setInstagramOpen] = useState(false);
    const [mediaOpen, setMediaOpen] = useState(false);
    // The signed-in user's email (vault setup) and username (WebDAV details)
    useEffect(() => {
        api.fetchUserProfile().then(p => {
            if (p && p.email)
                setUserEmail(p.email);
            if (p && p.username)
                setUsername(p.username);
        }).catch(() => { });
    }, []);
    // Listen for showWebDAVMount custom events
    useEffect(() => {
        const handleOpenWebDAV = () => setShowWebDAVDialog(true);
        window.addEventListener('showWebDAVMount', handleOpenWebDAV);
        return () => window.removeEventListener('showWebDAVMount', handleOpenWebDAV);
    }, []);
    // Save currentPath to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('fileExplorerPath', JSON.stringify(currentPath));
    }, [currentPath]);
    // Log when the component mounts
    useEffect(() => {
        logger.info("FileExplorer component mounted", { currentPath, location: window.location.pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- log once on mount
    }, []);
    // Refresh files when component mounts and user is at Home path
    useEffect(() => {
        if (currentPath.length === 1 && currentPath[0] === "Home") {
            // Trigger a refresh to ensure default folders are visible
            refetch();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh once on mount
    }, []);
    // Current folder name (last part of currentPath)
    const currentFolder = currentPath[currentPath.length - 1] || "Home";
    // Cloud Storage Mode
    const isCloudMode = selectedFilter.startsWith("cloud:");
    const cloudParts = isCloudMode ? selectedFilter.split(":") : [];
    const cloudAccountId = cloudParts[1] || "";
    const cloudFolderId = cloudParts[2] || "root";
    const [cloudBreadcrumbs, setCloudBreadcrumbs] = useState([
        { id: "root", name: "Google Drive" }
    ]);
    const { view, showFiles } = useExplorerHistory({ currentPath, selectedFilter, cloudBreadcrumbs, setCurrentPath, setSelectedFilter, setCloudBreadcrumbs });
    const isTrashMode = selectedFilter === "trash" || currentFolder === "Trash";
    const isEffectiveTrashMode = isTrashMode || (isCloudMode && cloudFolderId === "trash");
    const isStarredMode = selectedFilter === "starred" || currentFolder === "Starred";
    const isInboxMode = selectedFilter === "inbox" || currentFolder === "Telegram Inbox";
    const isVaultMode = selectedFilter === "vault" || currentFolder === "Private Vault" || currentPath[0] === "Private Vault" || currentPath[0] === "Vault";
    const { isVaultUnlocked, setIsVaultUnlocked, autoLockMinutes: vaultAutoLockMinutes } = useVaultSession({ isVaultMode, onAutoLocked: () => handleFilterChangeRef.current?.("all") });
    // Helper to ensure clean API path even if a virtual segment exists in currentPath
    const getCleanPath = (segments) => {
        // If segments contain "Starred" but we are not at root Starred view, strip "Starred"
        const cleaned = segments.filter((seg, idx) => !(seg === "Starred" && idx === 1 && segments.length > 2));
        if (cleaned.length === 1 && cleaned[0] === "Home")
            return "/Home";
        return `/${cleaned.join('/')}`;
    };
    // Convert currentPath to API path format
    const currentApiPath = isTrashMode
        ? "/trash"
        : isStarredMode && currentFolder === "Starred"
            ? "/starred"
            : isInboxMode && currentFolder === "Telegram Inbox"
                ? "/inbox"
                : isVaultMode
                    ? (currentPath.length > 1 ? `/Vault/${currentPath.slice(1).join('/')}` : "/Vault")
                    : isCloudMode
                        ? `/cloud/${cloudAccountId}`
                        : currentPath.length === 1 && currentPath[0] === "Home"
                            ? "/Home"
                            : getCleanPath(currentPath);
    // Sort state
    const [sortField, setSortField] = useState("name");
    const [sortOrder, setSortOrder] = useState("asc");
    const [foldersFirst, setFoldersFirst] = useState(true);
    // Pagination state
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    // Filter state
    const [typeFilter, setTypeFilter] = useState("all");
    const [sizeFilter, setSizeFilter] = useState("all");
    const [dateFilter, setDateFilter] = useState("all");
    // Reset page to 1 when navigating folders or changing search/filters
    useEffect(() => {
        setPage(1);
    }, [currentApiPath, searchQuery, typeFilter, sizeFilter, dateFilter]);
    const isAllPages = pageSize === -1;
    const { files, pagination, isLoading: isFilesLoading, isFetching: isFilesFetching, isError, error, refetch: refetchFiles } = useFiles(isCloudMode ? undefined : currentApiPath, isAllPages ? undefined : page, isAllPages ? undefined : pageSize, sortField, sortOrder);
    // Cloud Accounts Query
    const cloudAccountsQuery = useQuery({
        queryKey: ['cloudAccounts'],
        queryFn: api.fetchCloudAccounts,
        staleTime: 60000,
    });
    // Cloud Files Query
    const cloudQuery = useQuery({
        queryKey: ['cloudFiles', cloudAccountId, cloudFolderId, page, pageSize, sortField, sortOrder, searchQuery],
        queryFn: async () => {
            return await api.fetchCloudFiles(cloudAccountId, cloudFolderId, pageSize === -1 ? 200 : pageSize, undefined, searchQuery || undefined, sortField, sortOrder);
        },
        enabled: isCloudMode && Boolean(cloudAccountId),
    });
    const isLoading = isCloudMode ? cloudQuery.isLoading : isFilesLoading;
    const isFetching = isCloudMode ? cloudQuery.isFetching : isFilesFetching;
    const refetch = isCloudMode ? () => cloudQuery.refetch() : refetchFiles;
    useEffect(() => {
        if (isCloudMode && cloudFolderId === "root") {
            const accName = cloudQuery.data?.account_name || "Google Drive";
            setCloudBreadcrumbs([{ id: "root", name: accName }]);
            setCurrentPath([accName]);
        }
    }, [isCloudMode, cloudAccountId, cloudFolderId, cloudQuery.data?.account_name]);
    const cloudItems = useMemo(() => {
        return isCloudMode ? mapCloudItems(cloudQuery.data, cloudAccountId) : [];
    }, [isCloudMode, cloudQuery.data, cloudAccountId]);
    const effectivePagination = useMemo(() => {
        if (isCloudMode) {
            const total = cloudItems.length;
            return {
                page: 1,
                page_size: total,
                total_items: total,
                total_pages: 1,
                has_next: Boolean(cloudQuery.data?.nextPageToken),
                has_prev: false,
                start_index: total > 0 ? 1 : 0,
                end_index: total,
            };
        }
        if (pagination)
            return pagination;
        if (files && files.length > 0) {
            return {
                page: 1,
                page_size: files.length,
                total_items: files.length,
                total_pages: 1,
                has_next: false,
                has_prev: false,
                start_index: 1,
                end_index: files.length,
            };
        }
        return undefined;
    }, [isCloudMode, cloudItems, cloudQuery.data, pagination, files]);
    const { clipboard, cutItems, copyItem, cutItem, clearClipboard, hasClipboard, isClipboardPasted, pasteItem, moveItem } = useFileOperations();
    // Base items in current folder/section
    const baseItems = useMemo(() => {
        if (isCloudMode)
            return cloudItems;
        if (!Array.isArray(files))
            return [];
        if (currentFolder === "Home" && selectedFilter === "all") {
            return files.filter((f) => f.type === "folder" || f.file_path === "/Home" || f.file_path === "/");
        }
        return files;
    }, [isCloudMode, cloudItems, files, currentFolder, selectedFilter]);
    // Compute category counts for quick filter chips
    const typeCounts = useMemo(() => {
        return countByType(baseItems);
    }, [baseItems]);
    // Filtered and sorted items
    const filteredItems = useMemo(() => {
        return filterAndSortItems(baseItems, { searchQuery, typeFilter, sizeFilter, dateFilter, sortField, sortOrder, foldersFirst });
    }, [baseItems, searchQuery, typeFilter, sizeFilter, dateFilter, sortField, sortOrder, foldersFirst]);
    const getFolderPathSegments = (folder) => {
        const parent = (folder.file_path || "/Home").trim();
        // Vault check
        if (parent === "/Vault" || parent === "Vault") {
            return ["Private Vault", folder.name];
        }
        if (parent.startsWith("/Vault/") || parent.startsWith("Vault/")) {
            const sub = parent.replace(/^\/?Vault\/?/, "").split("/").filter(Boolean);
            return ["Private Vault", ...sub, folder.name];
        }
        // Telegram Inbox check
        if (parent === "/Telegram Inbox" || parent === "Telegram Inbox") {
            return ["Home", "Telegram Inbox", folder.name];
        }
        if (parent.startsWith("/Telegram Inbox/") || parent.startsWith("Telegram Inbox/")) {
            const sub = parent.replace(/^\/?Telegram Inbox\/?/, "").split("/").filter(Boolean);
            return ["Home", "Telegram Inbox", ...sub, folder.name];
        }
        // Root Home check
        if (parent === "/" || parent === "/Home" || parent === "Home" || parent === "") {
            return ["Home", folder.name];
        }
        // Nested under Home (e.g. "/Home/My Drive/Multimedia")
        const cleaned = parent.replace(/^\/?Home\/?/, "").split("/").filter(Boolean);
        return ["Home", ...cleaned, folder.name];
    };
    const handleNavigate = (folderName, folderItem) => {
        if (isCloudMode) {
            const item = folderItem || cloudItems.find(f => f.name === folderName);
            if (item && item.type === "folder") {
                const nextCrumbs = [...cloudBreadcrumbs, { id: item.id, name: item.name }];
                setCloudBreadcrumbs(nextCrumbs);
                setCurrentPath(nextCrumbs.map(b => b.name));
                setSelectedFilter(`cloud:${cloudAccountId}:${item.id}`);
                setPage(1);
                setSearchQuery("");
                setTypeFilter("all");
                setSizeFilter("all");
                setDateFilter("all");
                return;
            }
        }
        // Locate the folder item either passed directly or from the current files list
        const item = folderItem || files.find(f => f.type === "folder" && f.name === folderName);
        if (item && item.type === "folder") {
            const newPath = getFolderPathSegments(item);
            setCurrentPath(newPath);
            // Clear search query & filters so child items aren't filtered out
            setSearchQuery("");
            setTypeFilter("all");
            setSizeFilter("all");
            setDateFilter("all");
            if (newPath[0] === "Private Vault" || newPath[0] === "Vault") {
                setSelectedFilter("vault");
            }
            else if (newPath.length >= 2 && newPath[1] === "Telegram Inbox") {
                setSelectedFilter("inbox");
            }
            else {
                setSelectedFilter("all");
            }
            return;
        }
        // Fallback if item wasn't in current files list
        setCurrentPath([...currentPath, folderName]);
        if (!isVaultMode) {
            setSelectedFilter("all");
        }
    };
    const handleBreadcrumbClick = (index) => {
        if (isCloudMode) {
            const nextCrumbs = cloudBreadcrumbs.slice(0, index + 1);
            const target = nextCrumbs[nextCrumbs.length - 1];
            setCloudBreadcrumbs(nextCrumbs);
            setCurrentPath(nextCrumbs.map(b => b.name));
            setSelectedFilter(`cloud:${cloudAccountId}:${target ? target.id : "root"}`);
            setPage(1);
            setSearchQuery("");
            return;
        }
        if (index === 0) {
            if (isVaultMode) {
                setCurrentPath(["Private Vault"]);
            }
            else {
                // Same as Home in the sidebar: leave Trash, Starred or Inbox too. Changing only the
                // folder left the filter behind, and the address and the view kept undoing each other.
                handleFilterChange("all");
            }
        }
        else {
            setCurrentPath(currentPath.slice(0, index + 1));
        }
    };
    const { handleCopy, handleCut, handlePaste } = createClipboardActions({ isInboxMode, isEffectiveTrashMode, isCloudMode, currentApiPath, currentPath, currentFolder, cloudAccountId, cloudFolderId, refetch, clipboard, copyItem, cutItem, clearClipboard, pasteItem });
    const handleVaultUnlocked = () => {
        setIsVaultUnlocked(true);
        setSelectedFilter("vault");
        setCurrentPath(["Private Vault"]);
        refetch();
    };
    const handleLockVault = async () => {
        try {
            await api.lockVault();
        }
        finally {
            setIsVaultUnlocked(false);
            handleFilterChange("all");
            toast.success("Vault Locked");
        }
    };
    const handleMoveToVault = async (item) => {
        if (!item?.id)
            return;
        try {
            await api.moveIntoVault(item.id);
            toast.success(`Moved "${item.name}" to Private Vault`);
            refetch();
        }
        catch (err) {
            toast.error(err.message || "Failed to move item to Vault");
        }
    };
    const handleMoveToHome = async (item) => {
        if (!item?.id)
            return;
        try {
            await api.moveOutOfVault(item.id);
            toast.success(`Moved "${item.name}" to Home`);
            refetch();
        }
        catch (err) {
            toast.error(err.message || "Failed to move item out of Vault");
        }
    };
    // Long-lived listeners below call the latest handleFilterChange through this ref,
    // so they never use values (e.g. cloud accounts) captured on an earlier render.
    const handleFilterChangeRef = useRef(null);
    const handleFilterChange = (filter) => {
        if (filter.startsWith("cloud:")) {
            const parts = filter.split(":");
            const accId = parts[1] || "";
            const fId = parts[2] || "root";
            const acc = cloudAccountsQuery.data?.accounts?.find(a => a.id === accId);
            const accName = acc?.account_name || "Google Drive";
            setCloudBreadcrumbs([{ id: fId, name: accName }]);
            setCurrentPath([accName]);
            setSelectedFilter(filter);
            setTypeFilter("all");
            setSizeFilter("all");
            setDateFilter("all");
            setSortField("name");
            setSortOrder("asc");
            setFoldersFirst(true);
            setPage(1);
            return;
        }
        if (filter === "vault") {
            if (!isVaultUnlocked) {
                setShowVaultModal(true);
                return;
            }
            setCurrentPath(["Private Vault"]);
            setSelectedFilter("vault");
            setTypeFilter("all");
            setSizeFilter("all");
            setDateFilter("all");
            setSortField("name");
            setSortOrder("asc");
            setFoldersFirst(true);
            return;
        }
        // Map filter to folder name
        const folderMap = {
            all: "Home",
            inbox: "Telegram Inbox",
            starred: "Starred",
            trash: "Trash",
        };
        const folderName = folderMap[filter] || "Home";
        // For virtual folders, we need to include the full path
        if (folderName !== "Home") {
            setCurrentPath(["Home", folderName]);
        }
        else {
            setCurrentPath([folderName]);
        }
        setSelectedFilter(filter);
        // Reset filters on section change
        setTypeFilter("all");
        setSizeFilter("all");
        setDateFilter("all");
        // Set intelligent default sort for each section
        if (filter === "inbox") {
            setSortField("date");
            setSortOrder("desc"); // Newest forwarded files first
            setFoldersFirst(false);
        }
        else if (filter === "trash") {
            setSortField("date");
            setSortOrder("desc"); // Recently trashed files first
            setFoldersFirst(true);
        }
        else if (filter === "starred") {
            setSortField("date");
            setSortOrder("desc");
            setFoldersFirst(true);
        }
        else {
            setSortField("name");
            setSortOrder("asc");
            setFoldersFirst(true);
        }
    };
    handleFilterChangeRef.current = handleFilterChange;
    const batchActions = createBatchActions({ isCloudMode, cloudAccountId, currentApiPath, isTrashMode: isEffectiveTrashMode, refetch, moveItem });
    const { handleSidebarDrop, handleNewFolder, handleDelete, handleRename, handleMove, handleDownloadFolderPart, handleDownloadAllFolderParts, handleDownload, confirmRename, confirmDelete, handleToggleStar, handleRestoreItem, handleEmptyTrash } = createItemActions({ cloudAccountId, cloudFolderId, currentApiPath, currentFolder, currentPath, deleteDialog, isCloudMode, isEffectiveTrashMode, isInboxMode, isTrashMode, moveItem, refetch, renamingItem, setDeleteDialog, setEmptyTrashDialogOpen, setFolderDownloadInfo, setIsEmptyingTrash, setNewFolderDialogOpen, setRenamingItem });
    const cancelDelete = () => {
        setDeleteDialog(null);
    };
    // Determine the selected filter based on the current path
    useEffect(() => {
        if (selectedFilter.startsWith("cloud:")) {
            return;
        }
        // Map folder name to filter
        const folderMap = {
            "Home": "all",
            "Telegram Inbox": "inbox",
            "Starred": "starred",
            "Trash": "trash",
            "Private Vault": "vault",
            "Vault": "vault",
        };
        // Check if we are inside Private Vault (root or any subfolder)
        const rootFolder = currentPath[0];
        const isInsideVault = rootFolder === "Private Vault" || rootFolder === "Vault";
        // If we're in a default folder, select the corresponding filter
        const currentFolderName = currentPath[currentPath.length - 1];
        const filter = isInsideVault ? "vault" : (folderMap[currentFolderName] || "all");
        // Only update if it's different to prevent infinite loops
        if (selectedFilter !== filter) {
            setSelectedFilter(filter);
        }
    }, [currentPath, selectedFilter]);
    // Opens Files at a stored folder path (Storage "Show in folder", other pages' links)
    const openFolderPath = (folderPath) => {
        const target = segmentsFromFilePath(folderPath);
        setCurrentPath(target);
        setSelectedFilter(target[0] === "Private Vault" ? "vault" : (target.length >= 2 && target[1] === "Telegram Inbox" ? "inbox" : "all"));
        setTypeFilter("all");
        setSizeFilter("all");
        setDateFilter("all");
        setSearchQuery("");
        showFiles();
    };
    const openFolderPathRef = useRef(null);
    openFolderPathRef.current = openFolderPath;
    useEffect(() => {
        const handleCategoryChange = (e) => {
            const detail = e.detail || {};
            if (detail.folderPath) {
                openFolderPathRef.current(detail.folderPath);
            }
            else if (detail.filter || detail.typeFilter) {
                handleFilterChangeRef.current(detail.filter || "all");
                if (detail.typeFilter)
                    setTypeFilter(detail.typeFilter);
                showFiles();
            }
        };
        window.addEventListener('changeCategory', handleCategoryChange);
        return () => window.removeEventListener('changeCategory', handleCategoryChange);
    }, [showFiles]);
    // The page comes from the address alone (see useExplorerHistory); Profile and Users are Settings tabs
    const activeView = view;
    const handleNavigateView = (target, filter) => {
        if (target === 'profile' || target === 'settings' || target === 'users') {
            // For settings the second argument is the tab to open
            navigate(settingsUrl(target === 'settings' ? filter : target));
        }
        else if (target === 'storage') {
            navigate('/storage');
        }
        else if (target === 'transfers' || target === 'downloads') {
            navigate('/transfers');
        }
        else {
            if (filter)
                handleFilterChange(filter);
            showFiles();
        }
    };
    // Places where nothing can be added (uploads, new folders); returns why, or null when allowed
    const newItemBlockedReason = () => {
        if (isInboxMode)
            return "Telegram Inbox only holds files that arrive from Telegram. Open Home or a folder to add files.";
        if (isEffectiveTrashMode)
            return "You can't add files to Trash. Open Home or a folder first.";
        if (selectedFilter === "starred" || currentFolder === "Starred")
            return "Starred only lists starred items. Open Home or a folder to add files.";
        if (isCloudMode && (!cloudFolderId || ["root", "google_drive", "trash", "starred", "shared_with_me"].includes(cloudFolderId)))
            return "Open My Drive, or a folder inside it, to add files.";
        return null;
    };
    // Where server downloads (Instagram, video) save by default: the place that is open now
    const saveDefaultDestination = () => {
        const realDriveFolder = !["root", "google_drive", "starred", "trash", "shared_with_me"].includes(cloudFolderId);
        if (isCloudMode && cloudAccountId && realDriveFolder)
            return { kind: "gdrive", accountId: cloudAccountId, folderId: cloudFolderId, folderName: cloudBreadcrumbs[cloudBreadcrumbs.length - 1]?.name || "My Drive" };
        if (isVaultMode)
            return { kind: "vault", path: "/Vault" };
        return { kind: "home", path: currentApiPath.startsWith("/Home") ? currentApiPath : "/Home" };
    };
    // Actions from the New menu, the phone + button, the account menu and the command palette
    const runShellAction = (id) => {
        switch (id) {
            case "upload-files":
            case "upload-folder":
            case "new-folder": {
                const reason = activeView === "files" ? newItemBlockedReason() : null;
                if (reason) {
                    toast.error(reason);
                    return;
                }
                if (activeView !== "files")
                    handleNavigateView("files");
                if (id === "new-folder")
                    setNewFolderDialogOpen(true);
                else
                    setUploadRequest({ kind: id === "upload-folder" ? "folder" : "files", nonce: Date.now() });
                return;
            }
            case "remote-leech":
                setRemoteDownloadOpen(true);
                return;
            case "instagram-import":
                setInstagramOpen(true);
                return;
            case "media-download":
                setMediaOpen(true);
                return;
            case "connect-drive":
                setConnectDriveOpen(true);
                return;
            case "webdav":
                setShowWebDAVDialog(true);
                return;
            case "refresh":
                if (activeView !== "files")
                    handleNavigateView("files");
                refetch();
                return;
            case "logout":
                Promise.resolve(authService.logout()).catch(() => { }).finally(() => navigate("/login"));
                return;
            default:
                logger.warn("Unknown shell action", id);
        }
    };
    return (<div className="flex h-full w-full bg-background text-foreground select-none min-h-0 overflow-hidden">
      <Sidebar selectedFilter={selectedFilter} activeView={activeView} onNavigateView={handleNavigateView} onDrop={handleSidebarDrop} onAction={runShellAction} onOpenPalette={() => setPaletteOpen(true)} isCollapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(prev => !prev)} isVaultUnlocked={isVaultUnlocked}/>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <ErrorBoundary name="This page" key={activeView}>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {view === "settings" ? (<div key="settings" className={PAGE_CLASS}>
            <Suspense fallback={<PanelLoading />}>
              <SettingsContent onOpenDrive={(accountId) => handleNavigateView("files", `cloud:${accountId}:root`)} onOpenVault={() => handleNavigateView("files", "vault")} onLogout={() => runShellAction("logout")}/>
            </Suspense>
          </div>) : view === "storage" ? (<div key="storage" className={PAGE_CLASS}>
            <Suspense fallback={<PanelLoading />}>
              <StorageAnalyticsContent onOpenTrash={() => handleNavigateView("files", "trash")} onOpenCategory={(categoryKey) => {
                handleFilterChange("all");
                setTypeFilter(categoryKey);
                showFiles();
            }} onShowInFolder={openFolderPath}/>
            </Suspense>
          </div>) : view === "transfers" ? (<div key="transfers" className={PAGE_CLASS}>
            <Suspense fallback={<PanelLoading />}>
              <Transfers onNewTransfer={runShellAction}/>
            </Suspense>
          </div>) : (<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <TopBar currentPath={currentPath} searchQuery={searchQuery} viewMode={viewMode} onSearchChange={setSearchQuery} onViewModeChange={setViewMode} onBreadcrumbClick={handleBreadcrumbClick} sortField={sortField} sortOrder={sortOrder} foldersFirst={foldersFirst} onSortChange={(field, order) => {
                setSortField(field);
                setSortOrder(order);
                setPage(1);
            }} onFoldersFirstChange={setFoldersFirst} typeFilter={typeFilter} onTypeFilterChange={setTypeFilter} sizeFilter={sizeFilter} onSizeFilterChange={setSizeFilter} dateFilter={dateFilter} onDateFilterChange={setDateFilter} onResetFilters={() => {
                setTypeFilter("all");
                setSizeFilter("all");
                setDateFilter("all");
                setSearchQuery("");
                setPage(1);
            }} typeCounts={typeCounts} totalCount={effectivePagination?.total_items ?? baseItems.length} filteredCount={filteredItems.length} isInboxMode={isInboxMode} detailsOpen={detailsOpen} onDetailsToggle={() => setDetailsOpen(!detailsOpen)}/>

            <SectionStatus section={getSection({ isTrash: isEffectiveTrashMode, isVault: isVaultMode, isInbox: isInboxMode, isCloud: isCloudMode })} itemCount={filteredItems.length} driveName={cloudQuery.data?.account_name} driveEmail={cloudQuery.data?.account_email} onEmptyTrash={() => setEmptyTrashDialogOpen(true)} onLockVault={handleLockVault} vaultAutoLockMinutes={vaultAutoLockMinutes}/>

            <FileGrid items={filteredItems} viewMode={viewMode} onNavigate={handleNavigate} itemCount={filteredItems.length} onCopy={handleCopy} onCut={handleCut} onPaste={hasClipboard && !isClipboardPasted() ? handlePaste : undefined} onDelete={handleDelete} onRename={handleRename} isVaultMode={isVaultMode} onMoveToVault={handleMoveToVault} onMoveToHome={handleMoveToHome} onMove={handleMove} onDownload={handleDownload} renamingItem={renamingItem} onRenameConfirm={confirmRename} onRenameCancel={() => setRenamingItem(null)} currentFolder={currentFolder} currentPath={currentPath} currentApiPath={currentApiPath} onNewFolder={() => setNewFolderDialogOpen(true)} isLoading={isLoading} cutItem={clipboard?.operation === "cut" && !isClipboardPasted() ? clipboard.item : null} cutItems={clipboard?.operation === "cut" && !isClipboardPasted() ? cutItems : []} hasClipboard={hasClipboard} isClipboardPasted={isClipboardPasted()} onRefresh={refetch} isTrashMode={isEffectiveTrashMode} onRestoreItem={handleRestoreItem} onToggleStar={handleToggleStar} isCloudMode={isCloudMode} cloudAccountId={cloudAccountId} cloudFolderId={cloudFolderId} isInboxMode={isInboxMode} uploadRequest={uploadRequest} onUploadRequestHandled={() => setUploadRequest(null)} detailsOpen={detailsOpen} onDetailsOpenChange={setDetailsOpen} onBatch={batchActions}/>

            {/* Pagination Controls */}
            <FilePagination pagination={effectivePagination} currentPage={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setPage(1);
            }} isLoading={isFetching}/>

          </div>)}
      </div>
      </ErrorBoundary>
      <ErrorBoundary name="Dock" fallback="silent">
        <Dock />
      </ErrorBoundary>
      <MobileNav selectedFilter={selectedFilter} activeView={activeView} onNavigateView={handleNavigateView} onAction={runShellAction}/>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigateView={handleNavigateView} onAction={runShellAction}/>
      <WhenOpen open={connectDriveOpen}><ConnectCloudModal open={connectDriveOpen} onOpenChange={setConnectDriveOpen} onSuccess={() => window.dispatchEvent(new Event("cloudAccountsChanged"))}/></WhenOpen>

      <DeleteDialog open={!!deleteDialog} itemName={deleteDialog?.item.name || ""} itemType={deleteDialog?.item.type || "file"} onConfirm={confirmDelete} onCancel={cancelDelete} isTrashMode={isEffectiveTrashMode} isCloudMode={isCloudMode}/>

      {/* Empty Trash Confirmation Dialog */}
      <AlertDialog open={emptyTrashDialogOpen} onOpenChange={setEmptyTrashDialogOpen}>
        <AlertDialogContent className="bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-2xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete all items in the Trash? This will delete all files and messages from Telegram channels permanently. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isEmptyingTrash} onClick={() => setEmptyTrashDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction disabled={isEmptyingTrash} onClick={(e) => {
            e.preventDefault();
            handleEmptyTrash();
        }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isEmptyingTrash ? "Emptying..." : "Empty Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewFolderDialog open={newFolderDialogOpen} currentPath={currentApiPath} // Pass the full path, not just the folder name
     onClose={() => setNewFolderDialogOpen(false)} onConfirm={handleNewFolder}/>

      <WhenOpen open={!!folderDownloadInfo}><FolderDownloadDialog open={!!folderDownloadInfo} info={folderDownloadInfo} onClose={() => setFolderDownloadInfo(null)} onDownloadPart={handleDownloadFolderPart} onDownloadAll={handleDownloadAllFolderParts}/></WhenOpen>

      <WhenOpen open={showWebDAVDialog}><WebDAVMountDialog open={showWebDAVDialog} onOpenChange={setShowWebDAVDialog} username={username || undefined}/></WhenOpen>

      <WhenOpen open={showVaultModal}><VaultModal isOpen={showVaultModal} onClose={() => setShowVaultModal(false)} onSuccess={handleVaultUnlocked} userEmail={userEmail}/></WhenOpen>

      <WhenOpen open={remoteDownloadOpen}><RemoteDownloadDialog isOpen={remoteDownloadOpen} onClose={() => setRemoteDownloadOpen(false)} defaultPath={currentApiPath}/></WhenOpen>

      <WhenOpen open={mediaOpen}><MediaDownloadDialog open={mediaOpen} onOpenChange={setMediaOpen} userEmail={userEmail} defaultDestination={saveDefaultDestination()}/></WhenOpen>

      <WhenOpen open={instagramOpen}><InstagramImportDialog open={instagramOpen} onOpenChange={setInstagramOpen} userEmail={userEmail} defaultDestination={saveDefaultDestination()}/></WhenOpen>
    </div>);
};
