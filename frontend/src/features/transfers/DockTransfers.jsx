import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTransferManager } from "./useTransferManager";
import { useDockPresence } from "@/components/layout/dock/useDock";
import { formatBytes, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowUpDown, ArrowUp, ArrowDown, CloudDownload, Pause, Play, X, ChevronUp, ArrowRight, Magnet, FolderArchive } from "lucide-react";
import { groupRemoteTransfers } from "./transferGrouping";

const ACTIVE_STATUSES = ["uploading", "downloading", "uploading_tg", "paused", "queued", "paused_quota", "discovering"];
const formatSpeed = (bytesPerSec) => (bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : "");

// One transfer in the dock drawer: name, status badge, actions, progress and stats.
const TransferItem = ({ item, actions }) => {
    const { pauseUpload, resumeUpload, cancelUpload, pauseDownload, resumeDownload, cancelDownload, cancelRemoteTransfer, cancelRemoteGroup, resumeRemoteGroup } = actions;
    const isGroup = Boolean(item.isGroup);
    const isRemote = item.type === "remote";
    const isUpload = item.type === "upload";
    const isTransferring = ["uploading", "downloading", "uploading_tg"].includes(item.status);
    const isPaused = item.status === "paused";
    const isPausedQuota = item.status === "paused_quota" || Boolean(item.isPausedQuota);
    const isQueued = item.status === "queued";
    const isDiscovering = item.status === "discovering" || Boolean(item.isDiscovering);
    const transferred = item.bytesUploaded || item.downloaded || 0;
    const total = item.filesize || item.size || 0;
    const name = item.filename || item.name || "";
    const canResumeRemaining = isPausedQuota || (isGroup && (item.items?.some((i) => i.status === "paused_quota" || i.status === "failed") || (isQueued && item.completedCount > 0)));
    const tone = isPausedQuota || isPaused ? "warning" : isDiscovering ? "info" : isRemote ? "cloud" : isUpload ? "primary" : "success";
    const toneClass = { warning: "bg-warning/15 text-warning", info: "bg-info/15 text-info", cloud: "bg-cloud/15 text-cloud", primary: "bg-primary/15 text-primary", success: "bg-success/15 text-success" }[tone];
    const barClass = { warning: "[&>div]:bg-warning", info: "[&>div]:bg-info", cloud: "[&>div]:bg-cloud", primary: "[&>div]:bg-primary", success: "[&>div]:bg-success" }[tone];
    const badge = isGroup ? `${item.completedCount}/${item.totalCount} files`
        : !isRemote ? null
            : isPausedQuota ? "Quota 24h" : isDiscovering ? "Discovering" : isPaused ? "Paused"
                : item.source_type === "magnet" ? "Magnet" : item.source_type === "torrent_file" ? "Torrent" : "Cloud leech";
    const cancel = () => (isGroup ? cancelRemoteGroup(item.group_id) : isRemote ? cancelRemoteTransfer(item.id) : isUpload ? cancelUpload(item.id) : cancelDownload(item.id));
    return (<div className="px-2.5 py-2 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2.5">
        <span className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0", toneClass, isDiscovering && "animate-pulse")}>
          {isGroup ? <FolderArchive className="w-3.5 h-3.5"/> : isRemote ? (item.source_type === "magnet" || item.source_type === "torrent_file" ? <Magnet className="w-3.5 h-3.5"/> : <CloudDownload className="w-3.5 h-3.5"/>) : isUpload ? <ArrowUp className="w-3.5 h-3.5"/> : <ArrowDown className="w-3.5 h-3.5"/>}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium truncate" title={name}>{name}</span>
            {badge && <span className={cn("text-[9.5px] px-1.5 py-px rounded font-semibold shrink-0", toneClass)}>{badge}</span>}
            {isRemote && item.peer_count > 0 && <span className="text-[9.5px] px-1.5 py-px rounded font-semibold bg-warning/15 text-warning shrink-0">{item.peer_count} peers</span>}
          </div>
          {isRemote && item.phase && <div className={cn("text-[10.5px] truncate", tone === "warning" ? "text-warning font-medium" : tone === "info" ? "text-info font-medium" : "text-muted-foreground")}>{item.phase}</div>}
        </div>
        <div className="flex items-center shrink-0">
          {canResumeRemaining && (<Button variant="ghost" size="icon" className="h-7 w-7 text-warning" onClick={() => resumeRemoteGroup(isGroup ? item.group_id : item.id)} title="Resume remaining" aria-label={`Resume remaining files of ${name}`}>
              <Play className="w-3.5 h-3.5 fill-current"/>
            </Button>)}
          {!isRemote && isTransferring && (<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => (isUpload ? pauseUpload(item.id) : pauseDownload(item.id))} title="Pause" aria-label={`Pause ${name}`}>
              <Pause className="w-3.5 h-3.5"/>
            </Button>)}
          {!isRemote && isPaused && (<Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => (isUpload ? resumeUpload(item.id) : resumeDownload(item.id))} title="Resume" aria-label={`Resume ${name}`}>
              <Play className="w-3.5 h-3.5"/>
            </Button>)}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={cancel} title={isGroup ? "Cancel entire folder" : "Cancel"} aria-label={`${isGroup ? "Cancel entire folder" : "Cancel"} ${name}`}>
            <X className="w-3.5 h-3.5"/>
          </Button>
        </div>
      </div>
      <Progress value={item.progress} className={cn("h-1 mt-2", barClass)}/>
      <div className="flex justify-between gap-2 text-[10.5px] text-muted-foreground font-mono mt-1">
        <span className="truncate">{Math.round(item.progress || 0)}%{total > 0 ? ` · ${formatBytes(transferred)} of ${formatBytes(total)}` : transferred > 0 ? ` · ${formatBytes(transferred)}` : ""}</span>
        <span className="shrink-0">{isTransferring && item.speed ? formatSpeed(item.speed) : isPausedQuota ? "Quota reached (24h)" : isDiscovering ? "Scanning…" : item.status}</span>
      </div>
    </div>);
};

