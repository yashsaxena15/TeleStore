// "Confirm it's you" before removing the protection from an item.
// Mounted once, in App; opened by confirmUnlock() (see protection.js).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { settingsUrl } from "@/features/settings/settingsTabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { onConfirmUnlockRequest } from "./protection";

export const ProtectionDialog = () => {
    const [request, setRequest] = useState(null); // { reason, onConfirm, resolve }
    const [method, setMethod] = useState(null); // { method, email_hint } once loaded
    const [loadError, setLoadError] = useState("");
    const [secret, setSecret] = useState("");
    const [codeSent, setCodeSent] = useState(false);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const resolveRef = useRef(null);
    const navigate = useNavigate();

    const finish = (done) => {
        resolveRef.current?.(done);
        resolveRef.current = null;
        setRequest(null);
    };

    useEffect(() => onConfirmUnlockRequest((detail) => {
        // One at a time: a second request while open is turned down
        if (resolveRef.current) {
            detail.resolve(false);
            return;
        }
        resolveRef.current = detail.resolve;
        setRequest(detail);
        setMethod(null);
        setLoadError("");
        setSecret("");
        setCodeSent(false);
        setNotice("");
        setError("");
        api.getProtectionMethod().then(setMethod).catch((e) => setLoadError(e.message || "Couldn't check how to confirm"));
    }), []);

    // Closing without confirming: the item stays protected
    useEffect(() => () => resolveRef.current?.(false), []);

    const sendCode = async () => {
        setBusy(true);
        setError("");
        try {
            const res = await api.sendProtectionCode();
            setCodeSent(true);
            setNotice(res?.message || "We've emailed you a 6-digit code.");
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setBusy(false);
        }
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!secret.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
            await request.onConfirm(method?.method === "email" ? { code: secret.trim() } : { password: secret });
            finish(true);
        }
        catch (err) {
            setError(err.message || "Couldn't confirm");
        }
        finally {
            setBusy(false);
        }
    };

    const kind = method?.method;
    const openAccount = () => {
        finish(false);
        navigate(settingsUrl("account"));
    };

    return (<Dialog open={Boolean(request)} onOpenChange={(open) => !open && finish(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary"/>Confirm it's you</DialogTitle>
          <DialogDescription>{request?.reason || "Confirm to remove the protection."}</DialogDescription>
        </DialogHeader>
        {!method && !loadError && (<div className="grid place-items-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading"/></div>)}
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        {kind === "none" && (<div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">Your account has no password to confirm with. Set one in Settings › Account, then try again.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => finish(false)}>Cancel</Button>
              <Button onClick={openAccount}>Open Settings › Account</Button>
            </DialogFooter>
          </div>)}
        {(kind === "password" || kind === "email") && (<form onSubmit={submit} className="grid gap-3">
            {kind === "password" ? (<div className="grid gap-1.5">
                <Label htmlFor="protection-password">Password</Label>
                <Input id="protection-password" type="password" autoComplete="current-password" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)}/>
              </div>) : (<div className="grid gap-2">
                <p className="text-sm text-muted-foreground">
                  {codeSent ? notice : `We'll email a 6-digit code to ${method.email_hint || "your account's address"}.`}
                </p>
                {codeSent ? (<div className="grid gap-1.5">
                    <Label htmlFor="protection-code">Code</Label>
                    <Input id="protection-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={secret} onChange={(e) => setSecret(e.target.value.replace(/\D/g, ""))}/>
                  </div>) : null}
              </div>)}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => finish(false)}>Cancel</Button>
              {kind === "email" && !codeSent ? (<Button type="button" onClick={sendCode} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin"/>}Send code</Button>) : (<>
                  {kind === "email" && <Button type="button" variant="ghost" onClick={sendCode} disabled={busy}>Resend</Button>}
                  <Button type="submit" disabled={busy || (kind === "email" ? secret.length !== 6 : !secret)}>{busy && <Loader2 className="w-4 h-4 animate-spin"/>}Confirm</Button>
                </>)}
            </DialogFooter>
          </form>)}
      </DialogContent>
    </Dialog>);
};
