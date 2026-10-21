import { useEffect, useState } from "react";
import { Users, UserPlus, MoreHorizontal, Mail, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, mapUser } from "@/lib/api";
import logger from "@/lib/logger";
import { cn } from "@/lib/utils";
import { SettingsPanel, Field, Segmented } from "../SettingsUi";
import { errorMessage } from "../errorMessage";

const MIN_PASSWORD = 6;
const LOGIN_TYPES = [{ value: "local", label: "Username & password" }, { value: "google", label: "Google sign-in" }];

const AddUserDialog = ({ open, onOpenChange, onAdded }) => {
    const empty = { username: "", email: "", password: "", canUpload: true };
    const [type, setType] = useState("local");
    const [form, setForm] = useState(empty);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const set = (patch) => {
        setForm({ ...form, ...patch });
        setError("");
    };
    const close = () => {
        setForm(empty);
        setType("local");
        setError("");
        onOpenChange(false);
    };
    const submit = async (e) => {
        e.preventDefault();
        if (type === "local" && form.password.length < MIN_PASSWORD) return setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
        setBusy(true);
        try {
            const added = await api.addUser({
                ...(type === "local" ? { username: form.username.trim(), password: form.password } : {}),
                email: form.email.trim(),
                can_upload: form.canUpload,
            });
            onAdded(added);
            toast.success(`${added.username || form.email.trim()} added`);
            close();
        }
        catch (err) {
            setError(errorMessage(err, "Couldn't add the user"));
        }
        finally {
            setBusy(false);
        }
    };
    const valid = form.email.trim() && (type === "google" || (form.username.trim() && form.password));
    return (<Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>They get their own private library, empty to start. To upload, they connect Telegram and add the bot to their own group once they sign in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Field label="How they sign in"><div><Segmented label="How they sign in" value={type} options={LOGIN_TYPES} onChange={setType}/></div></Field>
          {type === "local" && (<Field label="Username" htmlFor="nu-username"><Input id="nu-username" className="h-9" autoComplete="off" value={form.username} onChange={(e) => set({ username: e.target.value })}/></Field>)}
          <Field label="Email" htmlFor="nu-email" hint={type === "google" ? "They sign in with this Google account." : undefined}>
            <Input id="nu-email" type="email" className="h-9" value={form.email} onChange={(e) => set({ email: e.target.value })}/>
          </Field>
          {type === "local" && (<Field label="Password" htmlFor="nu-password"><Input id="nu-password" type="password" autoComplete="new-password" className="h-9" value={form.password} onChange={(e) => set({ password: e.target.value })}/></Field>)}
          <label className="flex items-start gap-2.5 text-sm pt-1">
            <Switch className="mt-0.5" checked={form.canUpload} onCheckedChange={(v) => set({ canUpload: v })}/>
            <span>Can upload<span className="block text-xs text-muted-foreground">Uploads, cloud leeches and torrents, Drive transfers, compressing. Uses your bots and bandwidth.</span></span>
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0 pt-1">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={busy || !valid}>{busy ? "Adding…" : "Add user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};

const EditEmailDialog = ({ user, onOpenChange, onSave }) => {
    const [email, setEmail] = useState("");
    useEffect(() => setEmail(user?.email || ""), [user]);
    return (<Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Email for {user?.username}</DialogTitle>
          <DialogDescription>Google sign-in users sign in with this address.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSave(user, { email: email.trim() }); }} className="grid gap-3">
          <Input type="email" className="h-9" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus aria-label="Email"/>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!email.trim() || email.trim() === user?.email}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};

const SetPasswordDialog = ({ user, onOpenChange }) => {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        setCurrent("");
        setNext("");
        setError("");
    }, [user]);
    const submit = async (e) => {
        e.preventDefault();
        if (next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
        setBusy(true);
        try {
            await api.changeUserPassword(user.id, { current_password: current, new_password: next });
            toast.success(`Password changed for ${user.username}`);
            onOpenChange(false);
        }
        catch (err) {
            setError(errorMessage(err, "Couldn't change the password"));
        }
        finally {
            setBusy(false);
        }
    };
    return (<Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password for {user?.username}</DialogTitle>
          <DialogDescription>The server asks for their current password when they already have one.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Field label="Their current password" htmlFor="up-current"><Input id="up-current" type="password" autoComplete="off" className="h-9" value={current} onChange={(e) => { setCurrent(e.target.value); setError(""); }}/></Field>
          <Field label="New password" htmlFor="up-new"><Input id="up-new" type="password" autoComplete="new-password" className="h-9" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }}/></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !next}>{busy ? "Saving…" : "Change password"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};

// What a user still has to do before they can upload
const setupStatus = (user) => {
    if (!user.hasTelegram)
        return { ready: false, label: "Needs Telegram", hint: "They connect their Telegram account in Settings › Account." };
    if (!user.hasIndexChat)
        return { ready: false, label: "Needs index chat", hint: "They add the bot to their own Telegram group in Settings › Connection." };
    return { ready: true, label: "Ready to upload", hint: "Telegram connected and index chat set." };
};

