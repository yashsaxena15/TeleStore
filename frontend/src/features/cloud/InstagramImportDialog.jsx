import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Cloud, Folder, HardDrive, Images, Instagram, Loader2, Lock, ShieldCheck, Video } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCloudAccounts } from "@/hooks/useShellData";
import { FolderPickerModal } from "@/features/explorer/dialogs/FolderPickerModal";
import { DriveFolderPicker } from "./DriveFolderPicker";

const VaultModal = lazy(() => import("@/features/vault/VaultModal").then((m) => ({ default: m.VaultModal })));

const INSTAGRAM_LINK = /^(https?:\/\/)?(www\.|m\.)?(instagram\.com|instagr\.am)\/([A-Za-z0-9._]+\/)?(p|reels?|tv)\/[A-Za-z0-9_-]{5,}/i;

const PLACES = [
    { kind: "home", label: "Home", icon: HardDrive },
    { kind: "vault", label: "Private Vault", icon: ShieldCheck },
    { kind: "gdrive", label: "Google Drive", icon: Cloud },
];

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
    const accounts = useCloudAccounts();
    const [url, setUrl] = useState("");
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState("");
    const [kind, setKind] = useState("home");
    const [homePath, setHomePath] = useState("/Home");
    const [vaultPath, setVaultPath] = useState("/Vault");
    const [drive, setDrive] = useState({ accountId: "", folderId: "my_drive", folderName: "My Drive" });
    const [vaultUnlocked, setVaultUnlocked] = useState(null);
    const [picker, setPicker] = useState(null); // "home" | "vault" | "gdrive"
    const [unlocking, setUnlocking] = useState(false);
    const [busy, setBusy] = useState(false);
    const lastPreviewed = useRef("");

    useEffect(() => {
        if (!open)
            return;
        const d = defaultDestination || { kind: "home", path: "/Home" };
        setUrl("");
        setPreview(null);
        setError("");
        lastPreviewed.current = "";
        setKind(d.kind);
        setHomePath(d.kind === "home" ? d.path : "/Home");
        setVaultPath(d.kind === "vault" ? d.path : "/Vault");
        setDrive(d.kind === "gdrive" ? { accountId: d.accountId, folderId: d.folderId, folderName: d.folderName } : { accountId: "", folderId: "my_drive", folderName: "My Drive" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
    }, [open]);

    // The first connected Drive is the default when none was open
    useEffect(() => {
        if (!drive.accountId && accounts[0])
            setDrive((d) => ({ ...d, accountId: accounts[0].id }));
    }, [accounts, drive.accountId]);

    // Saving to the vault needs it unlocked
    useEffect(() => {
        if (!open || kind !== "vault")
            return;
        let stale = false;
        api.getVaultStatus().then((s) => !stale && setVaultUnlocked(Boolean(s.is_unlocked))).catch(() => !stale && setVaultUnlocked(false));
        return () => { stale = true; };
    }, [open, kind]);

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
    const account = accounts.find((a) => a.id === drive.accountId);
    const blocked = kind === "vault" ? vaultUnlocked !== true : kind === "gdrive" ? !account : false;

    const destination = () => {
        if (kind === "gdrive")
            return { kind, account_id: drive.accountId, folder_id: drive.folderId, folder_name: drive.folderName };
        return { kind, path: kind === "vault" ? vaultPath : homePath };
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!preview || blocked)
            return;
        setBusy(true);
        setError("");
        try {
            const res = await api.importInstagram(url.trim(), destination());
            toast.success(res.message || "Import started", { description: "Follow it in Transfers." });
            window.dispatchEvent(new CustomEvent("remoteTransferAdded"));
            onOpenChange(false);
        }
        catch (err) {
            setError(err.message);
            if (err.status === 403 && kind === "vault")
                setVaultUnlocked(false);
        }
        finally {
            setBusy(false);
        }
    };

    const where = kind === "gdrive" ? `${account?.account_name || "Google Drive"} / ${drive.folderName}` : kind === "vault" ? vaultPath.replace(/^\/Vault/, "Private Vault") : homePath;

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
                  {preview.items.length > 1 ? <Images className="w-3.5 h-3.5"/> : preview.items[0]?.is_video ? <Video className="w-3.5 h-3.5"/> : <Images className="w-3.5 h-3.5"/>}
                  {describe(preview)}
                </p>
                {preview.caption && <p className="text-xs text-muted-foreground line-clamp-2 break-words">{preview.caption}</p>}
              </div>
            </div>)}

          <div className="grid gap-2">
            <Label id="ig-place">Save to</Label>
            <div role="radiogroup" aria-labelledby="ig-place" className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted/60">
              {PLACES.map(({ kind: k, label, icon: Icon }) => (<button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setError(""); }} className={cn("flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors min-w-0", kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="w-3.5 h-3.5 shrink-0"/><span className="truncate">{label}</span>
                </button>))}
            </div>

            {kind === "gdrive" && accounts.length > 1 && (<select aria-label="Google Drive account" value={drive.accountId} onChange={(e) => setDrive({ accountId: e.target.value, folderId: "my_drive", folderName: "My Drive" })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}{a.account_email ? ` (${a.account_email})` : ""}</option>)}
              </select>)}

            {kind === "gdrive" && !account ? (<p className="text-xs text-muted-foreground">No Google Drive is connected. Connect one in Settings › Integrations.</p>) : kind === "vault" && vaultUnlocked === false ? (<div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-warning/30 bg-warning/10 text-sm">
                <span className="flex items-center gap-2 min-w-0"><Lock className="w-4 h-4 text-warning shrink-0"/>Your vault is locked.</span>
                <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setUnlocking(true)}>Unlock</Button>
              </div>) : (<button type="button" onClick={() => setPicker(kind)} disabled={kind === "vault" && vaultUnlocked !== true} className="flex items-center gap-2 p-2.5 rounded-lg border border-input bg-background hover:bg-accent text-left min-w-0" aria-label={`Folder: ${where}. Change`}>
                <Folder className="w-4 h-4 text-primary shrink-0"/>
                <span className="text-sm truncate flex-1">{where}</span>
                <span className="text-xs text-muted-foreground shrink-0">Change</span>
              </button>)}
          </div>

          {error && (<div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-destructive/25 bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/><span className="min-w-0 break-words">{error}</span>
            </div>)}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !preview || blocked}>
              {busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin"/>Starting…</> : preview && preview.items.length > 1 ? `Import ${preview.items.length} items` : "Import"}
            </Button>
          </DialogFooter>
        </form>

        <FolderPickerModal isOpen={picker === "home" || picker === "vault"} onClose={() => setPicker(null)} roots={[picker === "vault" ? "Vault" : "Home"]} currentSelectedPath={picker === "vault" ? vaultPath : homePath} onSelectPath={(path) => (picker === "vault" ? setVaultPath(path) : setHomePath(path))}/>
        {account && <DriveFolderPicker open={picker === "gdrive"} onOpenChange={(o) => !o && setPicker(null)} accountId={account.id} accountName={account.account_name} onSelect={(f) => setDrive((d) => ({ ...d, folderId: f.id, folderName: f.name }))}/>}
        {unlocking && (<Suspense fallback={null}>
            <VaultModal isOpen={unlocking} onClose={() => setUnlocking(false)} userEmail={userEmail} onSuccess={() => {
                setUnlocking(false);
                setVaultUnlocked(true);
                setError("");
                window.dispatchEvent(new Event("vaultStateChanged"));
            }}/>
          </Suspense>)}
      </DialogContent>
    </Dialog>);
};
