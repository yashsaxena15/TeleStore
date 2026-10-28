import { useState, useEffect, useContext } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  HardDrive,
  Video,
  Music,
  Image as ImageIcon,
  FileText,
  Archive,
  File,
  Trash2,
  Star,
  RefreshCw,
  Folder,
  Files,
  Zap,
  ExternalLink,
  FolderOpen,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { api, getApiBaseUrl } from "@/lib/api";
import { isProtectedError, isProtectedItem, keptMessage, protectedReason } from "@/features/protection/protection";
import { formatBytes } from "@/lib/utils";
import { MediaPlayerContext } from "@/features/player/MediaPlayerContext";
import {
  buildCategoryRows,
  buildBarSegments,
  sortLargestFiles,
  getTrashSummary,
} from "./storageHelpers";

const getCategoryIcon = (key) => {
  switch (key) {
    case "video":
      return Video;
    case "audio":
      return Music;
    case "photo":
      return ImageIcon;
    case "document":
      return FileText;
    case "archive":
      return Archive;
    default:
      return File;
  }
};

export const StorageAnalyticsContent = ({
  onBack,
  onOpenTrash,
  onOpenCategory,
  onShowInFolder,
  onOpenFile,
}) => {
  const [data, setData] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clearingCache, setClearingCache] = useState(false);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [deletingFile, setDeletingFile] = useState(false);

  const mediaPlayer = useContext(MediaPlayerContext);
  const playMedia = mediaPlayer?.playMedia;

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const [res, cStats] = await Promise.all([
        api.getStorageAnalytics(),
        api.getMediaCacheStats().catch(() => null),
      ]);
      setData(res);
      if (cStats) {
        setCacheStats(cStats);
      }
    } catch (error) {
      toast.error("Failed to load storage analytics", {
        description: error.message || String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (clearingCache) return;
    try {
      setClearingCache(true);
      const res = await api.clearMediaCache();
      toast.success("Media streaming cache cleared", {
        description: `Freed ${res.freed_formatted || "disk space"}.`,
      });
      if (res.stats) {
        setCacheStats(res.stats);
      } else {
        const updated = await api.getMediaCacheStats().catch(() => null);
        if (updated) setCacheStats(updated);
      }
    } catch (err) {
      toast.error("Failed to clear media cache", {
        description: err.message || String(err),
      });
    } finally {
      setClearingCache(false);
    }
  };

  const handleEmptyTrashConfirm = async () => {
    try {
      setEmptyingTrash(true);
      const res = await api.emptyTrash();
      // Protected items stay in the trash
      if (res?.kept > 0) toast.info(`Trash emptied — ${keptMessage(res.kept)}`);
      else toast.success("Trash emptied successfully");
      setEmptyTrashOpen(false);
      await fetchAnalytics();
    } catch (err) {
      toast.error("Failed to empty trash", {
        description: err.message || String(err),
      });
    } finally {
      setEmptyingTrash(false);
    }
  };

  const handleDeleteFileConfirm = async () => {
    if (!fileToDelete) return;
    try {
      setDeletingFile(true);
      await api.trashFile(fileToDelete.id);
      toast.success(`Moved "${fileToDelete.file_name}" to Trash`);
      setFileToDelete(null);
      await fetchAnalytics();
    } catch (err) {
      // Protected (or inside a protected folder): the server says why
      if (isProtectedError(err)) {
        setFileToDelete(null);
        toast.error(err.message);
        return;
      }
      toast.error("Failed to delete file", {
        description: err.message || String(err),
      });
    } finally {
      setDeletingFile(false);
    }
  };

  const handleNavigateTrash = () => {
    if (onOpenTrash) {
      onOpenTrash();
    } else {
      window.dispatchEvent(new CustomEvent("changeCategory", { detail: { filter: "trash" } }));
    }
  };

  const handleNavigateCategory = (categoryKey) => {
    if (onOpenCategory) {
      onOpenCategory(categoryKey);
    } else {
      window.dispatchEvent(
        new CustomEvent("changeCategory", {
          detail: { filter: "all", typeFilter: categoryKey },
        })
      );
    }
  };

  const handleShowInFolder = (file) => {
    const folderPath = file.file_path || "/Home";
    if (onShowInFolder) {
      onShowInFolder(folderPath, file.file_name);
    } else {
      window.dispatchEvent(
        new CustomEvent("changeCategory", {
          detail: { folderPath, fileName: file.file_name },
        })
      );
    }
  };

  const handleOpenFile = (file) => {
    if (onOpenFile) {
      onOpenFile(file);
      return;
    }
    const ext = (file.file_name?.split(".").pop() || "").toLowerCase();
    const VIDEO_EXTS = ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "3gp", "ts"];
    const AUDIO_EXTS = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma"];
    const isVideo = file.file_type === "video" || VIDEO_EXTS.includes(ext);
    const isAudio = file.file_type === "audio" || file.file_type === "voice" || AUDIO_EXTS.includes(ext);

    const baseUrl = getApiBaseUrl() || "";
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
    const sep = tokenParam ? "&" : "?";
    const fId = file.id ? `&file_id=${encodeURIComponent(file.id)}` : "";
    const fPath = file.file_path ? `&path=${encodeURIComponent(file.file_path)}` : "";
    const mediaUrl = `${baseUrl}/dl/${encodeURIComponent(file.file_name)}${tokenParam}${sep}inline=1${fId}${fPath}`;

    if ((isVideo || isAudio) && playMedia) {
      playMedia({
        url: mediaUrl,
        fileName: file.file_name,
        fileType: isVideo ? "video" : "audio",
        fileItem: file,
      });
    } else {
      window.open(mediaUrl, "_blank", "noopener,noreferrer");
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const totalBytes = data?.total_bytes || 0;
  const trashSummary = getTrashSummary(data?.trash_count, data?.trash_bytes);
  const categoryRows = buildCategoryRows(data?.by_category, totalBytes);
  const barSegments = buildBarSegments(data?.by_category, totalBytes);
  const largestFiles = sortLargestFiles(data?.largest_files || []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <PageHeader
        icon={HardDrive}
        title="Storage"
        subtitle="Storage overview, category usage breakdown, largest files, and SSD streaming cache"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAnalytics}
            disabled={loading}
            className="gap-2 text-xs h-8 border-border"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 select-none min-h-0 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Top 4 Summary Tiles (2x2 on mobile, 4 columns on desktop) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Total Files */}
            <Card className="bg-card/70 border-border shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Files className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Total Files</div>
                  <div className="text-lg font-bold text-foreground truncate">
                    {data?.total_files ?? 0}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total Folders */}
            <Card className="bg-card/70 border-border shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cloud/10 text-cloud flex items-center justify-center shrink-0">
                  <Folder className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Folders</div>
                  <div className="text-lg font-bold text-foreground truncate">
                    {data?.total_folders ?? 0}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Starred */}
            <Card className="bg-card/70 border-border shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning/10 text-warning flex items-center justify-center shrink-0">
                  <Star className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Starred</div>
                  <div className="text-lg font-bold text-foreground truncate">
                    {data?.starred_count ?? 0}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Trash */}
            <Card className="bg-card/70 border-border shadow-sm">
              <CardContent className="p-4 flex flex-col justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Trash</div>
                    <div className="text-sm font-bold text-foreground truncate" title={`${trashSummary.count} items (${formatBytes(trashSummary.bytes)})`}>
                      {trashSummary.count} items ({formatBytes(trashSummary.bytes)})
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNavigateTrash}
                    className="text-xs h-7 px-2.5 flex-1 border-border"
                  >
                    Open
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEmptyTrashOpen(true)}
                    disabled={trashSummary.isEmpty || emptyingTrash}
                    className="text-xs h-7 px-2.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20 flex-1"
                  >
                    {emptyingTrash ? "Emptying..." : "Empty"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Usage: Stacked Bar & Readable Table */}
          <Card className="border-border bg-card/70 backdrop-blur-sm shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-semibold">Storage Usage</CardTitle>
                  <CardDescription className="text-xs">
                    Storage utilized across all categories in your Telegram cloud
                  </CardDescription>
                </div>
                <div className="text-left sm:text-right">
                  <span className="text-xs text-muted-foreground block">Total Cloud Storage</span>
                  <span className="text-xl sm:text-2xl font-bold text-primary">
                    {formatBytes(totalBytes)}
                  </span>
                  {data?.quota_bytes ? (
                    <span className="text-xs text-muted-foreground block" aria-label="Storage space">
                      of {formatBytes(data.quota_bytes)} · {formatBytes(data.free_bytes ?? Math.max(0, data.quota_bytes - totalBytes))} free
                    </span>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              {/* Stacked Progress Bar */}
              <div className="w-full h-3.5 bg-muted rounded-full overflow-hidden flex shadow-inner">
                {barSegments.length > 0 ? (
                  barSegments.map((seg) => (
                    <div
                      key={seg.key}
                      style={{ width: `${seg.sharePercent}%` }}
                      className={`h-full transition-all duration-300 ${seg.barClass}`}
                      title={`${seg.label}: ${formatBytes(seg.bytes)} (${seg.sharePercent}%)`}
                    />
                  ))
                ) : (
                  <div className="w-full h-full bg-muted" />
                )}
              </div>

              {/* Category Table */}
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border bg-muted/30 hover:bg-muted/30">
                      <TableHead className="text-xs font-semibold text-muted-foreground">Category</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground text-right">Size</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground text-right">Files</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground text-right">Share %</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground text-right w-16">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryRows.map((cat) => {
                      const Icon = getCategoryIcon(cat.key);
                      return (
                        <TableRow
                          key={cat.key}
                          onClick={() => handleNavigateCategory(cat.key)}
                          className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                          title={`Click to view ${cat.label} in Files`}
                        >
                          <TableCell className="py-2.5 px-3 sm:px-4">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cat.barClass}`} />
                              <Icon className={`w-4 h-4 shrink-0 ${cat.tokenColor}`} />
                              <span className="font-medium text-xs text-foreground truncate">{cat.label}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 px-3 sm:px-4 text-xs font-mono font-medium text-foreground text-right whitespace-nowrap">
                            {formatBytes(cat.bytes)}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 sm:px-4 text-xs text-muted-foreground text-right">
                            {cat.count}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 sm:px-4 text-xs font-mono text-muted-foreground text-right">
                            {cat.sharePercent}%
                          </TableCell>
                          <TableCell className="py-2.5 px-3 sm:px-4 text-right">
                            <span className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Desktop Two-Column Layout: Largest Files and Streaming Cache */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Top Largest Files */}
            <Card className="border-border bg-card/70 backdrop-blur-sm shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center justify-between">
                  <span>Top Largest Files</span>
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    {largestFiles.length} files
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Files consuming the most storage space in your account
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {largestFiles.length > 0 ? (
                  <div className="divide-y divide-border">
                    {largestFiles.map((file, idx) => (
                      <div
                        key={file.id || idx}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:px-4 sm:py-3 gap-2 hover:bg-muted/40 transition-colors text-xs"
                      >
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span className="font-mono text-xs text-muted-foreground/70 w-5 pt-0.5 shrink-0 text-center">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-xs text-foreground truncate" title={file.file_name}>
                              {file.file_name}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate" title={file.file_path || "/Home"}>
                              {file.file_path || "/Home"} · <span className="font-mono font-medium text-foreground">{formatBytes(file.file_size)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenFile(file)}
                            className="h-7 px-2 text-xs text-foreground hover:bg-muted gap-1"
                            title="Open file"
                            aria-label={`Open ${file.file_name}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Open</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleShowInFolder(file)}
                            className="h-7 px-2 text-xs text-foreground hover:bg-muted gap-1"
                            title="Show in folder"
                            aria-label={`Show ${file.file_name} in folder`}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Folder</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => (isProtectedItem(file) ? toast.error(protectedReason({ ...file, name: file.file_name })) : setFileToDelete(file))}
                            aria-disabled={isProtectedItem(file) || undefined}
                            aria-description={isProtectedItem(file) ? protectedReason({ ...file, name: file.file_name }) : undefined}
                            className={`h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 ${isProtectedItem(file) ? "opacity-50 cursor-not-allowed" : ""}`}
                            title={isProtectedItem(file) ? "Protected from deletion" : "Move to trash"}
                            aria-label={`Move ${file.file_name} to trash`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Delete</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    No files found in storage yet.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tier-2 SSD Media Streaming Cache */}
            <Card className="border-border bg-card/70 backdrop-blur-sm shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
                        <Zap className="w-4 h-4" />
                      </div>
                      <span>Media Streaming Cache (SSD)</span>
                      <Badge variant="secondary" className="text-[10px] bg-warning/15 text-warning border-warning/30">
                        Tier-2 Fast Seek
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Persistent {cacheStats?.max_size_formatted || "25 GB"} local SSD chunk cache enabling instant playback start and lag-free 10s seeking for WebDAV &amp; web streaming.
                    </CardDescription>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearCache}
                    disabled={clearingCache || !cacheStats || cacheStats.total_size_bytes === 0}
                    className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20 shrink-0 self-start sm:self-center"
                  >
                    <Trash2 className={`w-3.5 h-3.5 ${clearingCache ? "animate-pulse" : ""}`} />
                    {clearingCache ? "Clearing..." : "Clear Cache"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                {/* Cache Storage Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium">
                      {cacheStats?.total_size_formatted ?? "0 B"} used of {cacheStats?.max_size_formatted ?? "25.00 GB"} max cap
                    </span>
                    <span className="font-semibold text-foreground">
                      {cacheStats?.usage_percent ?? 0}%
                    </span>
                  </div>
                  <Progress value={Math.min(100, Math.max(0, cacheStats?.usage_percent ?? 0))} className="h-2.5 bg-muted" />
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="rounded-lg border border-border/70 bg-background/60 p-2.5">
                    <div className="text-[11px] text-muted-foreground">Cached Chunks</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">
                      {cacheStats?.chunk_count ?? 0}
                    </div>
                    <div className="text-[10px] text-muted-foreground/80 mt-0.5">Stream segments on SSD</div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background/60 p-2.5">
                    <div className="text-[11px] text-muted-foreground">Pinned Headers</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">
                      {cacheStats?.header_count ?? 0}
                    </div>
                    <div className="text-[10px] text-muted-foreground/80 mt-0.5">0ms initial playback start</div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background/60 p-2.5">
                    <div className="text-[11px] text-muted-foreground">Host Free Disk</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">
                      {cacheStats?.free_disk_space_formatted ?? "Checking..."}
                    </div>
                    <div className="text-[10px] text-muted-foreground/80 mt-0.5">&gt;25 GB guard threshold</div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background/60 p-2.5">
                    <div className="text-[11px] text-muted-foreground">Eviction Policy</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">
                      LRU &amp; 7d TTL
                    </div>
                    <div className="text-[10px] text-muted-foreground/80 mt-0.5">Auto-cleans down to 20 GB</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Empty Trash Confirmation Dialog */}
      <AlertDialog open={emptyTrashOpen} onOpenChange={setEmptyTrashOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {trashSummary.count} {trashSummary.count === 1 ? "item" : "items"} ({formatBytes(trashSummary.bytes)}) currently in Trash. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emptyingTrash}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmptyTrashConfirm}
              disabled={emptyingTrash}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {emptyingTrash ? "Emptying..." : "Empty Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move File to Trash Confirmation Dialog */}
      <AlertDialog open={Boolean(fileToDelete)} onOpenChange={(open) => !open && setFileToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to move &ldquo;{fileToDelete?.file_name}&rdquo; ({formatBytes(fileToDelete?.file_size)}) to Trash? You can restore it later from Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFile}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFileConfirm}
              disabled={deletingFile}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingFile ? "Moving..." : "Move to Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
