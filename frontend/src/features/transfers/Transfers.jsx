import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpDown, ArrowUp, ArrowDown, CloudDownload, Pause, Play, X, RotateCcw, Trash2, FolderOpen, Folder, Magnet, FolderArchive, ChevronRight, Plus, MoreHorizontal, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn, formatBytes } from "@/lib/utils";
import { NEW_ITEM_GROUPS } from "@/components/layout/shellActions";
import { useTransferManager } from "./useTransferManager";
import { buildTransferItems, countByFilter, matchesFilter, TRANSFER_FILTERS, TRANSFERRING_STATUSES, formatEta, kindLabel, statusInfo, rowActions, activitySummary, itemSpeeds, totalSpeeds, speedText, headerLine, googleNote, workerLabel } from "./transferRows";
import { TONE_CHIP, TransferDetails } from "./TransferDetails";
import { FolderTransfer } from "./FolderTransfer";
import { WorkersPanel } from "./WorkersPanel";
import { useIsOwner } from "@/hooks/useShellData";
import { useFeatures } from "@/features/settings/useFeatures";

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

const TONE_TEXT = { primary: "text-primary", success: "text-success", warning: "text-warning", info: "text-info", cloud: "text-cloud", destructive: "text-destructive", muted: "text-muted-foreground" };
const TONE_BAR = { primary: "[&>div]:bg-primary", success: "[&>div]:bg-success", warning: "[&>div]:bg-warning", info: "[&>div]:bg-info", cloud: "[&>div]:bg-cloud", destructive: "[&>div]:bg-destructive", muted: "[&>div]:bg-muted-foreground" };
const QUOTA_HELP = "Google Drive limits how much can be downloaded per day. Only the files that hit the limit wait; they resume automatically when it resets. Resume now tries again right away.";
const SCAN_HELP = "Listing the files in this Google Drive folder. Downloads start as files are found.";
// Desktop columns shared by the header and rows so they line up
const COLS = "md:grid-cols-[32px_minmax(0,1fr)_200px_150px_150px]";
const fmt = (b) => formatBytes(b, 1);

const iconFor = (item) => {
    if (item.isGroup) return FolderArchive;
    if (item.type === "remote") return item.source_type === "magnet" || item.source_type === "torrent_file" ? Magnet : CloudDownload;
    return item.type === "upload" ? ArrowUp : ArrowDown;
};
const kindTone = (item) => (item.type === "remote" ? "cloud" : item.type === "upload" ? "primary" : "success");

const IconButton = ({ label, onClick, className, children }) => (<Button variant="ghost" size="icon" className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", className)} onClick={onClick} title={label} aria-label={label}>
    {children}
  </Button>);

