import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, } from "@/components/ui/dialog";
import { Archive, Loader2, Sparkles } from "lucide-react";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
import { toast } from "sonner";
import { trackArchiveTask } from "@/lib/archiveTracker";
export const CompressDialog = ({ isOpen, onClose, selectedItemIds, selectedItemNames, currentPath, onCompressSuccess, }) => {
    const defaultName = selectedItemNames.length === 1
        ? `${selectedItemNames[0].replace(/\.[^/.]+$/, "")}.zip`
        : "Archive.zip";
    const [zipName, setZipName] = useState(defaultName);
    const [isCompressing, setIsCompressing] = useState(false);
    const handleCompress = async (e) => {
        e.preventDefault();
        if (!zipName.trim())
            return;
        setIsCompressing(true);
        try {
            const baseUrl = getApiBaseUrl();
            const res = await fetchWithTimeout(`${baseUrl ? baseUrl : ""}/api/archive/compress`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    item_ids: selectedItemIds,
                    destination_path: currentPath || "/Home",
                    zip_name: zipName.trim(),
                }),
            }, 15000);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || `Compression request failed (${res.status})`);
            }
            const data = await res.json();
            onClose();
            if (data.task_id) {
                trackArchiveTask(data.task_id, "compress", zipName.trim(), onCompressSuccess);
            }
            else {
                toast.success(`Created archive '${data.archive_name || zipName}' directly in Telegram cloud!`);
                if (onCompressSuccess)
                    onCompressSuccess();
            }
        }
        catch (err) {
            toast.error(err.message || "Cloud compression failed");
        }
        finally {
            setIsCompressing(false);
        }
    };
    return (<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-card border-border text-card-foreground p-6">
        <form onSubmit={handleCompress}>
          <DialogHeader className="border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 text-primary rounded-lg">
                <Archive className="w-5 h-5"/>
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">
                  Compress to Cloud ZIP
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {selectedItemIds.length} item(s) selected for compression
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="py-5 space-y-3">
            <label htmlFor="compress-zip-name" className="text-xs text-foreground font-medium block">
              Archive File Name
            </label>
            <input id="compress-zip-name" aria-label="Archive File Name" type="text" required value={zipName} onChange={(e) => setZipName(e.target.value)} placeholder="e.g. MyFiles.zip" className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-mono"/>
            <p className="text-xs text-muted-foreground">
              Files will be packed directly on the server into your Telegram cloud drive.
            </p>
          </div>

          <DialogFooter className="border-t border-border pt-4 flex flex-row items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={isCompressing} className="px-4 py-2 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
              Cancel
            </button>
            <button type="submit" disabled={isCompressing || !zipName.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
              {isCompressing ? (<>
                  <Loader2 className="w-4 h-4 animate-spin"/>
                  Compressing...
                </>) : (<>
                  <Sparkles className="w-4 h-4"/>
                  Create Archive
                </>)}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};
