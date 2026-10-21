import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { request } from "@/lib/api";

const MIN_PASSWORD = 6;

/**
 * "Forgot password?": username → a 6-digit code goes to the account's email → new password.
 * Works for accounts that sign in with a password and have an email; otherwise the owner can
 * set a new password in Settings › Users.
 */
export const ForgotPasswordDialog = ({ open, onOpenChange, initialUsername = "", onDone }) => {
    const [step, setStep] = useState("username");
    const [username, setUsername] = useState(initialUsername);
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const close = (o) => {
        if (!o) {
            setStep("username");
            setCode("");
            setPassword("");
            setConfirm("");
            setError("");
            setNotice("");
        }
        onOpenChange(o);
    };
    const run = async (fn) => {
        setBusy(true);
        setError("");
        try {
            await fn();
        }
        catch (err) {
            setError(err.message || "Something went wrong");
        }
        finally {
            setBusy(false);
        }
    };
    const sendCode = (e) => {
        e.preventDefault();
        run(async () => {
            const res = await request("/auth/forgot-password/request", { method: "POST", body: { username: username.trim() }, timeout: 20000 });
            setNotice(res?.message || "");
            setStep("code");
        });
    };
    const reset = (e) => {
        e.preventDefault();
        if (password.length < MIN_PASSWORD)
            return setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
        if (password !== confirm)
            return setError("The new passwords don't match.");
        run(async () => {
            await request("/auth/forgot-password/reset", { method: "POST", body: { username: username.trim(), code: code.trim(), new_password: password } });
            onDone?.(username.trim());
            close(false);
        });
    };
    return (<Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>
            {step === "username" ? "We'll email a 6-digit code to the address on your account." : notice}
          </DialogDescription>
        </DialogHeader>
        {step === "username" ? (<form onSubmit={sendCode} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fp-username">Username</Label>
              <Input id="fp-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required/>
            </div>
            <p className="text-xs text-muted-foreground">No email on your account, or signing in with Google? Ask the owner to set a new password for you.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !username.trim()}>{busy ? "Sending…" : "Send code"}</Button>
            </DialogFooter>
          </form>) : (<form onSubmit={reset} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fp-code">Code from the email</Label>
              <Input id="fp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus required/>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fp-new">New password</Label>
              <Input id="fp-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required/>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fp-confirm">Repeat new password</Label>
              <Input id="fp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required/>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => { setStep("username"); setError(""); }}>Back</Button>
              <Button type="submit" disabled={busy || code.length !== 6 || !password}>{busy ? "Saving…" : "Set new password"}</Button>
            </DialogFooter>
          </form>)}
      </DialogContent>
    </Dialog>);
};