const TransferRow = ({ item, actions, openInFolder, onOpen, onCancelFolder }) => {
    const Icon = iconFor(item);
    const st = statusInfo(item);
    const can = rowActions(item);
    const isUpload = item.type === "upload";
    const isRemote = item.type === "remote";
    const isGroup = Boolean(item.isGroup);
    const transferring = TRANSFERRING_STATUSES.includes(item.status) || (isRemote && item.status === "discovering");
    const scanning = st.label === "Scanning";
    const note = googleNote(item);
    const tone = ["warning", "info", "destructive", "success"].includes(st.tone) && !(st.tone === "warning" && item.status === "paused" && !isRemote) ? st.tone : kindTone(item);
    const done = item.bytesUploaded || item.downloaded || 0;
    const total = item.filesize || item.size || 0;
    const sizeText = isGroup
        ? `${(item.completedCount || 0).toLocaleString("en")} of ${(item.totalCount || 0).toLocaleString("en")} files${total > 0 ? ` · ${fmt(total)}` : ""}`
        : `${fmt(done)}${total > 0 ? ` of ${fmt(total)}` : ""}`;
    const speeds = transferring ? speedText(itemSpeeds(item), fmt) : "";
    const speedLine = [speeds, transferring && formatEta(item.eta) && `${formatEta(item.eta)} left`].filter(Boolean).join(" · ");
    const machine = workerLabel(item.worker);
    const detail = item.error || item.error_message || (item.status === "paused_quota" && note ? "" : item.phase) || (isRemote && item.destination_path ? `To ${item.destination_path}` : "");
    const detailTone = item.error || item.error_message || (isGroup && item.status === "failed") ? "destructive" : scanning ? "info" : "muted";
    const cancel = () => (isGroup ? onCancelFolder(item) : isRemote ? actions.cancelRemoteTransfer(item.id) : isUpload ? actions.cancelUpload(item.id) : actions.cancelDownload(item.id));
    const retry = () => (isRemote ? actions.retryRemoteTransfer(item.id) : isUpload ? actions.retryUpload(item.id) : actions.retryDownload(item));
    return (<div role="row" className={`grid grid-cols-[32px_minmax(0,1fr)_auto] ${COLS} gap-3 items-center px-3 py-2.5 hover:bg-muted/40 transition-colors`}>
      <span role="cell" className={cn("w-8 h-8 rounded-md grid place-items-center", TONE_CHIP[tone], scanning && "animate-pulse")}>
        <Icon className="w-4 h-4"/>
      </span>
      <div role="cell" className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button type="button" onClick={onOpen} className="min-w-0 flex items-center gap-1 text-sm font-medium hover:underline text-left" title={isGroup ? `Open ${item.filename}` : `Details of ${item.filename}`}>
            <span className="truncate">{item.filename}</span>
            {isGroup && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground"/>}
          </button>
          <span className={cn("shrink-0 px-1.5 py-px rounded text-[9.5px] font-semibold", TONE_CHIP[st.tone])}>{st.label}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0 mt-0.5">
          <span className="shrink-0">{kindLabel(item)}</span>
          {isGroup && <span className="shrink-0 font-mono">· {item.completedCount}/{item.totalCount}</span>}
          {machine && <span className="shrink-0">· {machine}</span>}
          {isRemote && item.peer_count > 0 && <span className="shrink-0 font-mono">· {item.peer_count} peers</span>}
          {detail && (<span className={cn("truncate", TONE_TEXT[detailTone])} title={scanning ? SCAN_HELP : detail}>
              · {scanning && <Loader2 className="inline w-3 h-3 mr-0.5 -mt-px animate-spin"/>}{detail}
            </span>)}
        </div>
        {note && <div className="text-[11px] text-warning font-medium truncate mt-0.5" title={QUOTA_HELP}>{note}</div>}
        {/* Phone: progress under the name */}
        <div className="md:hidden flex items-center gap-2 mt-1.5">
          <Progress value={item.progress} className={cn("h-1 flex-1", TONE_BAR[tone])}/>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0">{Math.round(item.progress || 0)}%{speeds ? ` · ${speeds}` : ""}</span>
        </div>
      </div>
      <div role="cell" className="hidden md:block min-w-0">
        <Progress value={item.progress} className={cn("h-1.5", TONE_BAR[tone])}/>
        <div className="mt-1 font-mono text-[10.5px] text-muted-foreground truncate" title={sizeText}>{Math.round(item.progress || 0)}% · {sizeText}</div>
      </div>
      <div role="cell" className="hidden md:block font-mono text-[11px] text-muted-foreground truncate" title={speedLine}>{speedLine || (total > 0 && !isGroup ? fmt(total) : "")}</div>
      <div role="cell" className="flex items-center justify-end gap-0.5">
        {can.resumeNow && (<Button variant="outline" size="sm" className="h-8 px-2 text-xs gap-1 text-warning border-warning/40 hover:bg-warning/10 hover:text-warning" onClick={() => (isGroup ? actions.resumeRemoteGroup(item.group_id) : actions.retryRemoteTransfer(item.id))} title={QUOTA_HELP}>
            <Play className="w-3.5 h-3.5 fill-current"/><span className="hidden sm:inline">Resume now</span>
          </Button>)}
        {can.retryFailed && (<Button variant="outline" size="sm" className="h-8 px-2 text-xs gap-1" onClick={() => actions.retryFailedRemote(item.group_id)} title="Try the failed files again">
            <RotateCcw className="w-3.5 h-3.5"/><span className="hidden sm:inline">Retry failed</span>
          </Button>)}
        {can.pause && <IconButton label={`Pause ${item.filename}`} onClick={() => (isUpload ? actions.pauseUpload(item.id) : actions.pauseDownload(item.id))}><Pause className="w-4 h-4"/></IconButton>}
        {can.resume && <IconButton label={`Resume ${item.filename}`} onClick={() => (isUpload ? actions.resumeUpload(item.id) : actions.resumeDownload(item.id))} className="text-primary"><Play className="w-4 h-4"/></IconButton>}
        {can.retry && <IconButton label={`Retry ${item.filename}`} onClick={retry} className="text-primary"><RotateCcw className="w-4 h-4"/></IconButton>}
        {can.showInFolder && <IconButton label="Show in folder" onClick={() => openInFolder(item.savePath)} className="text-success"><FolderOpen className="w-4 h-4"/></IconButton>}
        {can.cancel && <IconButton label={isGroup ? `Cancel all files in ${item.filename}` : `Cancel ${item.filename}`} onClick={cancel} className="hover:text-destructive"><X className="w-4 h-4"/></IconButton>}
      </div>
    </div>);
};

export const Transfers = ({ onNewTransfer }) => {
    const navigate = useNavigate();
    const manager = useTransferManager();
    const isOwner = useIsOwner();
    const { cloud } = useFeatures();
    const canStart = Boolean(onNewTransfer) && cloud;
    const { uploads, downloads, remoteTransfers, remoteGroups, stats, pauseAll, resumeAll, cancelAll, clearCompleted } = manager;
    const [filter, setFilter] = useState("all");
    const [folderId, setFolderId] = useState(null);
    const [detailsKey, setDetailsKey] = useState(null);
    const [confirmCancelAll, setConfirmCancelAll] = useState(false);
    const [confirmFolder, setConfirmFolder] = useState(null);
    const items = buildTransferItems(uploads, downloads, remoteTransfers, remoteGroups);
    const counts = countByFilter(items);
    const visible = items.filter((i) => matchesFilter(i, filter));
    const canCancelAny = stats.totalActive > 0 || stats.pausedCount > 0;
    const keyOf = (item) => `${item.type}_${item.id}`;
    const subtitle = headerLine(activitySummary({ running: stats.running, waiting: stats.waiting, paused: stats.pausedByGoogle }), totalSpeeds(items), fmt) || "Uploads, downloads and cloud leeches";
    const openFolder = folderId ? items.find((i) => i.isGroup && i.group_id === folderId) : null;
    const details = detailsKey ? items.find((i) => keyOf(i) === detailsKey) : null;
    const openInFolder = async (path) => {
        if (!path) return;
        try {
            await invoke("open_file_in_folder", { path });
        }
        catch (error) {
            console.error("Failed to open file folder:", error);
        }
    };
    const detailsActions = (item) => {
        if (!item) return {};
        const can = rowActions(item);
        const isRemote = item.type === "remote";
        const isUpload = item.type === "upload";
        return {
            showInFolder: can.showInFolder ? () => openInFolder(item.savePath) : undefined,
            pause: can.pause ? () => (isUpload ? manager.pauseUpload(item.id) : manager.pauseDownload(item.id)) : undefined,
            resume: can.resume ? () => (isUpload ? manager.resumeUpload(item.id) : manager.resumeDownload(item.id)) : undefined,
            retry: can.retry ? () => (isRemote ? manager.retryRemoteTransfer(item.id) : isUpload ? manager.retryUpload(item.id) : manager.retryDownload(item)) : undefined,
            resumeNow: can.resumeNow ? () => manager.retryRemoteTransfer(item.id) : undefined,
            cancel: can.cancel ? () => (isRemote ? manager.cancelRemoteTransfer(item.id) : isUpload ? manager.cancelUpload(item.id) : manager.cancelDownload(item.id)) : undefined,
        };
    };
    return (<div className="flex-1 flex flex-col overflow-hidden bg-background">
      <PageHeader icon={ArrowUpDown} title="Transfers" subtitle={subtitle} actions={<>
          {canStart && <NewTransferMenu onPick={onNewTransfer}/>}
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
          {!openFolder && isOwner && <WorkersPanel />}
          {openFolder ? (<FolderTransfer key={openFolder.group_id} group={openFolder} actions={manager} onBack={() => setFolderId(null)} onCancelFolder={setConfirmFolder}/>) : (<>
          <div role="group" aria-label="Filter transfers" className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            {TRANSFER_FILTERS.map((f) => (<button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className={cn("h-7 shrink-0 inline-flex items-center gap-1.5 px-2.5 rounded-md border text-xs whitespace-nowrap transition-colors", filter === f.id ? "bg-foreground text-background border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted", f.id === "failed" && counts.failed > 0 && filter !== f.id && "text-destructive")}>
                {f.label}<span className="font-mono text-[10px] opacity-70">{counts[f.id]}</span>
              </button>))}
            <span className="flex-1"/>
            {(counts.completed > 0 || counts.failed > 0) && (<button type="button" onClick={clearCompleted} className="h-7 shrink-0 inline-flex items-center gap-1.5 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted" title="Remove completed, failed and cancelled transfers from the list">
                <Trash2 className="w-3.5 h-3.5"/><span className="hidden sm:inline">Clear finished</span>
              </button>)}
          </div>

          {visible.length === 0 ? (<div className="rounded-lg border border-dashed border-border py-8 px-6 text-center">
              <h3 className="text-sm font-semibold">{filter === "all" ? "No transfers yet" : `No ${TRANSFER_FILTERS.find((f) => f.id === filter).label.toLowerCase()} transfers`}</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Uploads, downloads and cloud leeches show up here while they run.</p>
              <div className="mt-3 flex justify-center gap-2">
                {canStart && <NewTransferMenu onPick={onNewTransfer}/>}
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
                {visible.map((item) => (<TransferRow key={keyOf(item)} item={item} actions={manager} openInFolder={openInFolder} onCancelFolder={setConfirmFolder} onOpen={() => (item.isGroup ? setFolderId(item.group_id) : setDetailsKey(keyOf(item)))}/>))}
              </div>
            </div>)}
          </>)}
        </div>
      </div>

      <TransferDetails item={details} actions={detailsActions(details)} onClose={() => setDetailsKey(null)}/>

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

      <AlertDialog open={Boolean(confirmFolder)} onOpenChange={(o) => !o && setConfirmFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {confirmFolder?.filename}?</AlertDialogTitle>
            <AlertDialogDescription>
              The {Math.max(0, (confirmFolder?.totalCount || 0) - (confirmFolder?.completedCount || 0)).toLocaleString("en")} files not copied yet won't be. Files already copied stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { manager.cancelRemoteGroup(confirmFolder.group_id); setConfirmFolder(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Cancel folder</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>);
};
export default Transfers;
