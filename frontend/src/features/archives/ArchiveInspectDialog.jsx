import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, } from "@/components/ui/dialog";
import { Folder, File, Archive, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
import { toast } from "sonner";
import { trackArchiveTask } from "./archiveTracker";
export const ArchiveInspectDialog = ({ isOpen, onClose, fileId, fileName, currentPath, onExtractSuccess, }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [isExtracting, setIsExtracting] = useState(false);
    const [error, setError] = useState(null);
    const [files, setFiles] = useState([]);
    const [totalSize, setTotalSize] = useState(0);
    useEffect(() => {
        if (!isOpen || !fileId)
            return;
        setIsLoading(true);
        setError(null);
        const inspectArchive = async () => {
            try {
                const baseUrl = getApiBaseUrl();
                const res = await fetchWithTimeout(`${baseUrl ? baseUrl : ""}/api/archive/inspect/${encodeURIComponent(fileId)}`, {}, 120000);
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.detail || `Failed to inspect archive (${res.status})`);
                }
                const data = await res.json();
                setFiles(data.files || []);
                setTotalSize(data.total_uncompressed_size || 0);
            }
            catch (err) {
                setError(err.message || "Failed to inspect archive contents");
            }
            finally {
                setIsLoading(false);
            }
        };
        inspectArchive();
    }, [isOpen, fileId]);
    const handleExtract = async () => {
        setIsExtracting(true);
        try {
            const baseUrl = getApiBaseUrl();
            const res = await fetchWithTimeout(`${baseUrl ? baseUrl : ""}/api/archive/extract`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    file_id: fileId,
                    target_path: currentPath || "/Home",
                }),
            }, 15000);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || `Extraction request failed (${res.status})`);
            }
            const data = await res.json();
            onClose();
            if (data.task_id) {
                trackArchiveTask(data.task_id, "extract", fileName, onExtractSuccess);
            }
            else {
                toast.success(`Extracted directly in Telegram cloud!`);
                if (onExtractSuccess)
                    onExtractSuccess();
            }
        }
        catch (err) {
            toast.error(err.message || "Cloud extraction failed");
        }
        finally {
            setIsExtracting(false);
        }
    };
    const formatSize = (bytes) => {
        if (bytes === 0)
            return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };
    return (<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl bg-card border-border text-card-foreground max-h-[85vh] flex flex-col p-6">
        <DialogHeader className="border-b border-border pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 text-amber-500 dark:text-amber-400 rounded-lg">
              <Archive className="w-5 h-5"/>
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold truncate">
                {fileName}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {isLoading
            ? "Loading archive contents..."
            : `${files.length} items • Uncompressed: ${formatSize(totalSize)}`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto py-4 min-h-[250px] max-h-[50vh]">
          {isLoading ? (<div className="h-48 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary"/>
              <p className="text-sm">Loading archive contents from Telegram cloud...</p>
            </div>) : error ? (<div className="h-48 flex flex-col items-center justify-center gap-3 text-center p-4">
              <AlertCircle className="w-10 h-10 text-destructive"/>
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>) : files.length === 0 ? (<div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              Archive is empty.
            </div>) : (<div className="divide-y divide-border/60 font-mono text-xs">
              {files.map((item, index) => (<div key={index} className="py-2.5 px-3 flex items-center justify-between hover:bg-muted/50 rounded transition">
                  <div className="flex items-center gap-2.5 min-w-0 pr-4">
                    {item.is_dir ? (<Folder className="w-4 h-4 text-amber-500 shrink-0"/>) : (<File className="w-4 h-4 text-muted-foreground shrink-0"/>)}
                    <span className="truncate text-foreground" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="shrink-0 flex items-center gap-4 text-muted-foreground">
                    <span>{formatSize(item.size)}</span>
                    <span className="hidden sm:inline text-muted-foreground/70">
                      {item.date_time}
                    </span>
                  </div>
                </div>))}
            </div>)}
        </div>

        {/* Footer Actions */}
        <DialogFooter className="border-t border-border pt-4 flex flex-row items-center justify-between gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
            Close
          </button>
          <button disabled={isLoading || Boolean(error) || isExtracting || files.length === 0} onClick={handleExtract} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
            {isExtracting ? (<>
                <Loader2 className="w-4 h-4 animate-spin"/>
                Extracting to Cloud...
              </>) : (<>
                <Sparkles className="w-4 h-4"/>
                Extract to Cloud
              </>)}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
};
