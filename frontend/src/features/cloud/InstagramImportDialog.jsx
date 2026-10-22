import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Images, Instagram, Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSaveDestination } from "./SaveDestination";

const INSTAGRAM_LINK = /^(https?:\/\/)?(www\.|m\.)?(instagram\.com|instagr\.am)\/([A-Za-z0-9._]+\/)?(p|reels?|tv)\/[A-Za-z0-9_-]{5,}/i;

const describe = (preview) => {
    const count = preview.items.length;
    if (count > 1)
        return `Carousel · ${count} items`;
    return preview.items[0]?.is_video ? "Video" : "Photo";
};

/**
 * Paste an Instagram post or reel link, check what it holds, pick Home, the Private Vault or a
 * Google Drive folder, and the server downloads it. Progress shows in Transfers.
 * defaultDestination: { kind, path } or { kind: "gdrive", accountId, folderId, folderName }.
 */
export const InstagramImportDialog = ({ open, onOpenChange, defaultDestination, userEmail }) => {
    const [url, setUrl] = useState("");
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const lastPreviewed = useRef("");
    const save = useSaveDestination({ open, defaultDestination, userEmail, onChange: () => setError("") });

    useEffect(() => {
        if (!open)
            return;
        setUrl("");
        setPreview(null);
        setError("");
        lastPreviewed.current = "";
    }, [open]);

    // Read the post shortly after a link is pasted or typed
    useEffect(() => {
        const link = url.trim();
        if (!open || !INSTAGRAM_LINK.test(link) || link === lastPreviewed.current)
            return;
        let stale = false;
        const timer = setTimeout(async () => {
            lastPreviewed.current = link;
            setPreviewing(true);
            setError("");
            setPreview(null);
            try {
                const res = await api.instagramPreview(link);
                if (!stale)
                    setPreview(res);
            }
            catch (err) {
                if (!stale)
                    setError(err.message);
            }
            finally {
                if (!stale)
                    setPreviewing(false);
            }
        }, 500);
        return () => { stale = true; clearTimeout(timer); };
    }, [url, open]);

    const linkLooksWrong = url.trim() !== "" && !INSTAGRAM_LINK.test(url.trim());

    const submit = async (e) => {
        e.preventDefault();
        if (!preview || save.blocked)
            return;
        setBusy(true);
        setError("");
        try {
            const res = await api.importInstagram(url.trim(), save.destination);
            toast.success(res.message || "Import started", { description: "Follow it in Transfers." });
            window.dispatchEvent(new CustomEvent("remoteTransferAdded"));
            onOpenChange(false);
        }
        catch (err) {
            setError(err.message);
            if (err.status === 403 && save.kind === "vault")
                save.markVaultLocked();
        }
        finally {
            setBusy(false);
        }
    };

    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4 min-w-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Instagram className="w-5 h-5 text-primary"/>Import from Instagram</DialogTitle>
            <DialogDescription>Paste a link to a post, carousel or reel. The server downloads every photo and video in it.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="ig-url">Instagram link</Label>
            <Input id="ig-url" autoFocus inputMode="url" autoComplete="off" placeholder="https://www.instagram.com/reel/…" value={url} onChange={(e) => { setUrl(e.target.value); setError(""); }} disabled={busy}/>
            {linkLooksWrong && <p className="text-xs text-muted-foreground">Use a link to a post (/p/…) or a reel (/reel/…).</p>}
          </div>

          {previewing && (<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin"/>Reading the post…</div>)}

          {preview && (<div className="flex gap-3 p-3 rounded-lg border border-border bg-muted/30 min-w-0" aria-label="Post preview">
              {preview.thumbnail ? (<img src={preview.thumbnail} alt="" className="w-16 h-16 rounded-md object-cover shrink-0 bg-muted"/>) : (<div className="w-16 h-16 rounded-md bg-muted shrink-0 flex items-center justify-center"><Instagram className="w-6 h-6 text-muted-foreground"/></div>)}
              <div className="min-w-0 flex-1 grid content-start gap-0.5">
                <p className="text-sm font-semibold truncate">@{preview.owner}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {preview.items.length === 1 && preview.items[0]?.is_video ? <Video className="w-3.5 h-3.5"/> : <Images className="w-3.5 h-3.5"/>}
                  {describe(preview)}
                </p>
                {preview.caption && <p className="text-xs text-muted-foreground line-clamp-2 break-words">{preview.caption}</p>}
              </div>
            </div>)}

          {save.field}

          {error && (<div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-destructive/25 bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/><span className="min-w-0 break-words">{error}</span>
            </div>)}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !preview || save.blocked}>
              {busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin"/>Starting…</> : preview && preview.items.length > 1 ? `Import ${preview.items.length} items` : "Import"}
            </Button>
          </DialogFooter>
        </form>
        {save.dialogs}
      </DialogContent>
    </Dialog>);
};
