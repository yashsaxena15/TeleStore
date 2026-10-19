import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTransferManager } from "./useTransferManager";
import { useMediaPlayer } from "@/features/player/MediaPlayerContext";
import { formatBytes, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowUpDown, ArrowUp, ArrowDown, CloudDownload, Pause, Play, X, ChevronDown, ChevronUp, ExternalLink, Magnet, FolderArchive } from "lucide-react";
import { groupRemoteTransfers } from "./transferGrouping";
export const TransfersWidget = () => {
    const navigate = useNavigate();
    const { uploads, downloads, remoteTransfers, activeUploads, activeDownloads, activeRemote, totalActiveCount, stats, pauseUpload, resumeUpload, cancelUpload, pauseDownload, resumeDownload, cancelDownload, cancelRemoteTransfer, cancelRemoteGroup, resumeRemoteGroup, pauseAll, resumeAll } = useTransferManager();
    const { activeAudioTrack, isAudioMinimized } = useMediaPlayer?.() || {};
    const needsDockElevation = Boolean(activeAudioTrack && !isAudioMinimized);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    // Auto-expand when a new transfer begins
    useEffect(() => {
        if (totalActiveCount > 0) {
            setIsDismissed(false);
        }
    }, [totalActiveCount]);
    // Combine items for widget view (group remote items, limit to top 6)
    const { groupedRemoteItems, singleRemoteItems } = groupRemoteTransfers(remoteTransfers);
    const allItems = [
        ...groupedRemoteItems,
        ...singleRemoteItems,
        ...uploads.map(u => ({ ...u, type: "upload" })),
        ...downloads.map(d => ({
            ...d,
            type: "download",
            filesize: d.size || 0,
            bytesUploaded: d.downloaded || 0,
            downloaded: d.downloaded || 0
        }))
    ];
    // Show only if there are active items, or if recently expanded
    const recentItems = allItems
        .filter(i => i.status === "uploading" || i.status === "downloading" || i.status === "uploading_tg" || i.status === "paused" || i.status === "queued" || i.status === "paused_quota" || i.status === "discovering")
        .slice(0, 6);
    if (recentItems.length === 0 && !isExpanded) {
        return null;
    }
    if (isDismissed) {
        return null;
    }
    const formatSpeed = (bytesPerSec) => {
        if (!bytesPerSec || bytesPerSec <= 0)
            return "";
        return `${formatBytes(bytesPerSec)}/s`;
    };
    return (<div role="region" aria-label="Transfers monitor" aria-live="polite" className={cn("fixed right-4 z-40 w-[calc(100vw-2rem)] sm:w-80 md:w-96 max-w-[calc(100vw-2rem)] shadow-2xl rounded-xl border border-border bg-card text-card-foreground overflow-hidden transition-all duration-300 ease-in-out", needsDockElevation ? "bottom-28 sm:bottom-24 2xl:bottom-4" : "bottom-4")}>
      {/* Header Bar */}
      <div className="px-4 py-2.5 bg-card hover:bg-muted/15 border-b border-border flex items-center justify-between transition-colors">
        <div role="button" tabIndex={0} aria-expanded={isExpanded} aria-label={isExpanded ? "Collapse transfers panel" : "Expand transfers panel"} className="flex items-center gap-2 cursor-pointer select-none flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded-md" onClick={() => setIsExpanded(!isExpanded)} onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsExpanded(!isExpanded);
            }
        }}>
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <ArrowUpDown className="w-4 h-4"/>
          </div>
          <span className="font-semibold text-xs text-foreground">
            Transfers {totalActiveCount > 0 ? `(${totalActiveCount} active)` : ""}
          </span>
          {activeRemote.length > 0 && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-cloud/15 text-cloud font-medium flex items-center gap-0.5 border border-cloud/20">
              <CloudDownload className="w-2.5 h-2.5"/> {activeRemote.length}
            </span>)}
          {activeUploads.length > 0 && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-info/15 text-info font-medium flex items-center gap-0.5 border border-info/20">
              <ArrowUp className="w-2.5 h-2.5"/> {activeUploads.length}
            </span>)}
          {activeDownloads.length > 0 && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success font-medium flex items-center gap-0.5 border border-success/20">
              <ArrowDown className="w-2.5 h-2.5"/> {activeDownloads.length}
            </span>)}
        </div>

        <div className="flex items-center gap-1">
          {totalActiveCount > 0 && (<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); pauseAll(); }} aria-label="Pause all transfers" title="Pause All">
              <Pause className="w-3.5 h-3.5"/>
            </Button>)}
          {stats.pausedCount > 0 && (<Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:text-primary/80" onClick={(e) => { e.stopPropagation(); resumeAll(); }} aria-label="Resume all transfers" title="Resume All">
              <Play className="w-3.5 h-3.5"/>
            </Button>)}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} aria-label={isExpanded ? "Collapse transfers panel" : "Expand transfers panel"} aria-expanded={isExpanded} title={isExpanded ? "Collapse" : "Expand"}>
            {isExpanded ? <ChevronDown className="w-4 h-4"/> : <ChevronUp className="w-4 h-4"/>}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); setIsDismissed(true); }} aria-label="Dismiss transfers widget" title="Dismiss widget">
            <X className="w-4 h-4"/>
          </Button>
        </div>
      </div>

      {/* Expanded Transfers List - Expands upward with viewport-constrained scroll */}
      {isExpanded && (<div className="max-h-[min(20rem,calc(100vh-14rem))] overflow-y-auto p-3 flex flex-col gap-2.5 custom-scrollbar">
          {recentItems.length === 0 ? (<p className="text-center text-xs text-muted-foreground py-4">No active transfers</p>) : (recentItems.map(item => {
                const isGroup = Boolean(item.isGroup);
                const isRemote = item.type === "remote";
                const isUpload = item.type === "upload";
                const isTransferring = item.status === "uploading" || item.status === "downloading" || item.status === "uploading_tg";
                const isPaused = item.status === "paused";
                const isPausedQuota = item.status === "paused_quota" || Boolean(item.isPausedQuota);
                const isDiscovering = item.status === "discovering" || Boolean(item.isDiscovering);
                const transferred = item.bytesUploaded || (item.downloaded || 0);
                const total = item.filesize || (item.size || 0);
                return (<div key={`${item.type}_${item.id}`} className="p-2.5 rounded-lg border border-border/60 bg-muted/15 hover:bg-muted/25 transition-colors">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className={`p-1 rounded shrink-0 ${isPausedQuota
                        ? "bg-warning/15 text-warning"
                        : isDiscovering
                            ? "bg-info/15 text-info animate-pulse"
                            : isRemote
                                ? "bg-cloud/15 text-cloud"
                                : isUpload
                                    ? "bg-primary/15 text-primary"
                                    : "bg-success/15 text-success"}`}>
                        {isGroup ? (<FolderArchive className="w-3 h-3"/>) : isRemote ? (item.source_type === "magnet" || item.source_type === "torrent_file" ? (<Magnet className="w-3 h-3"/>) : (<CloudDownload className="w-3 h-3"/>)) : isUpload ? (<ArrowUp className="w-3 h-3"/>) : (<ArrowDown className="w-3 h-3"/>)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-foreground truncate flex items-center gap-1.5">
                          {item.filename || item.name}
                          {isGroup && (<span className="text-[9px] px-1 py-0.2 rounded font-semibold bg-cloud/20 text-cloud">
                              {item.completedCount}/{item.totalCount} files
                            </span>)}
                          {isRemote && !isGroup && (<span className={`text-[9px] px-1 py-0.2 rounded font-normal ${isPausedQuota ? "bg-warning/20 text-warning font-semibold" :
                            isDiscovering ? "bg-info/20 text-info font-semibold" :
                                isPaused ? "bg-warning/20 text-warning" : "bg-cloud/20 text-cloud"}`}>
                              {isPausedQuota
                            ? "Quota 24h"
                            : isDiscovering
                                ? "Discovering"
                                : isPaused
                                    ? "Paused"
                                    : item.source_type === "magnet"
                                        ? "Magnet"
                                        : item.source_type === "torrent_file"
                                            ? "Torrent"
                                            : "Cloud Leech"}
                            </span>)}
                          {isRemote && item.peer_count > 0 && (<span className="text-[9px] px-1 py-0.2 rounded font-semibold bg-warning/20 text-warning">
                              ⚡ {item.peer_count}
                            </span>)}
                        </div>
                        {isRemote && item.phase && (<div className={`text-[10px] truncate ${isPausedQuota ? "text-warning font-medium" :
                            isDiscovering ? "text-info font-medium" :
                                isPaused ? "text-warning font-medium" :
                                    "text-muted-foreground"}`}>
                            {item.phase}
                          </div>)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {(isPausedQuota || (isGroup && (item.items?.some(i => i.status === 'paused_quota' || i.status === 'failed') || (isQueued && item.completedCount > 0)))) && (<button className="p-1 text-amber-600 hover:text-amber-700 dark:text-amber-400 rounded" onClick={() => {
                            if (isGroup) {
                                resumeRemoteGroup(item.group_id);
                            }
                            else {
                                resumeRemoteGroup(item.id);
                            }
                        }} aria-label={`Resume transfer ${item.filename || item.name || ''}`.trim()} title="Resume Remaining">
                          <Play className="w-3.5 h-3.5 fill-current"/>
                        </button>)}
                      {!isRemote && isTransferring && (<button className="p-1 text-muted-foreground hover:text-foreground rounded" onClick={() => isUpload ? pauseUpload(item.id) : pauseDownload(item.id)} aria-label={`Pause transfer ${item.filename || item.name || ''}`.trim()} title="Pause">
                          <Pause className="w-3.5 h-3.5"/>
                        </button>)}
                      {!isRemote && isPaused && (<button className="p-1 text-primary hover:text-primary/80 rounded" onClick={() => isUpload ? resumeUpload(item.id) : resumeDownload(item.id)} aria-label={`Resume transfer ${item.filename || item.name || ''}`.trim()} title="Resume">
                          <Play className="w-3.5 h-3.5"/>
                        </button>)}
                      <button className="p-1 text-muted-foreground hover:text-destructive rounded" onClick={() => {
                        if (isGroup) {
                            cancelRemoteGroup(item.group_id);
                        }
                        else if (isRemote) {
                            cancelRemoteTransfer(item.id);
                        }
                        else if (isUpload) {
                            cancelUpload(item.id);
                        }
                        else {
                            cancelDownload(item.id);
                        }
                    }} aria-label={`${isGroup ? "Cancel entire folder" : "Cancel transfer"} ${item.filename || item.name || ''}`.trim()} title={isGroup ? "Cancel entire folder" : "Cancel"}>
                        <X className="w-3.5 h-3.5"/>
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <Progress value={item.progress} className={cn("h-1 w-full", (isPausedQuota || isPaused) ? "[&>div]:bg-warning" : isDiscovering ? "[&>div]:bg-info" : isRemote ? "[&>div]:bg-cloud" : "[&>div]:bg-primary")}/>

                  {/* Stats */}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                    <span>
                      {Math.round(item.progress)}% {total > 0 ? `• ${formatBytes(transferred)} of ${formatBytes(total)}` : (transferred > 0 ? `• ${formatBytes(transferred)}` : "")}
                    </span>
                    {isTransferring && item.speed ? (<span>{formatSpeed(item.speed)}</span>) : isPausedQuota ? (<span className="text-warning font-medium">Quota Hit (24h)</span>) : isDiscovering ? (<span className="text-info font-medium">Scanning...</span>) : (<span className="capitalize">{item.status}</span>)}
                  </div>
                </div>);
            }))}
        </div>)}

      {/* Footer Link to /transfers */}
      {isExpanded && (<div className="p-2 bg-card border-t border-border flex items-center justify-center">
          <Button variant="ghost" size="sm" className="w-full text-xs gap-1.5 h-7 text-primary hover:text-primary" onClick={() => navigate("/transfers")}>
            Open Transfers Center
            <ExternalLink className="w-3 h-3"/>
          </Button>
        </div>)}
    </div>);
};
