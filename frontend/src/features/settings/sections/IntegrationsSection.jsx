import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cloud, Plus, Unlink, FolderOpen, Laptop, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ConnectCloudModal } from "@/features/cloud/ConnectCloudModal";
import { WebDAVMountDialog } from "@/features/cloud/WebDAVMountDialog";
import { useCloudAccounts, useUserProfile } from "@/hooks/useShellData";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { SettingsPanel, Field, CopyValue } from "../SettingsUi";
import { defaultBackendUrl, savedBackendUrl } from "../connection";

const DriveRow = ({ account, onOpen, onUnlink }) => {
    const { data: quota } = useQuery({
        queryKey: ["cloudStorageQuota", account.id],
        queryFn: () => api.fetchCloudStorageQuota(account.id),
        staleTime: 60000,
    });
    const used = quota ? (quota.usageInDrive || quota.usage || 0) : 0;
    const limit = quota?.limit || 0;
    const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return (<li className="grid gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Cloud className="w-4 h-4 text-info shrink-0"/>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-medium truncate">{account.account_name}</p>
          {account.account_email && <p className="text-xs text-muted-foreground truncate">{account.account_email}</p>}
        </div>
        {limit > 0 && <span className="text-xs font-mono text-muted-foreground">{formatBytes(used, 1)} / {formatBytes(limit, 1)}</span>}
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-8" onClick={onOpen}><FolderOpen className="w-3.5 h-3.5 mr-1.5"/>Open</Button>
          <Button variant="outline" size="sm" className="h-8 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive" onClick={onUnlink}><Unlink className="w-3.5 h-3.5 mr-1.5"/>Unlink</Button>
        </div>
      </div>
      {limit > 0 && (<div className="h-1.5 rounded-full bg-muted overflow-hidden" role="meter" aria-label={`${account.account_name} storage used`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={percent >= 90 ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${percent}%` }}/>
        </div>)}
    </li>);
};

export const IntegrationsSection = ({ onOpenDrive }) => {
    const accounts = useCloudAccounts();
    const profile = useUserProfile();
    const [connectOpen, setConnectOpen] = useState(false);
    const [guidesOpen, setGuidesOpen] = useState(false);
    const [unlinking, setUnlinking] = useState(null);
    // WebDAV is served from the server's root, which is the backend URL in the desktop app
    const webdavUrl = `${(savedBackendUrl() || defaultBackendUrl()).replace(/\/+$/, "").replace(/\/api$/, "")}/webdav`;
    const unlink = async () => {
        const account = unlinking;
        setUnlinking(null);
        try {
            await api.disconnectCloudAccount(account.id);
            toast.success(`${account.account_name} unlinked`);
            window.dispatchEvent(new Event("cloudAccountsChanged"));
        }
        catch (err) {
            toast.error(err.message || "Couldn't unlink the account");
        }
    };
    return (<div className="grid gap-4">
      <SettingsPanel icon={Cloud} title="Google Drive" description="Browse Drive next to your Telegram files and copy between them" actions={<Button size="sm" className="h-8" onClick={() => setConnectOpen(true)}><Plus className="w-3.5 h-3.5 mr-1.5"/>Connect</Button>}>
        {accounts.length === 0 ? (<p className="text-sm text-muted-foreground">No Drive accounts connected.</p>) : (<ul className="divide-y divide-border">
            {accounts.map((account) => (<DriveRow key={account.id} account={account} onOpen={() => onOpenDrive(account.id)} onUnlink={() => setUnlinking(account)}/>))}
          </ul>)}
      </SettingsPanel>

      <SettingsPanel icon={Laptop} title="Mount as a drive (WebDAV)" description="Open TeleStore in Windows Explorer, Finder or an Android file manager" actions={<Button variant="outline" size="sm" className="h-8" onClick={() => setGuidesOpen(true)}><BookOpen className="w-3.5 h-3.5 mr-1.5"/>Setup guides</Button>}>
        <div className="grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          <Field label="WebDAV address"><CopyValue label="WebDAV address" value={webdavUrl}/></Field>
          <Field label="Username"><CopyValue label="username" value={profile?.username || "admin"}/></Field>
        </div>
        <p className="text-xs text-muted-foreground">Sign in with the same password you use here.</p>
      </SettingsPanel>

      <ConnectCloudModal open={connectOpen} onOpenChange={setConnectOpen} onSuccess={() => window.dispatchEvent(new Event("cloudAccountsChanged"))}/>
      <WebDAVMountDialog open={guidesOpen} onOpenChange={setGuidesOpen} username={profile?.username || "admin"}/>
      <AlertDialog open={Boolean(unlinking)} onOpenChange={(o) => !o && setUnlinking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink {unlinking?.account_name}?</AlertDialogTitle>
            <AlertDialogDescription>TeleStore stops showing this Drive. Nothing is deleted from Google Drive, and you can connect it again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={unlink} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Unlink</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>);
};
