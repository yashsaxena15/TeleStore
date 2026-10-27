import { useState } from "react";
import { UserRound, Send, KeyRound, Check, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TelegramVerificationDialog } from "@/features/auth/TelegramVerificationDialog";
import { useUserProfile, displayName } from "@/hooks/useShellData";
import { api } from "@/lib/api";
import { SettingsPanel, Field, ValueBox, StatusPill } from "../SettingsUi";
import { errorMessage } from "../errorMessage";
import { DevicesPanel } from "./DevicesPanel";

const MIN_PASSWORD = 6;

const ChangePasswordDialog = ({ open, onOpenChange, username }) => {
    const empty = { current: "", next: "", confirm: "" };
    const [form, setForm] = useState(empty);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const set = (key) => (e) => {
        setForm({ ...form, [key]: e.target.value });
        setError("");
    };
    const close = (o) => {
        if (!o) {
            setForm(empty);
            setError("");
        }
        onOpenChange(o);
    };
    const submit = async (e) => {
        e.preventDefault();
        if (form.next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
        if (form.next !== form.confirm) return setError("The new passwords don't match.");
        setBusy(true);
        try {
            await api.changeUserPassword(username, { current_password: form.current, new_password: form.next });
            toast.success("Password changed");
            close(false);
        }
        catch (err) {
            setError(errorMessage(err, "Couldn't change the password"));
        }
        finally {
            setBusy(false);
        }
    };
    return (<Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Used when you sign in as {username}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Field label="Current password" htmlFor="pw-current" hint="Leave empty if you sign in with Telegram or Google and never set one.">
            <Input id="pw-current" type="password" autoComplete="current-password" value={form.current} onChange={set("current")}/>
          </Field>
          <Field label="New password" htmlFor="pw-new">
            <Input id="pw-new" type="password" autoComplete="new-password" value={form.next} onChange={set("next")} required/>
          </Field>
          <Field label="Repeat new password" htmlFor="pw-confirm">
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required/>
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0 pt-1">
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !form.next || !form.confirm}>{busy ? "Saving…" : "Change password"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};

export const AccountSection = ({ onLogout }) => {
    const profile = useUserProfile();
    const [verifyOpen, setVerifyOpen] = useState(false);
    const [passwordOpen, setPasswordOpen] = useState(false);
    if (!profile) {
        return (<SettingsPanel icon={UserRound} title="Account">
        <p className="text-sm text-muted-foreground">Loading your account…</p>
      </SettingsPanel>);
    }
    const tgName = profile.telegram_username ? `@${profile.telegram_username}` : [profile.telegram_first_name, profile.telegram_last_name].filter(Boolean).join(" ");
    return (<div className="grid gap-4">
      <SettingsPanel icon={UserRound} title="Account" description="Who you're signed in as" actions={onLogout && <Button variant="outline" size="sm" className="h-8" onClick={onLogout}><LogOut className="w-3.5 h-3.5 mr-1.5"/>Log out</Button>}>
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-primary/15 text-primary font-semibold grid place-items-center overflow-hidden shrink-0">
            {profile.telegram_profile_picture ? <img src={profile.telegram_profile_picture} alt="" className="w-full h-full object-cover"/> : displayName(profile).charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{displayName(profile)}</p>
            <p className="text-xs text-muted-foreground truncate">{profile.email || profile.username}</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Username"><ValueBox>{profile.username}</ValueBox></Field>
          <Field label="Email"><ValueBox>{profile.email || <span className="text-muted-foreground">Not set</span>}</ValueBox></Field>
        </div>
        <Field label="Password">
          <div>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setPasswordOpen(true)}><KeyRound className="w-3.5 h-3.5 mr-1.5"/>Change password</Button>
          </div>
        </Field>
      </SettingsPanel>

      <DevicesPanel />

      <SettingsPanel icon={Send} title="Telegram" description="Connect your Telegram account so files you send to the bots land in your Inbox.">
        {profile.telegram_user_id ? (<div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="success" icon={Check}>Connected</StatusPill>
              <span className="text-sm font-medium">{tgName || "Telegram account"}</span>
              <span className="text-xs font-mono text-muted-foreground">ID {profile.telegram_user_id}</span>
            </div>
            <div><Button variant="outline" size="sm" className="h-8" onClick={() => setVerifyOpen(true)}>Re-verify</Button></div>
          </div>) : (<div className="flex flex-wrap items-center gap-3">
            <StatusPill tone="warning">Not connected</StatusPill>
            <Button size="sm" className="h-8" onClick={() => setVerifyOpen(true)}><Send className="w-3.5 h-3.5 mr-1.5"/>Connect Telegram</Button>
          </div>)}
      </SettingsPanel>

      <TelegramVerificationDialog open={verifyOpen} onOpenChange={setVerifyOpen}/>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} username={profile.username}/>
    </div>);
};