// Transfers summary in the dock; opens a drawer with the active transfers.
export const DockTransfers = ({ alone = false }) => {
    const navigate = useNavigate();
    const manager = useTransferManager();
    const { uploads, downloads, remoteTransfers, activeUploads, activeDownloads, activeRemote, totalActiveCount, stats, pauseAll, resumeAll } = manager;
    const [open, setOpen] = useState(false);
    const { groupedRemoteItems, singleRemoteItems } = groupRemoteTransfers(remoteTransfers);
    const items = [
        ...groupedRemoteItems,
        ...singleRemoteItems,
        ...uploads.map((u) => ({ ...u, type: "upload" })),
        ...downloads.map((d) => ({ ...d, type: "download", filesize: d.size || 0, bytesUploaded: d.downloaded || 0, downloaded: d.downloaded || 0 })),
    ].filter((i) => ACTIVE_STATUSES.includes(i.status));
    const visible = items.length > 0;
    useDockPresence("transfers", visible);
    if (!visible)
        return null;
    const speed = items.reduce((sum, i) => sum + (["uploading", "downloading", "uploading_tg"].includes(i.status) ? i.speed || 0 : 0), 0);
    const summary = `${totalActiveCount || items.length} active${speed > 0 ? ` · ${formatSpeed(speed)}` : ""}`;
    return (<Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("h-10 rounded-lg border border-border bg-muted/40 hover:bg-muted flex items-center gap-2 px-2.5 text-xs font-mono shrink-0 transition-colors", alone && "flex-1 justify-between")} aria-label={`Transfers: ${summary}`} aria-expanded={open}>
          <span className="flex items-center gap-2 min-w-0">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", totalActiveCount > 0 ? "bg-success animate-pulse" : "bg-muted-foreground/60")}/>
            <ArrowUpDown className="w-3.5 h-3.5 shrink-0"/>
            <span className={cn("truncate", !alone && "hidden sm:inline")}>{summary}</span>
            {!alone && <span className="sm:hidden">{totalActiveCount || items.length}</span>}
          </span>
          <ChevronUp className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")}/>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={10} className="w-[min(26rem,calc(100vw-1rem))] p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <span className="font-semibold text-sm">Transfers</span>
          <span className="flex items-center gap-1 text-[10px] font-mono">
            {activeRemote.length > 0 && <span className="px-1.5 py-px rounded bg-cloud/15 text-cloud flex items-center gap-0.5"><CloudDownload className="w-2.5 h-2.5"/>{activeRemote.length}</span>}
            {activeUploads.length > 0 && <span className="px-1.5 py-px rounded bg-primary/15 text-primary flex items-center gap-0.5"><ArrowUp className="w-2.5 h-2.5"/>{activeUploads.length}</span>}
            {activeDownloads.length > 0 && <span className="px-1.5 py-px rounded bg-success/15 text-success flex items-center gap-0.5"><ArrowDown className="w-2.5 h-2.5"/>{activeDownloads.length}</span>}
          </span>
          <span className="flex-1"/>
          {totalActiveCount > 0 && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={pauseAll} title="Pause all" aria-label="Pause all transfers"><Pause className="w-3.5 h-3.5"/></Button>}
          {stats.pausedCount > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={resumeAll} title="Resume all" aria-label="Resume all transfers"><Play className="w-3.5 h-3.5"/></Button>}
        </div>
        <div className="max-h-[min(22rem,calc(100dvh-12rem))] overflow-y-auto p-1.5" aria-live="polite">
          {items.slice(0, 8).map((item) => <TransferItem key={`${item.type}_${item.id}`} item={item} actions={manager}/>)}
        </div>
        <button onClick={() => { setOpen(false); navigate("/transfers"); }} className="w-full flex items-center justify-center gap-1.5 h-9 border-t border-border text-xs font-medium text-primary hover:bg-muted/50">
          Open transfers{items.length > 8 ? ` (${items.length - 8} more)` : ""}<ArrowRight className="w-3.5 h-3.5"/>
        </button>
      </PopoverContent>
    </Popover>);
};
