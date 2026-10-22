import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Cloud, Folder, HardDrive, Lock, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCloudAccounts } from "@/hooks/useShellData";
import { FolderPickerModal } from "@/features/explorer/dialogs/FolderPickerModal";
import { DriveFolderPicker } from "./DriveFolderPicker";

const VaultModal = lazy(() => import("@/features/vault/VaultModal").then((m) => ({ default: m.VaultModal })));

const PLACES = [
    { kind: "home", label: "Home", icon: HardDrive },
    { kind: "vault", label: "Private Vault", icon: ShieldCheck },
    { kind: "gdrive", label: "Google Drive", icon: Cloud },
];

/**
 * Where a server download is saved: a Home folder, a Private Vault folder (asks to unlock) or a
 * Google Drive folder. Resets to `defaultDestination` each time the dialog opens:
 * { kind, path } or { kind: "gdrive", accountId, folderId, folderName }.
 *
 * Returns { destination, blocked, field, dialogs }: the body for the API, whether it can't be used
 * yet, the "Save to" controls (inside the form) and the folder/PIN dialogs (outside the form).
 */
export function useSaveDestination({ open, defaultDestination, userEmail, onChange }) {
    const accounts = useCloudAccounts();
    const [kind, setKind] = useState("home");
    const [homePath, setHomePath] = useState("/Home");
    const [vaultPath, setVaultPath] = useState("/Vault");
    const [drive, setDrive] = useState({ accountId: "", folderId: "my_drive", folderName: "My Drive" });
    const [vaultUnlocked, setVaultUnlocked] = useState(null);
    const [picker, setPicker] = useState(null); // "home" | "vault" | "gdrive"
    const [unlocking, setUnlocking] = useState(false);

    useEffect(() => {
        if (!open)
            return;
        const d = defaultDestination || { kind: "home", path: "/Home" };
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

    const account = accounts.find((a) => a.id === drive.accountId);
    const blocked = kind === "vault" ? vaultUnlocked !== true : kind === "gdrive" ? !account : false;
    const destination = kind === "gdrive"
        ? { kind, account_id: drive.accountId, folder_id: drive.folderId, folder_name: drive.folderName }
        : { kind, path: kind === "vault" ? vaultPath : homePath };
    const where = kind === "gdrive" ? `${account?.account_name || "Google Drive"} / ${drive.folderName}` : kind === "vault" ? vaultPath.replace(/^\/Vault/, "Private Vault") : homePath;
    const choose = (k) => {
        setKind(k);
        onChange?.();
    };

    const field = (<div className="grid gap-2">
      <Label id="save-place">Save to</Label>
      <div role="radiogroup" aria-labelledby="save-place" className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted/60">
        {PLACES.map(({ kind: k, label, icon: Icon }) => (<button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => choose(k)} className={cn("flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors min-w-0", kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
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
    </div>);

    // Rendered outside the caller's <form>: submits inside these dialogs would otherwise bubble to it
    const dialogs = (<>
      <FolderPickerModal isOpen={picker === "home" || picker === "vault"} onClose={() => setPicker(null)} roots={[picker === "vault" ? "Vault" : "Home"]} currentSelectedPath={picker === "vault" ? vaultPath : homePath} onSelectPath={(path) => (picker === "vault" ? setVaultPath(path) : setHomePath(path))}/>
      {account && <DriveFolderPicker open={picker === "gdrive"} onOpenChange={(o) => !o && setPicker(null)} accountId={account.id} accountName={account.account_name} onSelect={(f) => setDrive((d) => ({ ...d, folderId: f.id, folderName: f.name }))}/>}
      {unlocking && (<Suspense fallback={null}>
          <VaultModal isOpen={unlocking} onClose={() => setUnlocking(false)} userEmail={userEmail} onSuccess={() => {
                setUnlocking(false);
                setVaultUnlocked(true);
                onChange?.();
                window.dispatchEvent(new Event("vaultStateChanged"));
            }}/>
        </Suspense>)}
    </>);

    return { kind, destination, blocked, field, dialogs, markVaultLocked: () => setVaultUnlocked(false) };
}