export const UsersSection = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [addOpen, setAddOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [passwordFor, setPasswordFor] = useState(null);
    const [deleting, setDeleting] = useState(null);
    useEffect(() => {
        api.getUsers()
            .then((r) => setUsers(r.users))
            .catch((err) => {
            logger.error("Failed to fetch users:", err);
            toast.error("Couldn't load users");
        })
            .finally(() => setLoading(false));
    }, []);
    // Saves email / Active / Can upload; the table shows the change right away and rolls back on failure
    const saveUser = async (user, patch) => {
        const before = users;
        setUsers(users.map((u) => (u.id === user.id ? { ...u, ...patch } : u)));
        setEditing(null);
        const body = {};
        if (patch.email !== undefined) body.email = patch.email;
        if (patch.active !== undefined) body.active = patch.active;
        if (patch.canUpload !== undefined) body.can_upload = patch.canUpload;
        try {
            await api.updateUser(user.id, body);
            if (patch.email) toast.success("Email updated");
            if (patch.active !== undefined) toast.success(patch.active ? `${user.username || user.email} can sign in again` : `${user.username || user.email} is turned off`);
            if (patch.canUpload !== undefined) toast.success(patch.canUpload ? `Uploads turned on for ${user.username || user.email}` : `Uploads turned off for ${user.username || user.email}`);
        }
        catch (err) {
            setUsers(before);
            toast.error(errorMessage(err, "Couldn't update the user"));
        }
    };
    const remove = async () => {
        const user = deleting;
        setDeleting(null);
        try {
            await api.deleteUser(user.id);
            setUsers((list) => list.filter((u) => u.id !== user.id));
            toast.success(`${user.username || user.email} removed`);
        }
        catch (err) {
            toast.error(errorMessage(err, "Couldn't remove the user"));
        }
    };
    const added = (raw) => setUsers((list) => [...list, mapUser(raw)]);
    return (<SettingsPanel icon={Users} title="Users" description="Each person has their own private library; nobody sees anyone else's files." actions={<Button size="sm" className="h-8" onClick={() => setAddOpen(true)}><UserPlus className="w-3.5 h-3.5 mr-1.5"/>Add user</Button>}>
      {loading ? (<p className="text-sm text-muted-foreground">Loading users…</p>) : users.length === 0 ? (<p className="text-sm text-muted-foreground">No users yet.</p>) : (<div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="font-semibold px-4 py-2">User</th>
                <th className="font-semibold px-2 py-2 hidden md:table-cell">Telegram</th>
                <th className="font-semibold px-2 py-2 text-center w-16" title="Turned-off accounts can't sign in. Their files are kept.">Active</th>
                <th className="font-semibold px-2 py-2 text-center w-20" title="Uploads, cloud leeches, Drive transfers and compressing">Can upload</th>
                <th className="w-12"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isAdmin = user.username === "admin";
                const locked = user.isOwner || isAdmin;
                const setup = setupStatus(user);
                const name = user.username || user.email || "Unknown";
                return (<tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5 max-w-0 w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{name}</span>
                        <span className={cn("shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded", user.userType === "google" ? "bg-info/15 text-info" : "bg-muted text-muted-foreground")}>{user.userType === "google" ? "Google" : "Local"}</span>
                      </div>
                      {user.email && user.email !== name && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
                      <p className={cn("text-[11px] mt-0.5", setup.ready ? "text-success" : "text-warning")} title={setup.hint}>{setup.label}</p>
                    </td>
                    <td className="px-2 py-2.5 hidden md:table-cell whitespace-nowrap text-muted-foreground">{user.telegramUsername ? `@${user.telegramUsername}` : "Not connected"}</td>
                    <td className="px-2 py-2.5 text-center" title={locked ? "The owner account can't be turned off" : undefined}><Switch checked={user.active} disabled={locked} onCheckedChange={(v) => saveUser(user, { active: v })} aria-label={`${name} is active`}/></td>
                    <td className="px-2 py-2.5 text-center" title={locked ? "The owner account can always upload" : undefined}><Switch checked={user.canUpload} disabled={locked} onCheckedChange={(v) => saveUser(user, { canUpload: v })} aria-label={`${name} can upload`}/></td>
                    <td className="pr-3 py-2.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Actions for ${name}`}><MoreHorizontal className="w-4 h-4"/></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="gap-2" onSelect={() => setEditing(user)}><Mail className="w-4 h-4 text-muted-foreground"/>Change email</DropdownMenuItem>
                          {user.userType !== "google" && <DropdownMenuItem className="gap-2" onSelect={() => setPasswordFor(user)}><KeyRound className="w-4 h-4 text-muted-foreground"/>Change password</DropdownMenuItem>}
                          {!isAdmin && (<>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={() => setDeleting(user)}><Trash2 className="w-4 h-4"/>Remove user</DropdownMenuItem>
                            </>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>);
            })}
            </tbody>
          </table>
        </div>)}

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} onAdded={added}/>
      <EditEmailDialog user={editing} onOpenChange={(o) => !o && setEditing(null)} onSave={saveUser}/>
      <SetPasswordDialog user={passwordFor} onOpenChange={(o) => !o && setPasswordFor(null)}/>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.username || deleting?.email}?</AlertDialogTitle>
            <AlertDialogDescription>They can no longer sign in. Files they uploaded stay where they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPanel>);
};
