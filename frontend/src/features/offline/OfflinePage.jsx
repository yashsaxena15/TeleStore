// Offline: the files and folders saved in this browser (right-click › Make available offline).
// They open from the saved copy, so this page works without internet.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderOpen, HardDriveDownload, Trash2, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useMediaPlayer } from "@/features/player/MediaPlayerContext";
import { createOpenItem } from "@/features/explorer/actions/openItem";
import { getFileIcon } from "@/features/explorer/fileTypes";
import { filesOfFolder, totalBytes } from "./offlineIndex";
import { getOfflineFile, offlineSupported, removeAllOffline, removeOffline, removeOfflineFolder, storageEstimate, syncOfflineFolders, useOfflineIndex } from "./offlineStore";

const ImageViewer = lazy(() => import("@/features/viewers/ImageViewer").then((m) => ({ default: m.ImageViewer })));
const DocumentReaderModal = lazy(() => import("@/features/viewers/DocumentReaderModal").then((m) => ({ default: m.DocumentReaderModal })));

const fmt = (bytes) => {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

// Files the browser can't show are handed over as a download of the saved copy
async function saveCopyToDevice(item) {
    const file = await getOfflineFile(item.id);
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const useOnline = () => {
    const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
    useEffect(() => {
        const on = () => setOnline(true), off = () => setOnline(false);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
        };
    }, []);
    return online;
};

export const OfflinePage = ({ onShowInFolder }) => {
    const supported = offlineSupported();
    const index = useOfflineIndex();
    const online = useOnline();
    const { playMedia } = useMediaPlayer();
    const [estimate, setEstimate] = useState(null);
    const [confirmAll, setConfirmAll] = useState(false);
    const [imageViewer, setImageViewer] = useState(null);
    const [documentReader, setDocumentReader] = useState(null);
    const lastOpenTimeRef = useRef(0);

    const files = useMemo(() => Object.values(index.files).map((f) => ({ ...f, type: "file" })).sort((a, b) => a.name.localeCompare(b.name)), [index]);
    const folders = useMemo(() => Object.values(index.folders).sort((a, b) => a.path.localeCompare(b.path)), [index]);
    const used = totalBytes(index);

    // Saved folders catch up with the server each time the page opens
    useEffect(() => {
        if (supported && online) syncOfflineFolders();
    }, [supported, online]);
    useEffect(() => {
        storageEstimate().then(setEstimate);
    }, [used]);

    const noop = () => { };
    const openItem = createOpenItem({
        cloudAccountId: undefined, items: files, lastOpenTimeRef,
        onDownload: (item) => saveCopyToDevice(item).catch(noop),
        onNavigate: noop, playMedia,
        setArchiveInspect: ({ fileName }) => { const it = files.find((f) => f.name === fileName); if (it) saveCopyToDevice(it).catch(noop); },
        setDocumentReader, setImageViewer, setIsSelectionMode: noop, setLastSelectedIndex: noop, setSelectedItems: noop,
    });

    const subtitle = !supported
        ? null
        : `${files.length === 1 ? "1 file" : `${files.length} files`} · ${fmt(used)} used${estimate ? ` · ${fmt(estimate.free)} free in this browser` : ""}`;

    return (<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <PageHeader icon={HardDriveDownload} title="Offline" subtitle={subtitle || "Files saved in this browser"} actions={supported && (files.length > 0 || folders.length > 0) && (<Button size="sm" variant="outline" onClick={() => setConfirmAll(true)}><Trash2 className="w-4 h-4 mr-1"/>Remove all</Button>)}/>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6">
        {!supported ? (<p className="text-sm text-muted-foreground">This browser can't keep files offline (it may be too old, or a private window).</p>) : (<div className="grid gap-6 max-w-3xl">
            {!online && (<p className="flex items-center gap-2 text-sm text-muted-foreground"><WifiOff className="w-4 h-4"/>You're offline. These files still open.</p>)}

            {folders.length > 0 && (<section>
                <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Folders kept in step</h2>
                <ul className="grid gap-1">
                  {folders.map((d) => {
                    const inside = filesOfFolder(index, d.path);
                    return (<li key={d.path} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                      <Folder className="w-5 h-5 text-primary shrink-0"/>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{d.name}</p>
                        <p className="text-[11px] font-mono text-muted-foreground truncate">{d.path} · {inside.length === 1 ? "1 file" : `${inside.length} files`} · {fmt(inside.reduce((s, f) => s + (f.size || 0), 0))}</p>
                      </div>
                      {online && <Button size="sm" variant="ghost" onClick={() => onShowInFolder?.(d.path)} aria-label={`Open ${d.name} in Files`}><FolderOpen className="w-4 h-4"/></Button>}
                      <Button size="sm" variant="ghost" onClick={() => removeOfflineFolder(d.path, d.name)} aria-label={`Remove ${d.name}`}><X className="w-4 h-4"/></Button>
                    </li>);
                })}
                </ul>
              </section>)}

            <section>
              <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Files</h2>
              {files.length === 0 ? (<p className="text-sm text-muted-foreground max-w-prose">
                  Nothing saved yet. Right-click a file or folder in Files and choose Make available offline. Saved files open here even without internet.
                </p>) : (<ul className="grid gap-0.5" aria-label="Offline files">
                  {files.map((f) => {
                    const folderSaved = Boolean(f.folder && index.folders[f.folder]);
                    return (<li key={f.id} className="flex items-center gap-1 rounded-lg hover:bg-muted/50">
                      <button type="button" onClick={() => openItem(f)} className="flex-1 min-w-0 flex items-center gap-3 px-2 py-2 text-left" aria-label={`Open ${f.name}`}>
                        <span className="w-6 text-center shrink-0" aria-hidden="true">{getFileIcon(f.fileType, f.name)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm truncate">{f.name}</span>
                          <span className="block text-[11px] font-mono text-muted-foreground truncate">{fmt(f.size)} · {f.file_path}</span>
                        </span>
                      </button>
                      {/* A file kept with its folder goes when the folder is removed */}
                      {(!folderSaved || f.pinned) && (<Button size="sm" variant="ghost" onClick={() => removeOffline([f])} aria-label={`Remove ${f.name}`}><X className="w-4 h-4"/></Button>)}
                    </li>);
                })}
                </ul>)}
            </section>
          </div>)}
      </div>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all offline files?</AlertDialogTitle>
            <AlertDialogDescription>The saved copies in this browser are deleted. Your files stay in TeleStore.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeAllOffline()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Suspense fallback={null}>
        {imageViewer && <ImageViewer images={imageViewer.images} initialIndex={imageViewer.initialIndex} onClose={() => setImageViewer(null)}/>}
        {documentReader && <DocumentReaderModal url={documentReader.url} fileName={documentReader.fileName} fileExtension={documentReader.extension} onClose={() => setDocumentReader(null)}/>}
      </Suspense>
    </div>);
};
