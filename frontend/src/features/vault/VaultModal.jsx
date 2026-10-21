import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Lock, KeyRound, Mail, ArrowLeft, AlertCircle, Loader2, Delete, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
export const VaultModal = ({ isOpen, onClose, onSuccess, userEmail = "" }) => {
    const { toast } = useToast();
    const [mode, setMode] = useState("loading");
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [shake, setShake] = useState(false);
    // Setup state
    const [email, setEmail] = useState("");
    const [maskedEmail, setMaskedEmail] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [pin, setPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    // Keypad PIN input for unlock
    const [unlockPin, setUnlockPin] = useState("");
    const modalRef = useRef(null);
    // Reset and check status when opened
    useEffect(() => {
        if (!isOpen) {
            setUnlockPin("");
            setPin("");
            setConfirmPin("");
            setOtpCode("");
            setErrorMsg("");
            return;
        }
        checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- check status each time the modal opens
    }, [isOpen]);
    const checkStatus = async () => {
        setMode("loading");
        setErrorMsg("");
        try {
            const status = await api.getVaultStatus();
            if (!status.is_setup) {
                setEmail(userEmail || "");
                setMode("setup_email");
            }
            else if (status.is_unlocked) {
                onSuccess();
                onClose();
            }
            else {
                setMaskedEmail(status.email || "");
                setMode("unlock");
            }
        }
        catch (err) {
            setErrorMsg("Failed to check Vault status. Please try again.");
            setMode("unlock");
        }
    };
    // Keyboard handler for numerical PIN entry
    useEffect(() => {
        if (!isOpen)
            return;
        const handleKeyDown = (e) => {
            if (mode === "unlock") {
                if (/^[0-9]$/.test(e.key)) {
                    handlePinDigit(e.key);
                }
                else if (e.key === "Backspace") {
                    handlePinBackspace();
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listener is re-registered whenever the PIN state it uses changes
    }, [isOpen, mode, unlockPin]);
    const triggerShake = (msg) => {
        setErrorMsg(msg);
        setShake(true);
        setTimeout(() => setShake(false), 500);
    };
    // --- UNLOCK FLOW ---
    const handlePinDigit = (digit) => {
        if (unlockPin.length < 4) {
            const nextPin = unlockPin + digit;
            setUnlockPin(nextPin);
            setErrorMsg("");
            if (nextPin.length === 4) {
                submitUnlock(nextPin);
            }
        }
    };
    const handlePinBackspace = () => {
        setUnlockPin((prev) => prev.slice(0, -1));
        setErrorMsg("");
    };
    const submitUnlock = async (pinToTest) => {
        setLoading(true);
        setErrorMsg("");
        try {
            await api.unlockVault(pinToTest);
            toast({
                title: "Vault Unlocked",
                description: "Welcome back to your private encrypted space.",
            });
            onSuccess();
            onClose();
        }
        catch (err) {
            triggerShake(err.message || "Incorrect PIN. Please try again.");
            setUnlockPin("");
        }
        finally {
            setLoading(false);
        }
    };
    // --- SETUP FLOW ---
    const handleRequestSetupOtp = async (e) => {
        e.preventDefault();
        if (!email || !email.includes("@")) {
            setErrorMsg("Please enter a valid email address.");
            return;
        }
        setLoading(true);
        setErrorMsg("");
        try {
            await api.requestVaultSetupOtp(email);
            toast({
                title: "Code Dispatched",
                description: `A 6-digit verification code was sent to ${email}`,
            });
            setMode("setup_otp");
        }
        catch (err) {
            setErrorMsg(err.message || "Failed to send verification code.");
        }
        finally {
            setLoading(false);
        }
    };
    const handleVerifySetupOtp = async (e) => {
        e.preventDefault();
        if (otpCode.length !== 6) {
            setErrorMsg("Please enter the complete 6-digit verification code.");
            return;
        }
        setLoading(true);
        setErrorMsg("");
        try {
            await api.verifyVaultOtp(otpCode, "Private Vault Setup", email);
            setMode("setup_pin");
        }
        catch (err) {
            setErrorMsg(err.message || "Invalid verification code.");
        }
        finally {
            setLoading(false);
        }
    };
    const handleCompleteSetup = async (e) => {
        e.preventDefault();
        if (!/^\d{4}$/.test(pin)) {
            setErrorMsg("PIN must be exactly 4 digits.");
            return;
        }
        if (pin !== confirmPin) {
            setErrorMsg("PINs do not match. Please re-enter.");
            return;
        }
        setLoading(true);
        setErrorMsg("");
        try {
            await api.verifyAndCreateVault(email, otpCode, pin);
            toast({
                title: "Vault Created Successfully",
                description: "Your files will now be encrypted with AES-256.",
            });
            onSuccess();
            onClose();
        }
        catch (err) {
            setErrorMsg(err.message || "Failed to initialize Vault.");
        }
        finally {
            setLoading(false);
        }
    };
    // --- FORGOT PIN FLOW ---
    const handleRequestForgotPin = async () => {
        setLoading(true);
        setErrorMsg("");
        try {
            const res = await api.requestForgotPinOtp();
            if (res.masked_email) {
                setMaskedEmail(res.masked_email);
            }
            toast({
                title: "Reset Code Sent",
                description: `We've sent a 6-digit reset code to your registered email.`,
            });
            setMode("forgot_otp");
        }
        catch (err) {
            setErrorMsg(err.message || "Failed to send reset code.");
        }
        finally {
            setLoading(false);
        }
    };
    const handleVerifyForgotOtp = async (e) => {
        e.preventDefault();
        if (otpCode.length !== 6) {
            setErrorMsg("Please enter the complete 6-digit code.");
            return;
        }
        setLoading(true);
        setErrorMsg("");
        try {
            await api.verifyVaultOtp(otpCode, "Vault PIN Reset");
            setPin("");
            setConfirmPin("");
            setMode("forgot_new_pin");
        }
        catch (err) {
            setErrorMsg(err.message || "Invalid verification code.");
        }
        finally {
            setLoading(false);
        }
    };
    const handleCompleteResetPin = async (e) => {
        e.preventDefault();
        if (!/^\d{4}$/.test(pin)) {
            setErrorMsg("PIN must be exactly 4 digits.");
            return;
        }
        if (pin !== confirmPin) {
            setErrorMsg("PINs do not match. Please re-enter.");
            return;
        }
        setLoading(true);
        setErrorMsg("");
        try {
            await api.resetVaultPin(otpCode, pin);
            toast({
                title: "PIN Successfully Reset",
                description: "Your Vault has been unlocked with your new PIN.",
            });
            onSuccess();
            onClose();
        }
        catch (err) {
            setErrorMsg(err.message || "Failed to reset PIN.");
        }
        finally {
            setLoading(false);
        }
    };
    return (<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-card backdrop-blur-xl border border-border text-foreground rounded-2xl shadow-2xl p-6 sm:p-8">
        
        {/* LOADING STATE */}
        {mode === "loading" && (<div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin"/>
            <p className="text-muted-foreground text-sm">Checking Vault status...</p>
          </div>)}

        {/* 1. UNLOCK KEYPAD VIEW */}
        {mode === "unlock" && (<div className={`space-y-6 text-center ${shake ? "animate-shake" : ""}`}>
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-3">
                <Lock className="w-7 h-7 text-primary"/>
              </div>
              <DialogTitle className="text-2xl font-bold text-foreground tracking-tight">
                Private Vault
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-1">
                Enter your 4-digit PIN to access encrypted files
              </DialogDescription>
            </div>

            {/* PIN DOTS DISPLAY */}
            <div className="flex justify-center items-center gap-4 py-2">
              {[0, 1, 2, 3].map((index) => {
                const filled = unlockPin.length > index;
                return (<div key={index} className={`w-4 h-4 rounded-full transition-all duration-200 ${filled
                        ? "bg-primary shadow-[0_0_12px_rgba(34,211,238,0.7)] scale-110"
                        : "border-2 border-border bg-muted"}`}/>);
            })}
            </div>

            {/* ERROR MESSAGE */}
            {errorMsg && (<div className="flex items-center justify-center gap-2 text-destructive text-xs font-medium bg-destructive/10 border border-destructive/20 py-2 px-3 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0"/>
                <span>{errorMsg}</span>
              </div>)}

            {/* NUMERICAL KEYPAD */}
            <div className="grid grid-cols-3 gap-3 max-w-[260px] mx-auto pt-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (<button key={num} type="button" onClick={() => handlePinDigit(num.toString())} disabled={loading} className="h-14 rounded-xl bg-muted/60 hover:bg-muted/80 active:scale-95 transition-all text-xl font-semibold text-foreground flex items-center justify-center border border-border shadow-sm">
                  {num}
                </button>))}
              <button type="button" onClick={() => setUnlockPin("")} disabled={loading || unlockPin.length === 0} className="h-14 rounded-xl hover:bg-muted/40 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-center transition-all">
                Clear
              </button>
              <button type="button" onClick={() => handlePinDigit("0")} disabled={loading} className="h-14 rounded-xl bg-muted/60 hover:bg-muted/80 active:scale-95 transition-all text-xl font-semibold text-foreground flex items-center justify-center border border-border shadow-sm">
                0
              </button>
              <button type="button" onClick={handlePinBackspace} disabled={loading || unlockPin.length === 0} className="h-14 rounded-xl hover:bg-muted/60 text-muted-foreground hover:text-foreground flex items-center justify-center transition-all">
                <Delete className="w-5 h-5"/>
              </button>
            </div>

            {/* FORGOT PIN ACTION */}
            <div className="pt-2">
              <button type="button" onClick={handleRequestForgotPin} disabled={loading} className="text-xs text-primary hover:text-primary/80 hover:underline transition-all">
                Forgot PIN? Reset via Email OTP
              </button>
            </div>
          </div>)}

        {/* 2. SETUP STEP 1: ENTER RECOVERY EMAIL */}
        {mode === "setup_email" && (<form onSubmit={handleRequestSetupOtp} className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-3">
                <ShieldCheck className="w-7 h-7 text-primary"/>
              </div>
              <DialogTitle className="text-xl font-bold text-foreground">
                Set Up Private Vault
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-1">
                Zero-knowledge encrypted cloud storage. Please enter your recovery email to get started.
              </DialogDescription>
            </div>

            {errorMsg && (<div className="text-destructive text-xs bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0"/>
                <span>{errorMsg}</span>
              </div>)}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground/80">
                Recovery Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2"/>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="pl-9 bg-muted border-border text-foreground placeholder:text-muted-foreground rounded-xl"/>
              </div>
              <p className="text-[11px] text-muted-foreground">
                If you ever forget your PIN, a one-time code will be dispatched to this verified address.
              </p>
            </div>

            <Button type="submit" disabled={loading || !email} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2.5 rounded-xl transition-all shadow-lg shadow-primary/20">
              {loading ? (<>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin"/> Sending Code...
                </>) : ("Send Verification Code")}
            </Button>
          </form>)}

        {/* 3. SETUP STEP 2: VERIFY EMAIL OTP */}
        {mode === "setup_otp" && (<form onSubmit={handleVerifySetupOtp} className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-3">
                <Mail className="w-7 h-7 text-primary"/>
              </div>
              <DialogTitle className="text-xl font-bold text-foreground">
                Verify Your Email
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-1">
                Enter the 6-digit code sent to <strong className="text-primary">{email}</strong>
              </DialogDescription>
            </div>

            {errorMsg && (<div className="text-destructive text-xs bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0"/>
                <span>{errorMsg}</span>
              </div>)}

            <div className="space-y-2 text-center">
              <Input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus required value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className="text-center tracking-[8px] font-mono text-2xl font-bold bg-muted border-border text-primary rounded-xl py-3"/>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("setup_email")} className="w-1/3 border-border hover:bg-muted text-foreground/80 rounded-xl">
                <ArrowLeft className="w-4 h-4 mr-1"/> Back
              </Button>
              <Button type="submit" disabled={otpCode.length !== 6} className="w-2/3 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl">
                Continue
              </Button>
            </div>
          </form>)}

        {/* 4. SETUP STEP 3: SET 4-DIGIT PIN */}
        {mode === "setup_pin" && (<form onSubmit={handleCompleteSetup} className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-3">
                <KeyRound className="w-7 h-7 text-primary"/>
              </div>
              <DialogTitle className="text-xl font-bold text-foreground">
                Set Your 4-Digit PIN
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-1">
                You will use this PIN every time you unlock your Vault.
              </DialogDescription>
            </div>

            {errorMsg && (<div className="text-destructive text-xs bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0"/>
                <span>{errorMsg}</span>
              </div>)}

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                  Enter 4-Digit PIN
                </label>
                <Input type="password" inputMode="numeric" maxLength={4} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="text-center font-mono tracking-[12px] text-xl bg-muted border-border text-foreground rounded-xl"/>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                  Confirm 4-Digit PIN
                </label>
                <Input type="password" inputMode="numeric" maxLength={4} required value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="text-center font-mono tracking-[12px] text-xl bg-muted border-border text-foreground rounded-xl"/>
              </div>
            </div>

            <Button type="submit" disabled={loading || pin.length !== 4 || confirmPin.length !== 4} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2.5 rounded-xl shadow-lg shadow-primary/20">
              {loading ? (<>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin"/> Creating Encrypted Vault...
                </>) : ("Finish & Open Vault")}
            </Button>
          </form>)}

        {/* 5. FORGOT PIN STEP 1: ENTER OTP */}
        {mode === "forgot_otp" && (<form onSubmit={handleVerifyForgotOtp} className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-warning/10 border border-warning/30 flex items-center justify-center mb-3">
                <RefreshCw className="w-7 h-7 text-warning"/>
              </div>
              <DialogTitle className="text-xl font-bold text-foreground">
                Reset Vault PIN
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-1">
                Enter the 6-digit code sent to <strong className="text-warning">{maskedEmail}</strong>
              </DialogDescription>
            </div>

            {errorMsg && (<div className="text-destructive text-xs bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0"/>
                <span>{errorMsg}</span>
              </div>)}

            <div className="space-y-2 text-center">
              <Input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus required value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className="text-center tracking-[8px] font-mono text-2xl font-bold bg-muted border-border text-warning rounded-xl py-3"/>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("unlock")} className="w-1/3 border-border hover:bg-muted text-foreground/80 rounded-xl">
                <ArrowLeft className="w-4 h-4 mr-1"/> Back
              </Button>
              <Button type="submit" disabled={otpCode.length !== 6} className="w-2/3 bg-warning hover:bg-warning/90 text-warning-foreground font-semibold rounded-xl">
                Verify Code
              </Button>
            </div>
          </form>)}

        {/* 6. FORGOT PIN STEP 2: ENTER NEW PIN */}
        {mode === "forgot_new_pin" && (<form onSubmit={handleCompleteResetPin} className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-3">
                <KeyRound className="w-7 h-7 text-primary"/>
              </div>
              <DialogTitle className="text-xl font-bold text-foreground">
                Enter New 4-Digit PIN
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-1">
                Your existing files will remain 100% safe and intact.
              </DialogDescription>
            </div>

            {errorMsg && (<div className="text-destructive text-xs bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0"/>
                <span>{errorMsg}</span>
              </div>)}

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                  New 4-Digit PIN
                </label>
                <Input type="password" inputMode="numeric" maxLength={4} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="text-center font-mono tracking-[12px] text-xl bg-muted border-border text-foreground rounded-xl"/>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                  Confirm New PIN
                </label>
                <Input type="password" inputMode="numeric" maxLength={4} required value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="text-center font-mono tracking-[12px] text-xl bg-muted border-border text-foreground rounded-xl"/>
              </div>
            </div>

            <Button type="submit" disabled={loading || pin.length !== 4 || confirmPin.length !== 4} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2.5 rounded-xl shadow-lg shadow-primary/20">
              {loading ? (<>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin"/> Updating PIN...
                </>) : ("Save New PIN & Unlock")}
            </Button>
          </form>)}

      </DialogContent>
    </Dialog>);
};
