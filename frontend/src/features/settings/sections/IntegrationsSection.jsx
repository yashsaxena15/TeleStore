import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Plus, Unlink, FolderOpen, Laptop, BookOpen, Instagram, Clapperboard, Upload, Trash2, RefreshCw, ListVideo } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ConnectCloudModal } from "@/features/cloud/ConnectCloudModal";
import { WebDAVMountDialog } from "@/features/cloud/WebDAVMountDialog";
import { useCloudAccounts, useIsOwner, useUserProfile } from "@/hooks/useShellData";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { SettingsPanel, Field, CopyValue, StatusPill } from "../SettingsUi";
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

// The owner signs in one Instagram account; the server uses it for every "Import from Instagram"
const InstagramPanel = () => {
    const queryClient = useQueryClient();
    const { data: session } = useQuery({ queryKey: ["instagramSession"], queryFn: api.getInstagramSession, staleTime: 60000 });
    const [form, setForm] = useState(null); // { username, password, code, needsCode }
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["instagramSession"] });
    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            const res = form.browser ? await api.instagramBrowserSession(form.sessionid)
                : form.needsCode ? await api.instagramTwoFactor(form.code) : await api.instagramLogin(form.username, form.password);
            if (res.needs_2fa) {
                setForm({ ...form, password: "", needsCode: true, code: "" });
                return;
            }
            toast.success(`Instagram connected as @${res.username}`);
            setForm(null);
            refresh();
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    };
    const disconnect = async () => {
        try {
            await api.instagramLogout();
            toast.success("Instagram disconnected");
            refresh();
        }
        catch (err) {
            toast.error(err.message);
        }
    };
    const connected = Boolean(session?.connected);
    return (<SettingsPanel icon={Instagram} title="Instagram" description="Instagram only lets signed-in accounts download posts, so imports use the account connected here" actions={connected ? (<Button variant="outline" size="sm" className="h-8" onClick={disconnect}><Unlink className="w-3.5 h-3.5 mr-1.5"/>Disconnect</Button>) : !form && (<Button size="sm" className="h-8" onClick={() => { setForm({ username: "", password: "" }); setError(""); }}><Plus className="w-3.5 h-3.5 mr-1.5"/>Connect</Button>)}>
      {connected ? (<p className="text-sm flex flex-wrap items-center gap-2"><StatusPill tone="success">Connected</StatusPill>Imports use <span className="font-medium">@{session.username}</span>.</p>) : !form ? (<p className="text-sm text-muted-foreground">Not connected. Use a spare Instagram account rather than your personal one: Instagram can limit accounts that download a lot.</p>) : (<form onSubmit={submit} className="grid gap-3 max-w-sm">
          {form.browser ? (<>
              <ol className="text-sm text-muted-foreground list-decimal pl-5 grid gap-1">
                <li>On a computer, sign in at <span className="font-medium text-foreground">instagram.com</span> with the account to use.</li>
                <li>Press F12, open <span className="font-medium text-foreground">Application</span> (Chrome, Edge) or <span className="font-medium text-foreground">Storage</span> (Firefox), then Cookies › https://www.instagram.com.</li>
                <li>Copy the <span className="font-medium text-foreground">Value</span> of the row named <span className="font-mono text-foreground">sessionid</span> and paste it here.</li>
              </ol>
              <Field label="sessionid" htmlFor="ig-session" hint="It works like a password for that Instagram account: paste it only here. Signing out of Instagram in that browser ends it."><Input id="ig-session" autoFocus type="password" autoComplete="off" value={form.sessionid} onChange={(e) => setForm({ ...form, sessionid: e.target.value })}/></Field>
            </>) : form.needsCode ? (<Field label="Code from your authenticator app or SMS" htmlFor="ig-code"><Input id="ig-code" autoFocus inputMode="numeric" autoComplete="one-time-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}/></Field>) : (<>
              <Field label="Instagram username" htmlFor="ig-user"><Input id="ig-user" autoFocus autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}/></Field>
              <Field label="Password" htmlFor="ig-pass" hint="Used once to sign in. TeleStore keeps only Instagram's sign-in session, never the password."><Input id="ig-pass" type="password" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}/></Field>
            </>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || (form.browser ? !form.sessionid.trim() : form.needsCode ? !form.code.trim() : !form.username.trim() || !form.password)}>{busy ? "Signing in…" : form.browser ? "Connect" : form.needsCode ? "Confirm code" : "Sign in"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>
          {!form.needsCode && (<button type="button" className="justify-self-start text-sm text-primary hover:underline" onClick={() => { setForm(form.browser ? { username: "", password: "" } : { browser: true, sessionid: "" }); setError(""); }}>
              {form.browser ? "Sign in with username and password instead" : "Use my browser's sign-in"}
            </button>)}
        </form>)}
    </SettingsPanel>);
};

