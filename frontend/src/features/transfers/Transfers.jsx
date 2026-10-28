import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpDown, ArrowUp, ArrowDown, CloudDownload, Pause, Play, X, RotateCcw, Trash2, FolderOpen, Folder, Magnet, FolderArchive, ChevronRight, FileText, Plus, MoreHorizontal, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn, formatBytes } from "@/lib/utils";
import { NEW_ITEM_GROUPS } from "@/components/layout/shellActions";
import { useTransferManager } from "./useTransferManager";

// Server transfers the user can start: the "From elsewhere" items of the New menu, minus
// connecting a drive (not a transfer)
const TRANSFER_SOURCES = NEW_ITEM_GROUPS.flatMap((g) => g.items).filter((it) => ["remote-leech", "media-download", "instagram-import"].includes(it.id));

const NewTransferMenu = ({ onPick }) => (<DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4"/>New transfer</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-[260px]">
      {TRANSFER_SOURCES.map(({ id, label, icon: Icon }) => (<DropdownMenuItem key={id} onSelect={() => onPick(id)} className="gap-2"><Icon className="w-4 h-4"/>{label}</DropdownMenuItem>))}
    </DropdownMenuContent>
  </DropdownMenu>);
import { buildTransferItems, countByFilter, matchesFilter, TRANSFER_FILTERS, TRANSFERRING_STATUSES, formatEta, kindLabel, statusInfo, rowActions } from "./transferRows";

const TONE_CHIP = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/15 text-info",
    cloud: "bg-cloud/15 text-cloud",
    destructive: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
};
const TONE_TEXT = { primary: "text-primary", success: "text-success", warning: "text-warning", info: "text-info", cloud: "text-cloud", destructive: "text-destructive", muted: "text-muted-foreground" };
const TONE_BAR = { primary: "[&>div]:bg-primary", success: "[&>div]:bg-success", warning: "[&>div]:bg-warning", info: "[&>div]:bg-info", cloud: "[&>div]:bg-cloud", destructive: "[&>div]:bg-destructive", muted: "[&>div]:bg-muted-foreground" };
const QUOTA_HELP = "Google Drive limits how much can be downloaded per day. The remaining files wait here and resume automatically when the 24-hour limit resets; Resume now tries again right away.";
const SCAN_HELP = "Listing the files in this Google Drive folder. Downloads start as files are found.";
// Desktop columns shared by the header, rows and folder sub-rows so they line up
const COLS = "md:grid-cols-[32px_minmax(0,1fr)_200px_110px_150px]";
const formatSpeed = (bps) => (bps > 0 ? `${formatBytes(bps)}/s` : "");

const iconFor = (item) => {
    if (item.isGroup) return FolderArchive;
    if (item.type === "remote") return item.source_type === "magnet" || item.source_type === "torrent_file" ? Magnet : CloudDownload;
    return item.type === "upload" ? ArrowUp : ArrowDown;
};
const kindTone = (item) => (item.type === "remote" ? "cloud" : item.type === "upload" ? "primary" : "success");

const IconButton = ({ label, onClick, className, children }) => (<Button variant="ghost" size="icon" className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", className)} onClick={onClick} title={label} aria-label={label}>
    {children}
  </Button>);

// One file inside an expanded folder or multi-part leech
const SubRow = ({ sub, onRetry, onCancel }) => {
    const st = statusInfo(sub);
    const canCancel = ["downloading", "uploading_tg", "queued", "paused_quota"].includes(sub.status);
    return (<div role="row" className={`grid grid-cols-[32px_minmax(0,1fr)_auto] ${COLS} gap-3 items-center px-3 py-1.5 text-xs bg-muted/20`}>
      <span aria-hidden="true"/>
      <div role="cell" className="min-w-0 flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0"/>
        <span className="truncate" title={sub.filename}>{sub.filename}</span>
        <span className={cn("shrink-0 px-1.5 py-px rounded text-[9.5px] font-semibold", TONE_CHIP[st.tone])}>{st.label}</span>
      </div>
      <div role="cell" className="hidden md:flex items-center gap-2">
        <Progress value={sub.progress} className={cn("h-1 flex-1", TONE_BAR[st.tone === "muted" ? "muted" : st.tone === "success" ? "success" : "cloud"])}/>
        <span className="font-mono text-[10.5px] text-muted-foreground w-9 text-right">{Math.round(sub.progress || 0)}%</span>
      </div>
      <div role="cell" className="hidden md:block font-mono text-[10.5px] text-muted-foreground truncate" title={sub.phase}>{sub.filesize > 0 ? formatBytes(sub.filesize) : ""}</div>
      <div role="cell" className="flex justify-end">
        {sub.status === "failed" && <IconButton label={`Retry ${sub.filename}`} onClick={() => onRetry(sub.id)} className="h-7 w-7 text-primary"><RotateCcw className="w-3.5 h-3.5"/></IconButton>}
        {canCancel && <IconButton label={`Cancel ${sub.filename}`} onClick={() => onCancel(sub.id)} className="h-7 w-7 hover:text-destructive"><X className="w-3.5 h-3.5"/></IconButton>}
      </div>
    </div>);
};

