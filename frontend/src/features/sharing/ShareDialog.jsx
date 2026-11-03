// The Share dialog (like Google Drive's): people with Viewer or Editor access, and "Anyone with
// the link" (view only) with its options. Mounted once in FileExplorer; open it with requestShare().
import { useEffect, useRef, useState } from "react";
import { Copy, Globe, Loader2, Lock, RotateCcw, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { onShareRequest } from "./requestShare";
import { EXPIRY_OPTIONS, ROLES, dateInputValue, expiryBody, expiryText, linkStateMessage, parseLimit, shareLinkUrl } from "./shareHelpers";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const initial = (m) => (m.name || m.username || m.email || "?").trim().charAt(0).toUpperCase();

const PersonRow = ({ member, busy, onRole, onRemove }) => {
    const label = member.name || member.username;
    return (<li className="flex items-center gap-3 py-2">
      <span className="w-8 h-8 shrink-0 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold" aria-hidden="true">{initial(member)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{[member.username && member.username !== label ? member.username : null, member.email].filter(Boolean).join(" · ")}</p>
      </div>
      <select aria-label={`Role for ${label}`} value={member.role} disabled={busy} onChange={(e) => onRole(e.target.value)} className={cn(SELECT, "h-8 text-xs")}>
        {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={onRemove} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50" aria-label={`Remove ${label}`} title="Remove">
        <X className="w-4 h-4"/>
      </button>
    </li>);
};

const LinkOptions = ({ link, busy, onChange, onCopy, onReset }) => {
    const [expiry, setExpiry] = useState(link.expires_at ? "custom" : "never");
    const [customDate, setCustomDate] = useState(link.expires_at ? dateInputValue(link.expires_at) : "");
    const [limit, setLimit] = useState(link.max_downloads ? String(link.max_downloads) : "");
    // A new link (reset) or a change from elsewhere: follow it
    useEffect(() => {
        setLimit(link.max_downloads ? String(link.max_downloads) : "");
        if (link.expires_at)
            setCustomDate(dateInputValue(link.expires_at));
    }, [link.max_downloads, link.expires_at]);
    const message = linkStateMessage(link.state);
    const url = shareLinkUrl(link.token, window.location.origin);

    const pickExpiry = (value) => {
        setExpiry(value);
        if (value === "custom") {
            if (!customDate) return;
            const body = expiryBody("custom", new Date(), customDate);
            if (body) onChange(body);
            return;
        }
        onChange(expiryBody(value, new Date()));
    };
    const pickDate = (value) => {
        setCustomDate(value);
        const body = expiryBody("custom", new Date(), value);
        if (body) onChange(body);
    };
    const limitOn = Boolean(link.max_downloads);
    const saveLimit = () => {
        const n = parseLimit(limit);
        if (!n) {
            toast.error("Type a number of downloads from 1.");
            setLimit(link.max_downloads ? String(link.max_downloads) : "");
            return;
        }
        if (n !== link.max_downloads) onChange({ max_downloads: n });
    };
    return (<div className="grid gap-3 mt-3 pl-11">
      {message && <p role="status" className="text-xs rounded-md border border-warning/40 bg-warning/10 text-foreground px-2.5 py-2">{message}</p>}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="share-allow-download" className="text-sm">Viewers can download</label>
        <Switch id="share-allow-download" checked={link.allow_download !== false} disabled={busy} onCheckedChange={(on) => onChange({ allow_download: on })}/>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="share-expiry" className="text-sm">Expires</label>
        <div className="flex items-center gap-2">
          <select id="share-expiry" value={expiry} disabled={busy} onChange={(e) => pickExpiry(e.target.value)} className={SELECT}>
            {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {expiry === "custom" && <input type="date" aria-label="Expiry date" value={customDate} min={dateInputValue(new Date())} disabled={busy} onChange={(e) => pickDate(e.target.value)} className={SELECT}/>}
        </div>
      </div>
      {link.expires_at && <p className="-mt-2 text-xs text-muted-foreground text-right">{expiryText(link.expires_at)}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="share-limit-on" className="text-sm">Download limit</label>
        <div className="flex items-center gap-2">
          {limitOn && <Input aria-label="Number of downloads" type="number" min={1} inputMode="numeric" value={limit} disabled={busy} onChange={(e) => setLimit(e.target.value)} onBlur={saveLimit} onKeyDown={(e) => e.key === "Enter" && saveLimit()} className="h-9 w-20"/>}
          <Switch id="share-limit-on" checked={limitOn} disabled={busy} onCheckedChange={(on) => onChange(on ? { max_downloads: 10 } : { clear_limit: true })}/>
        </div>
      </div>
      {limitOn && <p className="-mt-2 text-xs text-muted-foreground text-right">{link.downloads || 0} of {link.max_downloads} downloads used</p>}
      <div className="flex items-center gap-2">
        <Input readOnly aria-label="Link" value={url} onFocus={(e) => e.target.select()} className="h-9 font-mono text-xs"/>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onCopy(url)}><Copy className="w-3.5 h-3.5 mr-1.5"/>Copy link</Button>
      </div>
      <button type="button" disabled={busy} onClick={onReset} className="justify-self-start inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
        <RotateCcw className="w-3.5 h-3.5"/>Reset link
      </button>
    </div>);
};

export const ShareDialog = () => {
    const [target, setTarget] = useState(null); // { item, onChange }
    const [view, setView] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [who, setWho] = useState("");
    const [role, setRole] = useState("viewer");
    const [confirmReset, setConfirmReset] = useState(false);
    const openId = useRef(null);

    useEffect(() => onShareRequest(({ item, onChange }) => {
        openId.current = item.id;
        setTarget({ item, onChange });
        setView(null);
        setWho("");
        setRole("viewer");
        setLoading(true);
        api.getShare(item.id)
            .then((v) => openId.current === item.id && setView(v))
            .catch((err) => {
                toast.error(err.message || "Couldn't load sharing");
                if (openId.current === item.id) setTarget(null);
            })
            .finally(() => openId.current === item.id && setLoading(false));
    }), []);

    const close = () => {
        openId.current = null;
        setTarget(null);
    };
    const itemId = target?.item.id;
    const run = async (call, success) => {
        setBusy(true);
        try {
            const next = await call();
            if (openId.current === itemId) setView(next);
            target?.onChange?.(next);
            if (success) toast.success(success);
            return true;
        }
        catch (err) {
            toast.error(err.message || "Something went wrong");
            return false;
        }
        finally {
            setBusy(false);
        }
    };
    const addPerson = async (e) => {
        e.preventDefault();
        const name = who.trim();
        if (!name) return;
        if (await run(() => api.addShareMember(itemId, name, role), `Shared with ${name}`))
            setWho("");
    };
    const changeLink = (settings) => run(() => api.updateShareLink(itemId, { enabled: true, ...settings }));
    const copy = async (url) => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
        }
        catch {
            toast.error("Couldn't copy the link. Select it and copy it yourself.");
        }
    };

    const name = target?.item.name || view?.item?.name || "";
    const link = view?.link;
    const linkOn = Boolean(link?.enabled);
    const members = view?.members || [];
    const shared = members.length > 0 || linkOn;
    return (<>
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6 break-words">Share “{name}”</DialogTitle>
            <DialogDescription className="sr-only">Choose who can open this {target?.item.type === "folder" ? "folder" : "file"}.</DialogDescription>
          </DialogHeader>
          {loading || !view ? (<div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Loading…</div>) : (<div className="grid gap-5">
              <form onSubmit={addPerson} className="flex flex-wrap gap-2">
                <Input aria-label="Add people" placeholder="Add people by username or email" value={who} onChange={(e) => setWho(e.target.value)} disabled={busy} className="h-9 flex-1 min-w-[12rem]" autoComplete="off"/>
                <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} disabled={busy} className={SELECT}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <Button type="submit" size="sm" className="h-9" disabled={busy || !who.trim()}><UserPlus className="w-3.5 h-3.5 mr-1.5"/>Add</Button>
              </form>

              <section aria-label="People with access">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">People with access</h3>
                {members.length === 0 ? <p className="text-sm text-muted-foreground py-2">Only you.</p> : (<ul className="divide-y divide-border">
                    {members.map((m) => <PersonRow key={m.user_id} member={m} busy={busy} onRole={(r) => run(() => api.changeShareMember(itemId, m.user_id, r))} onRemove={() => run(() => api.removeShareMember(itemId, m.user_id), `${m.name || m.username} removed`)}/>)}
                  </ul>)}
              </section>

              <section aria-label="General access">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">General access</h3>
                <div className="flex items-center gap-3">
                  <span className={cn("w-8 h-8 shrink-0 rounded-full grid place-items-center", linkOn ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")} aria-hidden="true">
                    {linkOn ? <Globe className="w-4 h-4"/> : <Lock className="w-4 h-4"/>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <select aria-label="General access" value={linkOn ? "link" : "restricted"} disabled={busy} onChange={(e) => run(() => api.updateShareLink(itemId, { enabled: e.target.value === "link" }))} className={cn(SELECT, "h-8 border-transparent -ml-2 font-medium hover:border-input")}>
                      <option value="restricted">Restricted</option>
                      <option value="link">Anyone with the link</option>
                    </select>
                    <p className="text-xs text-muted-foreground">{linkOn ? "Anyone on the internet with the link can view." : "Only people added above can open it."}</p>
                  </div>
                </div>
                {linkOn && <LinkOptions key={link.token} link={link} busy={busy} onChange={changeLink} onCopy={copy} onReset={() => setConfirmReset(true)}/>}
              </section>
            </div>)}
          <DialogFooter className="gap-2 sm:justify-between">
            {shared && view ? (<Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => api.stopSharing(itemId), "No longer shared")}>Stop sharing</Button>) : <span/>}
            <Button type="button" onClick={close}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the link?</AlertDialogTitle>
            <AlertDialogDescription>The current link stops working. Anyone who should still have access needs the new one.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(() => api.resetShareLink(itemId), "Link reset")}>Reset link</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>);
};
