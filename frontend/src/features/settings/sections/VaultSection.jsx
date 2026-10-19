import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Lock, LockOpen, KeyRound, Mail, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { SettingsPanel, Field, StatusPill, Segmented } from "../SettingsUi";
import { errorMessage } from "../errorMessage";

const AUTO_LOCK_OPTIONS = [5, 15, 30, 60].map((m) => ({ value: m, label: m === 60 ? "1 hour" : `${m} min` }));

// Tell the file explorer the vault changed (locked, unlocked or new auto-lock time)
const announce = () => window.dispatchEvent(new Event("vaultStateChanged"));

const PinInput = ({ id, value, onChange, autoFocus }) => (<Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={4} autoFocus={autoFocus} className="h-9 w-28 font-mono tracking-[0.4em] text-center" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••"/>);

const isPin = (v) => /^\d{4}$/.test(v);

const ChangePinDialog = ({ open, onOpenChange }) => {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const close = () => {
        setCurrent("");
        setNext("");
        setConfirm("");
        setError("");
        onOpenChange(false);
    };
    const submit = async (e) => {
        e.preventDefault();
        if (next !== confirm) return setError("The new PINs don't match.");
        if (next === current) return setError("Choose a PIN different from the current one.");
        setBusy(true);
        try {
            await api.changeVaultPin(current, next);
            toast.success("Vault PIN changed");
            announce();
            close();
        }
        catch (err) {
            setError(errorMessage(err, "Couldn't change the PIN"));
        }
        finally {
            setBusy(false);
        }
    };
    return (<Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change vault PIN</DialogTitle>
          <DialogDescription>Your files stay as they are; only the PIN that opens them changes.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Field label="Current PIN" htmlFor="pin-current"><PinInput id="pin-current" value={current} onChange={(v) => { setCurrent(v); setError(""); }} autoFocus/></Field>
          <div className="flex flex-wrap gap-4">
            <Field label="New PIN" htmlFor="pin-new"><PinInput id="pin-new" value={next} onChange={(v) => { setNext(v); setError(""); }}/></Field>
            <Field label="Repeat new PIN" htmlFor="pin-confirm"><PinInput id="pin-confirm" value={confirm} onChange={(v) => { setConfirm(v); setError(""); }}/></Field>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0 pt-1">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={busy || !isPin(current) || !isPin(next) || !isPin(confirm)}>{busy ? "Saving…" : "Change PIN"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};

// Two steps: PIN + new address (we send a code there), then the code
const RecoveryEmailDialog = ({ open, onOpenChange, onChanged }) => {
    const [step, setStep] = useState("email");
    const [email, setEmail] = useState("");
    const [pin, setPin] = useState("");
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const close = () => {
        setStep("email");
        setEmail("");
        setPin("");
        setCode("");
        setError("");
        onOpenChange(false);
    };
    const run = async (fn) => {
        setBusy(true);
        setError("");
        try {
            await fn();
        }
        catch (err) {
            setError(errorMessage(err));
        }
        finally {
            setBusy(false);
        }
    };
    const sendCode = (e) => {
        e.preventDefault();
        run(async () => {
            await api.requestRecoveryEmailOtp(email.trim(), pin);
            setStep("code");
        });
    };
    const confirmCode = (e) => {
        e.preventDefault();
        run(async () => {
            const res = await api.confirmRecoveryEmail(email.trim(), pin, code.trim());
            toast.success(`Recovery email changed to ${res.email || email.trim()}`);
            onChanged();
            close();
        });
    };
    return (<Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change recovery email</DialogTitle>
          <DialogDescription>
            {step === "email" ? "If you forget your PIN, a reset code is sent to this address." : `Enter the 6-digit code we sent to ${email.trim()}.`}
          </DialogDescription>
        </DialogHeader>
        {step === "email" ? (<form onSubmit={sendCode} className="grid gap-3">
            <Field label="New recovery email" htmlFor="rec-email">
              <Input id="rec-email" type="email" autoComplete="email" className="h-9" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} autoFocus required/>
            </Field>
            <Field label="Vault PIN" htmlFor="rec-pin"><PinInput id="rec-pin" value={pin} onChange={(v) => { setPin(v); setError(""); }}/></Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-0 pt-1">
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={busy || !email.trim() || !isPin(pin)}>{busy ? "Sending…" : "Send code"}</Button>
            </DialogFooter>
          </form>) : (<form onSubmit={confirmCode} className="grid gap-3">
            <Field label="Verification code" htmlFor="rec-code">
              <Input id="rec-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-9 w-40 font-mono tracking-[0.3em] text-center" value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} autoFocus/>
            </Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-0 pt-1">
              <Button type="button" variant="outline" onClick={() => { setStep("email"); setCode(""); setError(""); }}>Back</Button>
              <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Change email"}</Button>
            </DialogFooter>
          </form>)}
      </DialogContent>
    </Dialog>);
};

export const VaultSection = ({ onOpenVault }) => {
    const [status, setStatus] = useState(null);
    const [loadError, setLoadError] = useState(false);
    const [pinOpen, setPinOpen] = useState(false);
    const [emailOpen, setEmailOpen] = useState(false);
    const [savingLock, setSavingLock] = useState(false);
    const load = useCallback(() => {
        api.getVaultStatus()
            .then((s) => {
            setStatus(s);
            setLoadError(false);
        })
            .catch(() => setLoadError(true));
    }, []);
    useEffect(() => {
        load();
        window.addEventListener("vaultStateChanged", load);
        return () => window.removeEventListener("vaultStateChanged", load);
    }, [load]);
    const lockNow = async () => {
        try {
            await api.lockVault();
            toast.success("Vault locked");
            announce();
        }
        catch {
            toast.error("Couldn't lock the vault");
        }
    };
    const changeAutoLock = async (minutes) => {
        const previous = status.auto_lock_minutes;
        setStatus({ ...status, auto_lock_minutes: minutes });
        setSavingLock(true);
        try {
            await api.updateVaultSettings({ auto_lock_minutes: minutes });
            toast.success(`Vault now locks after ${AUTO_LOCK_OPTIONS.find((o) => o.value === minutes).label} without activity`);
            announce();
        }
        catch (err) {
            setStatus((s) => ({ ...s, auto_lock_minutes: previous }));
            toast.error(errorMessage(err, "Couldn't save the auto-lock time"));
        }
        finally {
            setSavingLock(false);
        }
    };
    if (!status) {
        return (<SettingsPanel icon={ShieldCheck} title="Private Vault">
        <p className="text-sm text-muted-foreground">{loadError ? "Couldn't load the vault status." : "Loading…"}</p>
      </SettingsPanel>);
    }
    if (!status.is_setup) {
        return (<SettingsPanel icon={ShieldCheck} title="Private Vault" description="A PIN-locked space for files you don't want in Home">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill>Not set up</StatusPill>
          <Button size="sm" className="h-8" onClick={onOpenVault}><ShieldCheck className="w-3.5 h-3.5 mr-1.5"/>Set up vault</Button>
        </div>
      </SettingsPanel>);
    }
    const minutesLeft = Math.ceil((status.remaining_seconds || 0) / 60);
    return (<div className="grid gap-4">
      <SettingsPanel icon={ShieldCheck} title="Private Vault" description="A PIN-locked space for files you don't want in Home" actions={status.is_unlocked
            ? <Button variant="outline" size="sm" className="h-8" onClick={lockNow}><Lock className="w-3.5 h-3.5 mr-1.5"/>Lock now</Button>
            : <Button variant="outline" size="sm" className="h-8" onClick={onOpenVault}><LockOpen className="w-3.5 h-3.5 mr-1.5"/>Unlock</Button>}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {status.is_unlocked
            ? <><StatusPill tone="success" icon={LockOpen}>Unlocked</StatusPill><span className="text-muted-foreground text-xs">locks in about {minutesLeft} min without activity</span></>
            : <StatusPill icon={Lock}>Locked</StatusPill>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="PIN" hint="4 digits, asked every time the vault opens.">
            <div><Button variant="outline" size="sm" className="h-8" onClick={() => setPinOpen(true)}><KeyRound className="w-3.5 h-3.5 mr-1.5"/>Change PIN</Button></div>
          </Field>
          <Field label="Recovery email" hint={status.email ? `Currently ${status.email}` : "Used to reset a forgotten PIN."}>
            <div><Button variant="outline" size="sm" className="h-8" onClick={() => setEmailOpen(true)}><Mail className="w-3.5 h-3.5 mr-1.5"/>Change recovery email</Button></div>
          </Field>
        </div>
      </SettingsPanel>

      <SettingsPanel icon={Timer} title="Auto-lock" description="Lock the vault after this long without activity">
        <div><Segmented label="Auto-lock after" value={status.auto_lock_minutes || 15} options={AUTO_LOCK_OPTIONS} onChange={changeAutoLock} disabled={savingLock}/></div>
      </SettingsPanel>

      <ChangePinDialog open={pinOpen} onOpenChange={setPinOpen}/>
      <RecoveryEmailDialog open={emailOpen} onOpenChange={setEmailOpen} onChanged={load}/>
    </div>);
};