const TransferRow = ({ item, expanded, onToggle, actions, openInFolder }) => {
    const Icon = iconFor(item);
    const st = statusInfo(item);
    const can = rowActions(item);
    const isUpload = item.type === "upload";
    const isRemote = item.type === "remote";
    const isGroup = Boolean(item.isGroup);
    const transferring = TRANSFERRING_STATUSES.includes(item.status);
    const quota = st.tone === "warning" && st.label === "Quota pause";
    const scanning = st.label === "Scanning";
    const tone = ["warning", "info", "destructive", "success"].includes(st.tone) && !(st.tone === "warning" && item.status === "paused" && !isRemote) ? st.tone : kindTone(item);
    const done = item.bytesUploaded || item.downloaded || 0;
    const total = item.filesize || item.size || 0;
    const sizeText = `${formatBytes(done)}${total > 0 ? ` of ${formatBytes(total)}` : ""}`;
    const speedText = transferring ? [formatSpeed(item.speed), formatEta(item.eta) && `${formatEta(item.eta)} left`].filter(Boolean).join(" · ") : "";
    const detail = item.error || item.error_message || item.phase || (isRemote && item.destination_path ? `To ${item.destination_path}` : "");
    const detailTone = item.error || item.error_message ? "destructive" : quota ? "warning" : scanning ? "info" : "muted";
    const cancel = () => (isGroup ? actions.cancelRemoteGroup(item.group_id) : isRemote ? actions.cancelRemoteTransfer(item.id) : isUpload ? actions.cancelUpload(item.id) : actions.cancelDownload(item.id));
    const retry = () => (isRemote ? (isGroup ? actions.resumeRemoteGroup(item.group_id) : actions.retryRemoteTransfer(item.id)) : isUpload ? actions.retryUpload(item.id) : actions.retryDownload(item));
    return (<div className={cn(expanded && "bg-muted/10")}>
      <div role="row" className={`grid grid-cols-[32px_minmax(0,1fr)_auto] ${COLS} gap-3 items-center px-3 py-2.5 hover:bg-muted/40 transition-colors`}>
        <span role="cell" className={cn("w-8 h-8 rounded-md grid place-items-center", TONE_CHIP[tone], scanning && "animate-pulse")}>
          <Icon className="w-4 h-4"/>
        </span>
        <div role="cell" className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {isGroup ? (<button type="button" onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex items-center gap-1 text-sm font-medium hover:underline text-left" title={expanded ? "Hide files" : `Show ${item.items.length} files`}>
                <ChevronRight className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}/>
                <span className="truncate">{item.filename}</span>
              </button>) : (<span className="text-sm font-medium truncate" title={item.filename}>{item.filename}</span>)}
            <span className={cn("shrink-0 px-1.5 py-px rounded text-[9.5px] font-semibold", TONE_CHIP[st.tone])}>{st.label}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0 mt-0.5">
            <span className="shrink-0">{kindLabel(item)}</span>
            {isGroup && <span className="shrink-0 font-mono">· {item.completedCount}/{item.totalCount}</span>}
            {isRemote && item.peer_count > 0 && <span className="shrink-0 font-mono">· {item.peer_count} peers</span>}
            {detail && (<span className={cn("truncate", TONE_TEXT[detailTone])} title={quota ? QUOTA_HELP : scanning ? SCAN_HELP : detail}>
                · {scanning && <Loader2 className="inline w-3 h-3 mr-0.5 -mt-px animate-spin"/>}{detail}
              </span>)}
          </div>
          {/* Phone: progress under the name */}
          <div className="md:hidden flex items-center gap-2 mt-1.5">
            <Progress value={item.progress} className={cn("h-1 flex-1", TONE_BAR[tone])}/>
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">{Math.round(item.progress || 0)}%{speedText ? ` · ${formatSpeed(item.speed)}` : ""}</span>
          </div>
        </div>
        <div role="cell" className="hidden md:block min-w-0">
          <Progress value={item.progress} className={cn("h-1.5", TONE_BAR[tone])}/>
          <div className="mt-1 font-mono text-[10.5px] text-muted-foreground truncate" title={sizeText}>{Math.round(item.progress || 0)}% · {sizeText}</div>
        </div>
        <div role="cell" className="hidden md:block font-mono text-[11px] text-muted-foreground truncate">{speedText || (total > 0 ? formatBytes(total) : "")}</div>
        <div role="cell" className="flex items-center justify-end gap-0.5">
          {can.resumeRemaining && (<Button variant="outline" size="sm" className="h-8 px-2 text-xs gap-1 text-warning border-warning/40 hover:bg-warning/10 hover:text-warning" onClick={() => actions.resumeRemoteGroup(isGroup ? item.group_id : item.id)} title={quota ? QUOTA_HELP : "Resume or retry the remaining files"}>
              {quota ? <Play className="w-3.5 h-3.5 fill-current"/> : <RotateCcw className="w-3.5 h-3.5"/>}
              <span className="hidden sm:inline">{quota ? "Resume now" : item.status === "failed" ? "Retry failed" : "Resume rest"}</span>
            </Button>)}
          {can.pause && <IconButton label={`Pause ${item.filename}`} onClick={() => (isUpload ? actions.pauseUpload(item.id) : actions.pauseDownload(item.id))}><Pause className="w-4 h-4"/></IconButton>}
          {can.resume && <IconButton label={`Resume ${item.filename}`} onClick={() => (isUpload ? actions.resumeUpload(item.id) : actions.resumeDownload(item.id))} className="text-primary"><Play className="w-4 h-4"/></IconButton>}
          {can.retry && !can.resumeRemaining && <IconButton label={`Retry ${item.filename}`} onClick={retry} className="text-primary"><RotateCcw className="w-4 h-4"/></IconButton>}
          {can.showInFolder && <IconButton label="Show in folder" onClick={() => openInFolder(item.savePath)} className="text-success"><FolderOpen className="w-4 h-4"/></IconButton>}
          {can.cancel && <IconButton label={isGroup ? `Cancel all files in ${item.filename}` : `Cancel ${item.filename}`} onClick={cancel} className="hover:text-destructive"><X className="w-4 h-4"/></IconButton>}
        </div>
      </div>
      {isGroup && expanded && (<div role="rowgroup" aria-label={`Files in ${item.filename}`} className="border-t border-border/60 divide-y divide-border/40">
          {item.items.map((sub) => <SubRow key={sub.id} sub={sub} onRetry={actions.retryRemoteTransfer} onCancel={actions.cancelRemoteTransfer}/>)}
        </div>)}
    </div>);
};

