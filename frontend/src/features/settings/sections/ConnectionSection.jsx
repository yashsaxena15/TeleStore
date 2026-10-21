import { useEffect, useState } from "react";
import { Plug, Hash, Check, X, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IndexChatDialog } from "@/features/explorer/dialogs/IndexChatDialog";
import { api, updateApiBaseUrl, resetApiBaseUrl } from "@/lib/api";
import authService from "@/features/auth/authService";
import { SettingsPanel, Field, StatusPill } from "../SettingsUi";
import { defaultBackendUrl, savedBackendUrl, isValidBackendUrl, testBackendUrl } from "../connection";

const BackendUrlPanel = () => {
    const fallback = defaultBackendUrl();
    const [saved, setSaved] = useState(() => savedBackendUrl());
    const [value, setValue] = useState(() => savedBackendUrl() || fallback);
    const [test, setTest] = useState(null); // null | "testing" | { ok, message }
    const [error, setError] = useState("");
    const current = saved || fallback;
    const dirty = value.trim() !== current;
    useEffect(() => {
        // Show whether the server in use answers, once, when the page opens
        let cancelled = false;
        testBackendUrl(current).then((r) => !cancelled && setTest(r));
        return () => { cancelled = true; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- check the starting URL once
    const runTest = async () => {
        const url = value.trim();
        if (!isValidBackendUrl(url)) return setError("Enter a full address such as https://files.example.com");
        setTest("testing");
        setTest(await testBackendUrl(url));
    };
    const save = () => {
        const url = value.trim().replace(/\/+$/, "") || "/";
        if (!isValidBackendUrl(url)) return setError("Enter a full address such as https://files.example.com");
        if (url === fallback || url === "/") {
            resetApiBaseUrl();
            setSaved("");
            setValue(fallback);
        }
        else {
            updateApiBaseUrl(url);
            setSaved(url);
            setValue(url);
        }
        toast.success("Server address saved");
    };
    const reset = () => {
        resetApiBaseUrl();
        setSaved("");
        setValue(fallback);
        setError("");
        setTest(null);
        toast.success("Using the default server");
    };
    return (<SettingsPanel icon={Plug} title="Server" description="The TeleStore server this app talks to">
      <Field label="Backend server URL" htmlFor="backend-url" hint={error ? undefined : `Default: ${fallback}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Input id="backend-url" className="h-9 flex-1 basis-64 font-mono text-[13px]" value={value} spellCheck={false} autoComplete="off" onChange={(e) => {
            setValue(e.target.value);
            setError("");
            setTest(null);
        }} placeholder="https://files.example.com"/>
          {test === "testing" ? <StatusPill icon={Loader2}>Testing…</StatusPill> : test ? <StatusPill tone={test.ok ? "success" : "destructive"} icon={test.ok ? Check : X}>{test.message}</StatusPill> : null}
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-8" onClick={runTest} disabled={test === "testing"}>Test connection</Button>
        {saved && <Button variant="ghost" size="sm" className="h-8" onClick={reset}>Reset to default</Button>}
        <span className="flex-1"/>
        <Button size="sm" className="h-8" onClick={save} disabled={!dirty}>Save</Button>
      </div>
    </SettingsPanel>);
};

const IndexChatPanel = () => {
    const [saved, setSaved] = useState(null);
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [botDialogOpen, setBotDialogOpen] = useState(false);
    useEffect(() => {
        const load = () => api.getUserIndexChat()
            .then((r) => {
            setSaved(r.index_chat_id ?? null);
            setValue((current) => (current.trim() && current.trim() !== String(r.index_chat_id ?? "") ? current : (r.index_chat_id != null ? String(r.index_chat_id) : "")));
        })
            .catch(() => { });
        load();
        // After adding the bot in Telegram the server knows the new group; pick it up on return
        window.addEventListener("focus", load);
        return () => window.removeEventListener("focus", load);
    }, []);
    const trimmed = value.trim();
    // A chat is required: without one, uploads fail
    const valid = /^-?\d+$/.test(trimmed);
    const dirty = trimmed !== (saved != null ? String(saved) : "");
    const save = async () => {
        setBusy(true);
        try {
            const id = parseInt(trimmed, 10);
            await api.updateUserIndexChat({ index_chat_id: id });
            setSaved(id);
            toast.success("Index chat saved");
        }
        catch (err) {
            toast.error(err.message || "Couldn't save the index chat");
        }
        finally {
            setBusy(false);
        }
    };
    return (<SettingsPanel icon={Hash} title="Index chat" description="The private Telegram group where your files are kept. Every file you upload is stored there as a message.">
      {saved == null && (<p role="status" className="text-sm text-warning">Not set up yet. Uploads won't work until the bot is in one of your groups.</p>)}
      <ol className="grid gap-1 text-sm text-muted-foreground list-decimal pl-5">
        <li>In Telegram, create a private group (or use one you already have).</li>
        <li>Press <span className="text-foreground font-medium">Add bot to a chat</span> and pick that group.</li>
        <li>In the group, tap the button the bot posts. The chat ID below fills in by itself.</li>
      </ol>
      <Field label="Chat ID" htmlFor="index-chat" hint={trimmed && !valid ? undefined : "Group IDs start with -100. You only type one here if you already know it."}>
        <Input id="index-chat" inputMode="numeric" className="h-9 font-mono text-[13px] max-w-sm" value={value} onChange={(e) => setValue(e.target.value)} placeholder="-1001234567890"/>
        {trimmed && !valid && <p role="alert" className="text-xs text-destructive">A chat ID is a number, for example -1001234567890.</p>}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-8" onClick={() => setBotDialogOpen(true)}><Send className="w-3.5 h-3.5 mr-1.5"/>Add bot to a chat</Button>
        <span className="flex-1"/>
        <Button size="sm" className="h-8" onClick={save} disabled={!dirty || !valid || busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      <IndexChatDialog open={botDialogOpen} onOpenChange={setBotDialogOpen}/>
    </SettingsPanel>);
};

// The server address only matters in the desktop app; in a browser it is always this site
export const ConnectionSection = () => (<div className="grid gap-4">
    {authService.isTauri() && <BackendUrlPanel />}
    <IndexChatPanel />
  </div>);
