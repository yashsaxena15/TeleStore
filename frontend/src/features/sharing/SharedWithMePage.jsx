// Shared with me: files and folders other TeleStore accounts shared with you. A folder opens
// here (?share=<id>&path=<inside it>); viewers can open and download, editors can also upload,
// make folders, rename, move and move to Trash (it goes to the owner's Trash).
import { lazy, Suspense, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FolderInput, FolderPlus, Loader2, Pencil, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { api, getApiBaseUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { relativeTime } from "@/features/notifications/notificationHelpers";
import { ShareCrumbs, ShareFileList, ShareThumb } from "./ShareFileList";
import { downloadUrl, useSharedViewer } from "./SharedViewer";
import { crumbsFor, itemActions, joinRel, memberUrls, roleLabel, shareAbilities, sortShareItems } from "./shareHelpers";

const FolderDownloadDialog = lazy(() => import("@/features/explorer/dialogs/FolderDownloadDialog").then((m) => ({ default: m.FolderDownloadDialog })));

const WITH_ME_KEY = ["shares", "with-me"];
const urlsFor = (shareId) => memberUrls(getApiBaseUrl() || "", shareId, typeof window !== "undefined" ? localStorage.getItem("auth_token") : null);

const NameDialog = ({ open, title, label, initial = "", confirm, onSubmit, onClose }) => {
    const [name, setName] = useState(initial);
    const [busy, setBusy] = useState(false);
    const submit = async (e) => {
        e.preventDefault();
        const value = name.trim();
        if (!value) return;
        setBusy(true);
        const ok = await onSubmit(value);
        setBusy(false);
        if (ok) onClose();
    };
    return (<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">{label}</DialogDescription>
          </DialogHeader>
          <Input autoFocus aria-label={label} value={name} maxLength={255} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()}/>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === initial}>{busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/>}{confirm}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};

// Picks a folder inside the share to move an item to
const MoveDialog = ({ share, item, onMove, onClose }) => {
    const [path, setPath] = useState("");
    const [busy, setBusy] = useState(false);
    const { data, isLoading, error } = useQuery({
        queryKey: ["shares", "browse", share.share_id, path],
        queryFn: () => api.browseShare(share.share_id, path),
    });
    const movingPath = item.type === "folder" ? joinRel(item.path, item.name) : null;
    const folders = sortShareItems((data?.items || []).filter((it) => it.type === "folder" && joinRel(path, it.name) !== movingPath));
    const here = path === (item.path || "");
    const move = async () => {
        setBusy(true);
        const ok = await onMove(path);
        setBusy(false);
        if (ok) onClose();
    };
    return (<Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words pr-6">Move “{item.name}”</DialogTitle>
          <DialogDescription>Pick a folder in “{share.rootName}”.</DialogDescription>
        </DialogHeader>
        <ShareCrumbs crumbs={crumbsFor(share.rootName, path)} onOpen={setPath}/>
        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
          {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                : error ? <p className="p-4 text-sm text-destructive">{error.message}</p>
                    : folders.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No folders here.</p>
                        : folders.map((f) => (<button key={f.id} type="button" onClick={() => setPath(joinRel(path, f.name))} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted">
                  <ShareThumb item={f} className="w-5 h-5"/>{f.name}
                </button>))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || here} onClick={move}>Move here</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
};

const ShareList = ({ onOpenShare, onOpenFile }) => {
    const { data, isLoading, error, refetch } = useQuery({ queryKey: WITH_ME_KEY, queryFn: api.sharedWithMe });
    const shares = data?.shares || [];
    if (isLoading)
        return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>;
    if (error)
        return (<div className="py-16 text-center text-sm"><p className="text-destructive">{error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => refetch()}>Try again</Button></div>);
    if (!shares.length)
        return (<div className="py-16 text-center text-muted-foreground"><Users className="w-8 h-8 mx-auto mb-3 opacity-60"/><p className="text-sm">Nothing is shared with you yet.</p><p className="text-xs mt-1">When someone shares a file or folder with you, it shows up here.</p></div>);
    return (<ul role="list" aria-label="Shared with me" className="divide-y divide-border rounded-lg border border-border bg-card/40">
      {shares.map((s) => (<li key={s.share_id}>
          <button type="button" onClick={() => (s.item.type === "folder" ? onOpenShare(s) : onOpenFile(s))} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset" aria-label={`Open ${s.item.name}`}>
            <span className="w-10 h-10 shrink-0 rounded-md border border-border bg-muted/40 overflow-hidden grid place-items-center">
              <ShareThumb item={s.item} src={s.item.type === "folder" ? null : urlsFor(s.share_id).thumb(s.item.id)}/>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{s.item.name}</span>
              <span className="block text-xs text-muted-foreground truncate">Shared by {s.owner?.name || s.owner?.username || "someone"}{s.shared_at ? ` · ${relativeTime(s.shared_at)}` : ""}</span>
            </span>
            <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{roleLabel(s.role)}</span>
          </button>
        </li>))}
    </ul>);
};

const SharedFolder = ({ shareId, path, onPath, onBack }) => {
    const queryClient = useQueryClient();
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ["shares", "browse", shareId, path],
        queryFn: () => api.browseShare(shareId, path),
        retry: false,
    });
    const [naming, setNaming] = useState(null); // { kind: "folder" } | { kind: "rename", item }
    const [moving, setMoving] = useState(null);
    const [trashing, setTrashing] = useState(null);
    const [zip, setZip] = useState(null);
    const fileInput = useRef(null);
    const urls = urlsFor(shareId);
    const download = (item) => downloadUrl(urls.file(item.id), item.name);
    const viewer = useSharedViewer({ fileUrl: (it, inline) => urls.file(it.id, inline), onDownload: download });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["shares", "browse", shareId] });

    if (isLoading)
        return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>;
    if (error)
        return (<div className="py-16 text-center text-sm"><p className="text-destructive">{error.message}</p>
        <div className="mt-3 flex justify-center gap-2"><Button size="sm" variant="outline" onClick={onBack}>Back to Shared with me</Button><Button size="sm" variant="ghost" onClick={() => refetch()}>Try again</Button></div></div>);

    const root = data.root;
    const role = data.role;
    const can = shareAbilities(role);
    const items = sortShareItems(data.items);
    const share = { share_id: shareId, rootName: root.name };
    const act = async (call, success) => {
        try {
            await call();
            if (success) toast.success(success);
            refresh();
            return true;
        }
        catch (err) {
            toast.error(err.message || "Something went wrong");
            return false;
        }
    };
    const open = (item) => (item.type === "folder" ? onPath(joinRel(item.path ?? path, item.name)) : viewer.open(item, items));
    const menu = (item) => {
        const a = itemActions(role);
        return [
            ...(item.type === "folder"
                ? [{ label: "Download as zip", icon: Download, onSelect: () => downloadZip(joinRel(item.path ?? path, item.name)) }]
                : [{ label: "Download", icon: Download, onSelect: () => download(item) }]),
            ...(a.rename || a.move || a.trash ? [{ separator: true }] : []),
            ...(a.rename ? [{ label: "Rename", icon: Pencil, onSelect: () => setNaming({ kind: "rename", item }) }] : []),
            ...(a.move ? [{ label: "Move", icon: FolderInput, onSelect: () => setMoving(item) }] : []),
            ...(a.trash ? [{ label: "Move to Trash", icon: Trash2, danger: true, onSelect: () => setTrashing(item) }] : []),
        ];
    };
    const downloadZip = async (zipPath) => {
        try {
            const info = await api.shareZipInfo(shareId, zipPath);
            if (!info.parts?.length) return toast.info("This folder is empty.");
            if (info.parts.length === 1) {
                downloadUrl(urls.part(info.parts[0].download_url), info.parts[0].name);
                toast.success(`Downloading ${info.parts[0].name}`);
            }
            else setZip(info);
        }
        catch (err) {
            toast.error(err.message || "Couldn't prepare the download");
        }
    };
    const upload = async (files) => {
        for (const file of files) {
            const id = toast.loading(`Uploading ${file.name}…`);
            try {
                await api.shareUpload(shareId, file, path, (percent) => toast.loading(`Uploading ${file.name}… ${percent}%`, { id }));
                toast.success(`Uploaded ${file.name}`, { id });
            }
            catch (err) {
                toast.error(err.message || `Couldn't upload ${file.name}`, { id });
            }
        }
        refresh();
    };

    return (<>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <ShareCrumbs crumbs={crumbsFor(root.name, path)} onOpen={onPath} before={<button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4"/>Shared with me</button>}/>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{roleLabel(role)}</span>
        <span className="text-xs text-muted-foreground">Shared by {data.owner?.name || "someone"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {can.upload && (<>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) upload(files); }}/>
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}><Upload className="w-3.5 h-3.5 mr-1.5"/>Upload</Button>
            </>)}
          {can.newFolder && <Button size="sm" variant="outline" onClick={() => setNaming({ kind: "folder" })}><FolderPlus className="w-3.5 h-3.5 mr-1.5"/>New folder</Button>}
          <Button size="sm" variant="outline" onClick={() => downloadZip(path)}><Download className="w-3.5 h-3.5 mr-1.5"/>Download folder</Button>
        </div>
      </div>
      <ShareFileList items={items} thumbUrl={(it) => urls.thumb(it.id)} onOpen={open} onDownload={download} menu={menu}/>
      {viewer.viewers}
      {naming && (<NameDialog open title={naming.kind === "folder" ? "New folder" : `Rename “${naming.item.name}”`} label={naming.kind === "folder" ? "Folder name" : "New name"} initial={naming.kind === "folder" ? "" : naming.item.name} confirm={naming.kind === "folder" ? "Create" : "Rename"} onClose={() => setNaming(null)} onSubmit={(name) => naming.kind === "folder"
                ? act(() => api.shareNewFolder(shareId, path, name), `Created “${name}”`)
                : act(() => api.shareRename(shareId, naming.item.id, name), "Renamed")}/>)}
      {moving && <MoveDialog share={share} item={{ ...moving, path: moving.path ?? path }} onClose={() => setMoving(null)} onMove={(target) => act(() => api.shareMove(shareId, moving.id, target), "Moved")}/>}
      <AlertDialog open={Boolean(trashing)} onOpenChange={(o) => !o && setTrashing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{trashing?.name}” to Trash?</AlertDialogTitle>
            <AlertDialogDescription>It goes to the Trash of {data.owner?.name || "the owner"}, who can restore it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { const it = trashing; setTrashing(null); act(() => api.shareTrash(shareId, it.id), "Moved to Trash"); }}>Move to Trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {zip && (<Suspense fallback={null}><FolderDownloadDialog open info={zip} onClose={() => setZip(null)} onDownloadPart={(part) => downloadUrl(urls.part(part.download_url), part.name)} onDownloadAll={(parts) => parts.forEach((part, i) => setTimeout(() => downloadUrl(urls.part(part.download_url), part.name), i * 400))}/></Suspense>)}
    </>);
};

export const SharedWithMePage = () => {
    const [params, setParams] = useSearchParams();
    const shareId = params.get("share");
    const path = params.get("path") || "";
    // A shared file (not a folder) opens straight from the list; the item carries its share
    const viewer = useSharedViewer({
        fileUrl: (it, inline) => urlsFor(it.shareId).file(it.id, inline),
        onDownload: (it) => downloadUrl(urlsFor(it.shareId).file(it.id), it.name),
    });
    const openFile = (s) => viewer.open({ ...s.item, shareId: s.share_id });
    return (<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <PageHeader icon={Users} title="Shared with me" subtitle={shareId ? undefined : "Files and folders others shared with you"}/>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 pb-24 md:pb-6">
        {shareId
            ? <SharedFolder key={shareId} shareId={shareId} path={path} onPath={(p) => setParams(p ? { share: shareId, path: p } : { share: shareId })} onBack={() => setParams({})}/>
            : <ShareList onOpenShare={(s) => setParams({ share: s.share_id })} onOpenFile={openFile}/>}
      </div>
      {viewer.viewers}
    </div>);
};
