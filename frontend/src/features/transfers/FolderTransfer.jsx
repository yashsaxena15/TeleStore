import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, FileText, Loader2, Play, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn, formatBytes } from "@/lib/utils";
import { api } from "@/lib/api";
import { groupRemoteTransfers } from "./transferGrouping";
import { FOLDER_FILTERS, fileActions, googleNote, itemSpeeds, speedText, statusInfo, workerLabel } from "./transferRows";
import { TONE_CHIP, TransferDetails, copyLink } from "./TransferDetails";

const PAGE = 50;
const fmt = (b) => formatBytes(b, 1);
const toRemote = (t) => ({ ...t, id: t.task_id, type: "remote", name: t.filename, filesize: t.filesize || 0, bytesUploaded: t.transferred_bytes || 0, downloaded: t.transferred_bytes || 0 });

/**
 * One folder transfer on its own: every file, 50 at a time as you scroll, with search and a
 * filter, Retry or Cancel per file, Retry failed and Resume now at the top, and the folder's link.
 */
export const FolderTransfer = ({ group, actions, onBack, onCancelFolder }) => {
    const groupId = group.group_id;
    const [filter, setFilter] = useState("all");
    const [query, setQuery] = useState("");
    const [search, setSearch] = useState("");
    const [tasks, setTasks] = useState([]);
    const [total, setTotal] = useState(0);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [gone, setGone] = useState(false);
    const [tick, setTick] = useState(0);
    const [detailsId, setDetailsId] = useState(null);
    const loaded = useRef(0);
    const sentinel = useRef(null);

    // Typing waits a moment before searching
    useEffect(() => {
        const t = setTimeout(() => setSearch(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    // The first page when the search or filter changes, then every 5 s the files already shown
    // are fetched again so their progress stays live
    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            try {
                const limit = Math.min(200, Math.max(PAGE, loaded.current));
                const res = await api.getRemoteGroupTasks(groupId, { filter, q: search, offset: 0, limit });
                if (cancelled) return;
                const list = res?.tasks || [];
                loaded.current = list.length;
                setTasks(list);
                setTotal(res?.total || 0);
                if (res?.summary) setSummary(res.summary);
                setError("");
            }
            catch (e) {
                if (cancelled) return;
                if (e?.status === 404) setGone(true);
                else setError(e?.message || "Couldn't load this folder's files");
            }
            finally {
                if (!cancelled) setLoading(false);
            }
        };
        loaded.current = 0;
        setLoading(true);
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [groupId, filter, search, tick]);

    const loadMore = useCallback(async () => {
        if (loadingMore || loading || tasks.length >= total) return;
        setLoadingMore(true);
        try {
            const res = await api.getRemoteGroupTasks(groupId, { filter, q: search, offset: tasks.length, limit: PAGE });
            const seen = new Set(tasks.map((t) => t.task_id));
            const next = [...tasks, ...(res?.tasks || []).filter((t) => !seen.has(t.task_id))];
            loaded.current = next.length;
            setTasks(next);
            setTotal(res?.total ?? total);
        }
        catch (e) {
            setError(e?.message || "Couldn't load more files");
        }
        finally {
            setLoadingMore(false);
        }
    }, [groupId, filter, search, tasks, total, loading, loadingMore]);

    // The next page when the end of the list comes into view
    useEffect(() => {
        const el = sentinel.current;
        if (!el || typeof IntersectionObserver === "undefined") return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) loadMore();
        }, { rootMargin: "300px" });
        observer.observe(el);
        return () => observer.disconnect();
    }, [loadMore]);

    // The folder's row, from the freshest summary (the page's, else the list's)
    const folder = useMemo(() => {
        if (!summary) return group;
        const [fresh] = groupRemoteTransfers([], { [groupId]: { ...summary, name: summary.name || group.filename } }).groupedRemoteItems;
        return { ...group, ...fresh, group_type: group.group_type, worker: fresh.worker || group.worker };
    }, [summary, group, groupId]);

    const after = (fn) => async (...args) => {
        await fn(...args);
        setTick((t) => t + 1);
    };
    const retryFile = after(actions.retryRemoteTransfer);
    const cancelFile = after(actions.cancelRemoteTransfer);
    const retryFailed = after(() => actions.retryFailedRemote(groupId));
    const resumeNow = after(() => actions.resumeRemoteGroup(groupId));

    const st = statusInfo(folder);
    const note = googleNote(folder);
    const speeds = speedText(itemSpeeds(folder), fmt);
    const failed = folder.failedCount || 0;
    const left = (folder.totalCount || 0) - (folder.completedCount || 0);
    const details = detailsId ? tasks.find((t) => t.task_id === detailsId) : null;
    const detailsItem = details ? toRemote(details) : null;
    const detailsCan = details ? fileActions(details) : {};

    return (<div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={onBack}><ArrowLeft className="w-4 h-4"/>All transfers</Button>
      </div>
      <section aria-label={`Folder transfer ${folder.filename}`} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-base font-semibold truncate" title={folder.filename}>{folder.filename}</h2>
              <span className={cn("shrink-0 px-1.5 py-px rounded text-[9.5px] font-semibold", TONE_CHIP[st.tone])}>{st.label}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {(folder.completedCount || 0).toLocaleString("en")} of {(folder.totalCount || 0).toLocaleString("en")} files
              {folder.filesize > 0 ? ` · ${fmt(folder.filesize)}` : ""}
              {failed > 0 ? ` · ${failed.toLocaleString("en")} failed` : ""}
              {speeds ? ` · ${speeds}` : ""}
              {folder.worker ? ` · ${workerLabel(folder.worker)}` : ""}
              {folder.destination_path ? ` · to ${folder.destination_path}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Progress value={folder.progress} className="h-1.5 flex-1" aria-label="Folder progress"/>
          <span className="font-mono text-[11px] text-muted-foreground w-10 text-right">{Math.round(folder.progress || 0)}%</span>
        </div>
        {note && <p className="text-xs text-warning font-medium">{note}</p>}
        {folder.status === "failed" && folder.phase && <p className="text-xs text-destructive">{folder.phase}</p>}
        {folder.source_url && (<div className="flex items-center gap-1 min-w-0 text-xs">
            <span className="text-muted-foreground shrink-0">Link</span>
            <a href={folder.source_url} target="_blank" rel="noopener noreferrer" className="font-mono truncate text-primary hover:underline min-w-0">{folder.source_url}</a>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyLink(folder.source_url)} aria-label="Copy the folder's link" title="Copy link"><Copy className="w-3.5 h-3.5"/></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild>
              <a href={folder.source_url} target="_blank" rel="noopener noreferrer" aria-label="Open the folder's link" title="Open link"><ExternalLink className="w-3.5 h-3.5"/></a>
            </Button>
          </div>)}
        <div className="flex flex-wrap gap-2">
          {failed > 0 && <Button size="sm" variant="outline" className="gap-1.5" onClick={retryFailed}><RotateCcw className="w-4 h-4"/>Retry {failed.toLocaleString("en")} failed</Button>}
          {(folder.pausedCount || 0) > 0 && <Button size="sm" variant="outline" className="gap-1.5 text-warning border-warning/40 hover:bg-warning/10 hover:text-warning" onClick={resumeNow}><Play className="w-4 h-4 fill-current"/>Resume now</Button>}
          {left > 0 && ["downloading", "uploading_tg", "queued", "discovering", "paused_quota"].includes(folder.status) && (<Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => onCancelFolder(folder)}><X className="w-4 h-4"/>Cancel folder…</Button>)}
        </div>
      </section>

      {gone ? (<p className="text-sm text-muted-foreground">This folder transfer is gone (cleared, or not yours).</p>) : (<>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"/>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" aria-label="Search files" className="h-9 pl-8"/>
          </div>
          <div role="group" aria-label="Filter files" className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {FOLDER_FILTERS.map((f) => (<button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className={cn("h-7 shrink-0 px-2.5 rounded-md border text-xs whitespace-nowrap transition-colors", filter === f.id ? "bg-foreground text-background border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted")}>{f.label}</button>))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {loading && tasks.length === 0 ? "Loading…" : total === 0 ? (search ? `No files match "${search}"` : "No files here") : `${Math.min(tasks.length, total).toLocaleString("en")} of ${total.toLocaleString("en")} files`}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {tasks.length > 0 && (<div role="table" aria-label={`Files in ${folder.filename}`} className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
            {tasks.map((t) => <FileRow key={t.task_id} task={t} onOpen={() => setDetailsId(t.task_id)} onRetry={() => retryFile(t.task_id)} onCancel={() => cancelFile(t.task_id)}/>)}
          </div>)}
        <div ref={sentinel}/>
        {tasks.length < total && (<Button variant="outline" size="sm" className="self-center gap-1.5" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin"/>}Load more
          </Button>)}
      </>)}

      <TransferDetails item={detailsItem} onClose={() => setDetailsId(null)} actions={{
            retry: detailsCan.retry ? () => retryFile(details.task_id) : undefined,
            cancel: detailsCan.cancel ? () => cancelFile(details.task_id) : undefined,
            resumeNow: detailsCan.resumeNow ? () => retryFile(details.task_id) : undefined,
        }}/>
    </div>);
};

const FileRow = ({ task, onOpen, onRetry, onCancel }) => {
    const item = toRemote(task);
    const st = statusInfo(item);
    const can = fileActions(task);
    const speeds = speedText(itemSpeeds(item), fmt);
    const note = googleNote(item);
    const done = task.transferred_bytes || 0;
    const size = task.filesize || 0;
    const sizeText = task.status === "completed" ? (size ? fmt(size) : "") : size ? `${fmt(done)} of ${fmt(size)}` : done ? fmt(done) : "";
    return (<div role="row" className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true"/>
      <div role="cell" className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <button type="button" onClick={onOpen} className="text-sm truncate text-left hover:underline" title={`Details of ${task.filename}`}>{task.filename}</button>
          <span className={cn("shrink-0 px-1.5 py-px rounded text-[9.5px] font-semibold", TONE_CHIP[st.tone])}>{st.label}</span>
        </div>
        <div className="text-[11px] text-muted-foreground font-mono truncate">
          {[sizeText, speeds, workerLabel(task.worker)].filter(Boolean).join(" · ")}
        </div>
        {note && <div className="text-[11px] text-warning truncate">{note}</div>}
        {task.status === "failed" && task.error_message && <div className="text-[11px] text-destructive truncate" title={task.error_message}>{task.error_message}</div>}
        {["downloading", "uploading_tg"].includes(task.status) && <Progress value={task.progress} className="h-1 mt-1"/>}
      </div>
      <div role="cell" className="flex items-center shrink-0">
        {can.retry && <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={onRetry} aria-label={`Retry ${task.filename}`} title="Retry"><RotateCcw className="w-4 h-4"/></Button>}
        {can.cancel && <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onCancel} aria-label={`Cancel ${task.filename}`} title="Cancel"><X className="w-4 h-4"/></Button>}
      </div>
    </div>);
};
