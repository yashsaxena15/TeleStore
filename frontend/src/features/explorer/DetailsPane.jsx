import { useEffect, useState } from "react";
import { X, Download, ExternalLink, Star, RotateCcw, Copy, Check, Link as LinkIcon, Info, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getApiBaseUrl, fetchWithTimeout, api } from "@/lib/api";
import { cn, formatBytes, copyStreamUrl } from "@/lib/utils";
import { toast } from "sonner";
import { Thumbnail } from "./Thumbnail";
import { FolderIcon } from "./items/FolderIcon";
import { getTypeInfo, TYPE_TONE } from "./lib/explorerItems";
import { getItemDuration, isItemStarred } from "./lib/fileCardHelpers";

const formatDateTime = (value) => {
    if (!value) return "Unknown";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

// Total size and counts for a folder (Telegram folders only; Drive has no stats endpoint).
const useFolderStats = (item) => {
    const [state, setState] = useState({ loading: false, stats: null });
    const isFolder = item?.type === "folder" && !item?.is_cloud;
    const key = isFolder ? (item.id || `${item.file_path}/${item.name}`) : null;
    useEffect(() => {
        if (!key) {
            setState({ loading: false, stats: null });
            return;
        }
        let cancelled = false;
        setState({ loading: true, stats: null });
        const token = localStorage.getItem("auth_token");
        const param = item.id ? `id=${encodeURIComponent(item.id)}` : `path=${encodeURIComponent(item.file_path ? `${item.file_path}/${item.name}` : `/Home/${item.name}`)}`;
        fetchWithTimeout(`${getApiBaseUrl() || ""}/folders/stats?${param}${token ? `&token=${encodeURIComponent(token)}` : ""}`, { credentials: "include" }, 6000)
            .then((res) => (res.ok ? res.json() : null))
            .then((stats) => !cancelled && setState({ loading: false, stats }))
            .catch(() => !cancelled && setState({ loading: false, stats: null }));
        return () => { cancelled = true; };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- refetch only when the folder changes
    return state;
};

const CopyField = ({ label, value, onCopy }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            if (onCopy) await onCopy();
            else await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success(`${label} copied`);
            setTimeout(() => setCopied(false), 1500);
        }
        catch {
            toast.error("Couldn't copy to the clipboard");
        }
    };
    return (<div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted-foreground">{label}</dt>
        <button type="button" onClick={copy} className="p-1 -m-1 rounded text-muted-foreground hover:text-foreground" aria-label={`Copy ${label}`} title={`Copy ${label}`}>
          {copied ? <Check className="w-3.5 h-3.5 text-success"/> : <Copy className="w-3.5 h-3.5"/>}
        </button>
      </div>
      <dd className="mt-1 font-mono text-[11px] break-all select-all text-foreground/90 bg-muted/40 border border-border rounded px-1.5 py-1 line-clamp-3">{value}</dd>
    </div>);
};

// The body of the details view; used by the desktop side pane and the phone sheet.
const ItemDetails = ({ item, selectionCount, selectionSize, thumbnailSrc, locationPath, isTrash, isCloud, cloudAccountId, onOpen, onDownload, onToggleStar, onRestore }) => {
    const { loading, stats } = useFolderStats(item);
    if (!item) {
        return (<div className="flex flex-col items-center justify-center text-center gap-2 py-16 px-6 text-muted-foreground">
          <Info className="w-6 h-6 opacity-60"/>
          {selectionCount > 1 ? (<>
              <p className="text-sm font-medium text-foreground">{selectionCount} items selected</p>
              {selectionSize > 0 && <p className="text-xs font-mono">{formatBytes(selectionSize)} in files</p>}
            </>) : (<p className="text-xs">Select or focus a file to see its details.</p>)}
        </div>);
    }
    const isFolder = item.type === "folder";
    const typeInfo = getTypeInfo(item);
    const duration = getItemDuration(item);
    const starred = isItemStarred(item);
    const token = localStorage.getItem("auth_token");
    const directUrl = isFolder ? null : isCloud || item.is_cloud
        ? api.getCloudStreamUrl(cloudAccountId || item.cloud_account_id, item.cloud_file_id || item.id)
        : `${getApiBaseUrl() || ""}/dl/${encodeURIComponent(item.name)}${token ? `?token=${encodeURIComponent(token)}&` : "?"}${item.id ? `file_id=${encodeURIComponent(item.id)}` : ""}${item.file_path ? `&path=${encodeURIComponent(item.file_path)}` : ""}`;
    const size = isFolder ? (loading ? "Calculating…" : stats ? formatBytes(stats.total_size) : "—") : formatBytes(item.size || 0);
    const actionBtn = "h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors";
    return (<div className="flex flex-col gap-3">
      <div className="relative aspect-[16/10] max-h-40 md:max-h-none rounded-lg border border-border bg-muted/30 overflow-hidden grid place-items-center">
        {isFolder ? <FolderIcon color={item.color} className="w-12 h-12" strokeWidth={1.4}/> : <Thumbnail item={item} size="fill" thumbnailSrc={thumbnailSrc}/>}
        {!isFolder && typeInfo.label && <span className={cn("absolute left-2 bottom-2 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-background/80", TYPE_TONE[typeInfo.kind])}>{typeInfo.label}</span>}
        {duration && <span className="absolute right-2 bottom-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-mono">{duration}</span>}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold break-words" title={item.name}>{item.name}</h3>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">{isFolder ? "Folder" : `${typeInfo.label || "File"} · ${size}`}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!isTrash && <button type="button" className={cn(actionBtn, "bg-primary text-primary-foreground border-transparent hover:bg-primary/90")} onClick={() => onOpen(item)}><ExternalLink className="w-3.5 h-3.5"/>Open</button>}
        {!isFolder && !isTrash && <button type="button" className={actionBtn} onClick={() => onDownload(item)}><Download className="w-3.5 h-3.5"/>Download</button>}
        {!isTrash && !item.is_virtual && <button type="button" className={actionBtn} onClick={() => onToggleStar(item)} aria-pressed={starred}><Star className={cn("w-3.5 h-3.5", starred && "fill-warning text-warning")}/>{starred ? "Starred" : "Star"}</button>}
        {isTrash && <button type="button" className={actionBtn} onClick={() => onRestore(item)}><RotateCcw className="w-3.5 h-3.5"/>Restore</button>}
        {!isFolder && !isTrash && !isCloud && !item.is_cloud && <button type="button" className={actionBtn} onClick={() => copyStreamUrl(item.name)}><LinkIcon className="w-3.5 h-3.5"/>Stream link</button>}
      </div>
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs border-t border-border pt-3">
        <dt className="text-muted-foreground">Type</dt><dd className="font-mono text-[11.5px] capitalize">{isFolder ? "Folder" : `${typeInfo.kind === "doc" ? "document" : typeInfo.kind} (${typeInfo.label})`}</dd>
        <dt className="text-muted-foreground">Size</dt><dd className="font-mono text-[11.5px]">{size}{!isFolder && item.size ? <span className="text-muted-foreground"> · {item.size.toLocaleString()} B</span> : null}</dd>
        {isFolder && stats && (<><dt className="text-muted-foreground">Contains</dt><dd className="font-mono text-[11.5px]">{stats.total_files} {stats.total_files === 1 ? "file" : "files"}{stats.total_subfolders > 0 ? `, ${stats.total_subfolders} ${stats.total_subfolders === 1 ? "folder" : "folders"}` : ""}</dd></>)}
        {duration && (<><dt className="text-muted-foreground">Duration</dt><dd className="font-mono text-[11.5px]">{duration}</dd></>)}
        <dt className="text-muted-foreground">Location</dt><dd className="font-mono text-[11.5px] break-all">{item.file_path || locationPath}</dd>
        <dt className="text-muted-foreground">Modified</dt><dd className="font-mono text-[11.5px]">{formatDateTime(item.modified)}</dd>
        {item.protected && (<><dt className="text-muted-foreground">Protection</dt><dd className="flex items-center gap-1 text-[11.5px]"><ShieldCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true"/>Protected from deletion</dd></>)}
        {isTrash && item.trashed_at && (<><dt className="text-muted-foreground">Deleted</dt><dd className="font-mono text-[11.5px]">{formatDateTime(item.trashed_at)}</dd></>)}
        {item.message_id && (<><dt className="text-muted-foreground">Telegram</dt><dd className="font-mono text-[11.5px] break-all">message {item.message_id}</dd></>)}
      </dl>
      {!isFolder && (<dl className="grid gap-3 text-xs border-t border-border pt-3">
          {item.file_unique_id && <CopyField label="Unique ID" value={item.file_unique_id}/>}
          {directUrl && <CopyField label="Direct link" value={directUrl}/>}
        </dl>)}
    </div>);
};

/**
 * Details for the focused/selected item: a right-side pane on desktop, a bottom sheet on phones.
 * The parent decides `item` (single selection, else the focused item) so it follows the arrow keys.
 */
export const DetailsPane = ({ open, isMobile, onClose, ...props }) => {
    if (isMobile) {
        return (<Sheet open={open && Boolean(props.item)} onOpenChange={(o) => !o && onClose()}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4 pt-3">
            <SheetHeader className="sr-only">
              <SheetTitle>Details</SheetTitle>
              <SheetDescription>{props.item?.name || "File details"}</SheetDescription>
            </SheetHeader>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted"/>
            <ItemDetails {...props}/>
          </SheetContent>
        </Sheet>);
    }
    if (!open) return null;
    return (<aside aria-label="Details" className="w-80 shrink-0 border-l border-border bg-card/40 flex flex-col min-h-0 animate-in slide-in-from-right-4 fade-in duration-150">
      <div className="flex items-center justify-between h-10 px-3 border-b border-border shrink-0">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Details</span>
        <button type="button" onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="Close details" title="Close details (i)">
          <X className="w-4 h-4"/>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pb-6 custom-scrollbar">
        <ItemDetails {...props}/>
      </div>
    </aside>);
};