export const Transfers = ({ onNewTransfer }) => {
    const navigate = useNavigate();
    const manager = useTransferManager();
    const { uploads, downloads, remoteTransfers, stats, pauseAll, resumeAll, cancelAll, clearCompleted } = manager;
    const [filter, setFilter] = useState("all");
    const [expanded, setExpanded] = useState({});
    const [confirmCancelAll, setConfirmCancelAll] = useState(false);
    const items = buildTransferItems(uploads, downloads, remoteTransfers);
    const counts = countByFilter(items);
    const visible = items.filter((i) => matchesFilter(i, filter));
    const canCancelAny = stats.totalActive > 0 || stats.pausedCount > 0;
    const openInFolder = async (path) => {
        if (!path) return;
        try {
            await invoke("open_file_in_folder", { path });
        }
        catch (error) {
            console.error("Failed to open file folder:", error);
        }
    };
    return (<div className="flex-1 flex flex-col overflow-hidden bg-background">
      <PageHeader icon={ArrowUpDown} title="Transfers" subtitle={stats.totalActive > 0 ? `${stats.totalActive} active · uploads, downloads and cloud leeches` : "Uploads, downloads and cloud leeches"} actions={<>
          {onNewTransfer && <NewTransferMenu onPick={onNewTransfer}/>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Bulk actions" title="Bulk actions">
                <MoreHorizontal className="w-4 h-4"/>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[190px]">
              <DropdownMenuItem disabled={stats.totalActive === 0} onSelect={pauseAll} className="gap-2"><Pause className="w-4 h-4"/>Pause all</DropdownMenuItem>
              <DropdownMenuItem disabled={stats.pausedCount === 0} onSelect={resumeAll} className="gap-2"><Play className="w-4 h-4"/>Resume all</DropdownMenuItem>
              <DropdownMenuItem disabled={counts.completed === 0 && counts.failed === 0} onSelect={clearCompleted} className="gap-2"><Trash2 className="w-4 h-4"/>Clear finished</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canCancelAny} onSelect={() => setConfirmCancelAll(true)} className="gap-2 text-destructive focus:text-destructive"><X className="w-4 h-4"/>Cancel all…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}/>
      <div className="flex-1 overflow-auto px-3 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col gap-3">
          <div role="group" aria-label="Filter transfers" className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            {TRANSFER_FILTERS.map((f) => (<button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className={cn("h-7 shrink-0 inline-flex items-center gap-1.5 px-2.5 rounded-md border text-xs whitespace-nowrap transition-colors", filter === f.id ? "bg-foreground text-background border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted", f.id === "failed" && counts.failed > 0 && filter !== f.id && "text-destructive")}>
                {f.label}<span className="font-mono text-[10px] opacity-70">{counts[f.id]}</span>
              </button>))}
            <span className="flex-1"/>
            {(counts.completed > 0 || counts.failed > 0) && (<button type="button" onClick={clearCompleted} className="h-7 shrink-0 inline-flex items-center gap-1.5 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted" title="Remove completed, failed and cancelled transfers from the list">
                <Trash2 className="w-3.5 h-3.5"/><span className="hidden sm:inline">Clear finished</span>
              </button>)}
          </div>

          {visible.length === 0 ? (<div className="rounded-lg border border-dashed border-border py-14 px-6 text-center">
              <ArrowUpDown className="w-8 h-8 text-muted-foreground/60 mx-auto mb-3"/>
              <h3 className="text-sm font-semibold">{filter === "all" ? "No transfers yet" : `No ${TRANSFER_FILTERS.find((f) => f.id === filter).label.toLowerCase()} transfers`}</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Uploads, downloads and cloud leeches show up here while they run.</p>
              <div className="mt-4 flex justify-center gap-2">
                {onNewTransfer && <NewTransferMenu onPick={onNewTransfer}/>}
                <Button size="sm" variant="outline" onClick={() => navigate("/")} className="gap-1.5"><Folder className="w-4 h-4"/>Go to Files</Button>
              </div>
            </div>) : (<div role="table" aria-label="Transfers" className="rounded-lg border border-border bg-card overflow-hidden">
              <div role="row" className={`hidden md:grid ${COLS} gap-3 px-3 h-8 items-center border-b border-border text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground`}>
                <span role="columnheader"/>
                <span role="columnheader">Name</span>
                <span role="columnheader">Progress</span>
                <span role="columnheader">Speed</span>
                <span role="columnheader" className="sr-only">Actions</span>
              </div>
              <div className="divide-y divide-border">
                {visible.map((item) => (<TransferRow key={`${item.type}_${item.id}`} item={item} expanded={Boolean(expanded[item.group_id])} onToggle={() => setExpanded((prev) => ({ ...prev, [item.group_id]: !prev[item.group_id] }))} actions={manager} openInFolder={openInFolder}/>))}
              </div>
            </div>)}
        </div>
      </div>

      <AlertDialog open={confirmCancelAll} onOpenChange={setConfirmCancelAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel all transfers?</AlertDialogTitle>
            <AlertDialogDescription>
              Every running, queued and paused upload, download and cloud leech stops. Files already finished stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => { cancelAll(); setConfirmCancelAll(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Cancel all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>);
};
export default Transfers;