// yt-dlp downloads (owner): cookies of a signed-in browser, the bot-check helper and updates
const MediaDownloadsPanel = () => {
    const queryClient = useQueryClient();
    const { data: settings } = useQuery({ queryKey: ["mediaSettings"], queryFn: api.getMediaSettings, staleTime: 60000 });
    const fileRef = useRef(null);
    const [busy, setBusy] = useState(""); // "cookies" | "update" | "builtin"
    const [error, setError] = useState("");
    const [showHow, setShowHow] = useState(false);
    const refresh = (data) => queryClient.setQueryData(["mediaSettings"], data);
    const run = async (what, action, done) => {
        setBusy(what);
        setError("");
        try {
            const data = await action();
            refresh(data);
            done?.(data);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy("");
        }
    };
    const upload = (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file)
            run("cookies", () => api.uploadMediaCookies(file), (data) => toast.success(data.youtube_sign_in === "signed_in" ? "Cookies saved. YouTube confirmed the sign-in." : "Cookies saved."));
    };
    const has = Boolean(settings?.has_cookies);
    const signIn = settings?.youtube_sign_in;
    return (<SettingsPanel icon={Clapperboard} title="Video downloads" description="YouTube, YouTube Music and other sites, downloaded by the server with yt-dlp" actions={<>
        <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" aria-label="cookies.txt file" onChange={upload}/>
        <Button size="sm" variant={has ? "outline" : "default"} className="h-8" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}><Upload className="w-3.5 h-3.5 mr-1.5"/>{busy === "cookies" ? "Checking…" : has ? "Replace cookies" : "Add cookies"}</Button>
      </>}>
      <div className="grid gap-3 text-sm">
        <div className="grid gap-1.5">
          <p className="flex flex-wrap items-center gap-2">
            {!has ? <StatusPill tone="muted">No cookies</StatusPill> : signIn === "signed_in" ? <StatusPill tone="success">Signed in</StatusPill> : signIn === "signed_out" ? <StatusPill tone="destructive">Not signed in</StatusPill> : <StatusPill tone="warning">Cookies added</StatusPill>}
            <span className="text-muted-foreground min-w-0">
              {!has ? "Most videos download without them. YouTube sometimes asks servers to prove they aren't a bot, and age-restricted videos and your own private playlists need a sign-in: cookies fix these."
                : signIn === "signed_in" ? `YouTube confirmed the sign-in${settings.cookies_updated_at ? ` (added ${new Date(settings.cookies_updated_at).toLocaleDateString()})` : ""}.`
                    : signIn === "signed_out" ? "YouTube says these cookies aren't signed in. Export them again while signed in."
                        : `Using cookies for ${settings.cookie_sites?.length ? settings.cookie_sites.join(", ") : "your sites"}. YouTube couldn't be asked to confirm the sign-in just now.`}
            </span>
          </p>
          {has && <button type="button" onClick={() => run("cookies", api.removeMediaCookies, () => toast.success("Cookies removed"))} className="justify-self-start text-sm text-destructive hover:underline flex items-center gap-1"><Trash2 className="w-3.5 h-3.5"/>Remove cookies</button>}
          <button type="button" className="justify-self-start text-sm text-primary hover:underline" aria-expanded={showHow} onClick={() => setShowHow(!showHow)}>How to get a cookies.txt</button>
          {showHow && (<ol className="text-sm text-muted-foreground list-decimal pl-5 grid gap-1">
              <li>Use a spare Google account, not your main one: heavy downloading can get an account flagged.</li>
              <li>Install the <span className="font-medium text-foreground">Get cookies.txt LOCALLY</span> extension (Chrome, Edge, or Firefox on Android).</li>
              <li>In a private window, open <span className="font-medium text-foreground">youtube.com</span> (not music.youtube.com) and sign in, until your picture shows at the top right.</li>
              <li>On that tab, open the extension and export the cookies for the current site.</li>
              <li>Close the private window without signing out (signing out ends the cookies), then press Add cookies here.</li>
            </ol>)}
        </div>

        <p className="flex flex-wrap items-center gap-2">
          {settings?.pot_helper ? <StatusPill tone="success">Bot-check helper running</StatusPill> : <StatusPill tone="warning">Bot-check helper not running</StatusPill>}
          <span className="text-muted-foreground">{settings?.pot_helper ? "It answers YouTube's \"prove you're not a bot\" checks for the server." : "Start the pot service from docker-compose; YouTube blocks the server more often without it."}</span>
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-muted-foreground">yt-dlp {settings?.version || "…"}{settings?.updated && settings?.builtin_version ? ` (updated; built-in ${settings.builtin_version})` : ""}</span>
          <Button size="sm" variant="outline" className="h-8" disabled={Boolean(busy)} onClick={() => run("update", api.updateMediaDownloader, (data) => toast.success(`yt-dlp is now ${data.version}`))}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5${busy === "update" ? " animate-spin" : ""}`}/>{busy === "update" ? "Updating…" : "Update yt-dlp"}
          </Button>
          {settings?.updated && <button type="button" disabled={Boolean(busy)} onClick={() => run("builtin", api.useBuiltinMediaDownloader, (data) => toast.success(`Back to the built-in yt-dlp ${data.version}`))} className="text-sm text-primary hover:underline">Use the built-in version</button>}
        </div>
        <p className="text-xs text-muted-foreground -mt-1">Sites change often. When downloads start failing everywhere, update yt-dlp; downloads that are running finish first.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </SettingsPanel>);
};

const describeChoice = (choice) => {
    if (!choice)
        return "";
    if (choice.mode === "audio")
        return (choice.audio_format || "mp3").toUpperCase();
    return choice.quality && choice.quality !== "best" ? `${choice.quality}p video` : "Best video";
};

// Playlists and channels that download their new videos by themselves (every user, their own)
const SyncedPlaylistsPanel = () => {
    const queryClient = useQueryClient();
    const { data } = useQuery({ queryKey: ["mediaSyncs"], queryFn: api.getMediaSyncs, staleTime: 30000 });
    const [busy, setBusy] = useState(null);
    const syncs = data?.syncs || [];
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["mediaSyncs"] });
    const act = async (id, action, message) => {
        setBusy(id);
        try {
            const res = await action();
            if (message)
                toast.success(typeof message === "function" ? message(res) : message);
            if (res?.new)
                window.dispatchEvent(new CustomEvent("remoteTransferAdded"));
            refresh();
        }
        catch (err) {
            toast.error(err.message);
        }
        finally {
            setBusy(null);
        }
    };
    if (!syncs.length)
        return null;
    return (<SettingsPanel icon={ListVideo} title="Synced playlists" description={`New videos are downloaded by themselves; each one is checked every ${data?.every_hours || 6} hours`}>
      <ul className="divide-y divide-border">
        {syncs.map((s) => (<li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 basis-56 grid gap-0.5">
              <p className="text-sm font-medium truncate">{s.title || s.url}</p>
              <p className="text-xs text-muted-foreground truncate">{s.is_channel ? "Channel" : "Playlist"} · {describeChoice(s.choice)} · to {s.destination_label}</p>
              <p className={`text-xs ${s.last_error ? "text-destructive" : "text-muted-foreground"}`}>
                {s.last_error ? s.last_error : s.last_checked ? `Checked ${new Date(s.last_checked).toLocaleString()}${s.last_new_count ? `, ${s.last_new_count} new` : ""}` : "Not checked yet"}
                {!s.enabled && " · Paused"}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-8" disabled={busy === s.id || !s.enabled} onClick={() => act(s.id, () => api.checkMediaSync(s.id), (r) => (r.new ? `${r.new} new video${r.new === 1 ? "" : "s"} queued` : "No new videos"))}>Check now</Button>
              <Button variant="outline" size="sm" className="h-8" disabled={busy === s.id} onClick={() => act(s.id, () => api.setMediaSyncEnabled(s.id, !s.enabled))}>{s.enabled ? "Pause" : "Resume"}</Button>
              <Button variant="outline" size="sm" className="h-8 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive" aria-label={`Stop syncing ${s.title}`} disabled={busy === s.id} onClick={() => act(s.id, () => api.removeMediaSync(s.id), "Stopped syncing")}><Trash2 className="w-3.5 h-3.5"/></Button>
            </div>
          </li>))}
      </ul>
    </SettingsPanel>);
};

export const IntegrationsSection = ({ onOpenDrive }) => {
    const accounts = useCloudAccounts();
    const profile = useUserProfile();
    const isOwner = useIsOwner();
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

      {isOwner && <MediaDownloadsPanel/>}

      <SyncedPlaylistsPanel/>

      {isOwner && <InstagramPanel/>}

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
