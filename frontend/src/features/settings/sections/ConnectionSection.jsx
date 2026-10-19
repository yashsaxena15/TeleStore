import { useEffect, useState } from "react";
import { Plug, Hash, Check, X, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IndexChatDialog } from "@/features/explorer/dialogs/IndexChatDialog";
import { api, updateApiBaseUrl, resetApiBaseUrl } from "@/lib/api";
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
        api.getUserIndexChat()
            .then((r) => {
            setSaved(r.index_chat_id ?? null);
            setValue(r.index_chat_id != null ? String(r.index_chat_id) : "");
        })
            .catch(() => { });
    }, []);
    const trimmed = value.trim();
    const valid = trimmed === "" || /^-?\d+$/.test(trimmed);
    const dirty = trimmed !== (saved != null ? String(saved) : "");
    const save = async () => {
        setBusy(true);
        try {
            const id = trimmed ? parseInt(trimmed, 10) : null;
            await api.updateUserIndexChat({ index_chat_id: id });
            setSaved(id);
            toast.success(id ? "Index chat saved" : "Index chat cleared");
        }
        catch (err) {
            toast.error(err.message || "Couldn't save the index chat");
        }
        finally {
            setBusy(false);
        }
    };
    return (<SettingsPanel icon={Hash} title="Index chat" description="The Telegram group or channel where your uploads are stored">
      <Field label="Chat ID" htmlFor="index-chat" hint={valid ? "Usually starts with -100. Leave empty to use the server's default." : undefined}>
        <Input id="index-chat" inputMode="numeric" className="h-9 font-mono text-[13px] max-w-sm" value={value} onChange={(e) => setValue(e.target.value)} placeholder="-1001234567890"/>
        {!valid && <p role="alert" className="text-xs text-destructive">A chat ID is a number, for example -1001234567890.</p>}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-8" onClick={() => setBotDialogOpen(true)}><Send className="w-3.5 h-3.5 mr-1.5"/>Add bot to a chat</Button>
        <span className="flex-1"/>
        <Button size="sm" className="h-8" onClick={save} disabled={!dirty || !valid || busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      <IndexChatDialog open={botDialogOpen} onOpenChange={setBotDialogOpen}/>
    </SettingsPanel>);
};

export const ConnectionSection = () => (<div className="grid gap-4">
    <BackendUrlPanel />
    <IndexChatPanel />
  </div>);
