import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Clapperboard, ListVideo, Loader2, Music, Video } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSaveDestination } from "./SaveDestination";

const LINK = /^(https?:\/\/)?[^\s/]+\.[^\s/]+\/\S+/i;

// Only the link: chat apps often copy the message time or text along with it
const cleanLink = (text) => {
    const match = /https?:\/\/\S+/i.exec(text);
    return match ? match[0].replace(/[.,;)\]>"']+$/, "") : text;
};

const SUBTITLES = [
    { value: "", label: "No subtitles" },
    { value: "en", label: "English subtitles" },
    { value: "hi", label: "Hindi subtitles" },
    { value: "all", label: "All subtitle languages" },
];

const QUALITIES = [
    { value: "best", label: "Best available" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
    { value: "480", label: "480p (smaller)" },
];

const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0)
        return "";
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

const Segmented = ({ label, value, onChange, options }) => (<div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/60">
    {options.map(({ value: v, label: text, icon: Icon }) => (<button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn("flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors", value === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
        <Icon className="w-3.5 h-3.5"/>{text}
      </button>))}
  </div>);

/**
 * Paste a YouTube, YouTube Music or other video link (or a playlist), choose video or audio and
 * where to save it, and the server downloads it with yt-dlp. Progress shows in Transfers.
 */
export const MediaDownloadDialog = ({ open, onOpenChange, defaultDestination, userEmail }) => {
    const [url, setUrl] = useState("");
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState("video");
    const [quality, setQuality] = useState("best");
    const [audioFormat, setAudioFormat] = useState("mp3");
    const [subtitles, setSubtitles] = useState("");
    const [sync, setSync] = useState(false);
    const [picked, setPicked] = useState(new Set());
    const lastPreviewed = useRef("");
    const save = useSaveDestination({ open, defaultDestination, userEmail, onChange: () => setError("") });

    useEffect(() => {
        if (!open)
            return;
        setUrl("");
        setPreview(null);
        setError("");
        setSync(false);
        lastPreviewed.current = "";
    }, [open]);

    // Read the link shortly after it is pasted or typed
    useEffect(() => {
        const link = url.trim();
        if (!open || !LINK.test(link) || link === lastPreviewed.current)
            return;
        let stale = false;
        const timer = setTimeout(async () => {
            lastPreviewed.current = link;
            setPreviewing(true);
            setError("");
            setPreview(null);
            try {
                const res = await api.mediaPreview(link);
                if (stale)
                    return;
                setPreview(res);
                setPicked(new Set(res.entries.map((e) => e.index)));
                // Music links default to audio
                if (/music\.youtube\.com|soundcloud\.com|bandcamp\.com/i.test(link))
                    setMode("audio");
            }
            catch (err) {
                if (!stale)
                    setError(err.message);
            }
            finally {
                if (!stale)
                    setPreviewing(false);
            }
        }, 600);
        return () => { stale = true; clearTimeout(timer); };
    }, [url, open]);

    const isPlaylist = preview?.kind === "playlist";
    const count = isPlaylist ? picked.size : preview ? 1 : 0;
    const toggle = (index) => setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(index))
            next.delete(index);
        else
            next.add(index);
        return next;
    });

    const submit = async (e) => {
        e.preventDefault();
        if (!preview || save.blocked || (count === 0 && !sync))
            return;
        setBusy(true);
        setError("");
        try {
            const choice = mode === "audio" ? { mode, audio_format: audioFormat } : { mode, quality, subtitles: subtitles || null };
            const items = isPlaylist ? [...picked].sort((a, b) => a - b) : undefined;
            const res = await api.downloadMedia(url.trim(), choice, save.destination, items, isPlaylist && sync);
            toast.success(res.message || "Download started", { description: "Follow it in Transfers." });
            window.dispatchEvent(new CustomEvent("remoteTransferAdded"));
            onOpenChange(false);
        }
        catch (err) {
            setError(err.message);
            if (err.status === 403 && save.kind === "vault")
                save.markVaultLocked();
        }
        finally {
            setBusy(false);
        }
    };

    const noun = mode === "audio" ? (count === 1 ? "audio file" : "audio files") : (count === 1 ? "video" : "videos");

    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <form onSubmit={submit} className="grid gap-4 min-w-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clapperboard className="w-5 h-5 text-primary"/>Download video or audio</DialogTitle>
            <DialogDescription>Paste a link from YouTube, YouTube Music or another video site. Playlists work too.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="media-url">Link</Label>
            <Input id="media-url" autoFocus inputMode="url" autoComplete="off" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => { setUrl(cleanLink(e.target.value)); setError(""); }} disabled={busy}/>
          </div>

          {previewing && (<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin"/>Reading the link…</div>)}

          {preview && (<div className="grid gap-2 min-w-0">
              <div className="flex gap-3 p-3 rounded-lg border border-border bg-muted/30 min-w-0" aria-label="Link preview">
                {preview.thumbnail ? (<img src={preview.thumbnail} alt="" className="w-28 aspect-video rounded-md object-cover shrink-0 bg-muted"/>) : (<div className="w-28 aspect-video rounded-md bg-muted shrink-0 flex items-center justify-center">{isPlaylist ? <ListVideo className="w-6 h-6 text-muted-foreground"/> : <Video className="w-6 h-6 text-muted-foreground"/>}</div>)}
                <div className="min-w-0 flex-1 grid content-start gap-0.5">
                  <p className="text-sm font-semibold line-clamp-2 break-words">{preview.title}</p>
                  {preview.uploader && <p className="text-xs text-muted-foreground truncate">{preview.uploader}</p>}
                  <p className="text-xs text-muted-foreground">
                    {isPlaylist ? `${preview.is_channel ? "Channel" : "Playlist"} · ${preview.count} ${preview.count === 1 ? "video" : "videos"}${preview.is_channel ? ", newest first" : ""}` : formatDuration(preview.duration)}
                  </p>
                </div>
              </div>

              {isPlaylist && (<div className="grid gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{picked.size} of {preview.entries.length} chosen{preview.count > preview.entries.length ? ` (first ${preview.entries.length} shown)` : ""}</span>
                    <span className="flex gap-3">
                      <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set(preview.entries.map((x) => x.index)))}>All</button>
                      <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set())}>None</button>
                    </span>
                  </div>
                  <ul aria-label="Playlist videos" className="max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {preview.entries.map((entry) => (<li key={entry.index}>
                        <label className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-accent min-w-0">
                          <input type="checkbox" className="accent-primary shrink-0" checked={picked.has(entry.index)} onChange={() => toggle(entry.index)}/>
                          <span className="text-xs text-muted-foreground w-6 shrink-0 tabular-nums">{entry.index}</span>
                          <span className="truncate flex-1">{entry.title}</span>
                          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{formatDuration(entry.duration)}</span>
                        </label>
                      </li>))}
                  </ul>
                </div>)}
            </div>)}

          <div className="grid gap-2">
            <Label id="media-what">Download</Label>
            <Segmented label="Download" value={mode} onChange={setMode} options={[{ value: "video", label: "Video", icon: Video }, { value: "audio", label: "Audio only", icon: Music }]}/>
            {mode === "video" ? (<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <select aria-label="Quality" value={quality} onChange={(e) => setQuality(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                  {QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
                <select aria-label="Subtitles" value={subtitles} onChange={(e) => setSubtitles(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                  {SUBTITLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>) : (<select aria-label="Audio format" value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm justify-self-start">
                <option value="mp3">MP3 (plays everywhere)</option>
                <option value="m4a">M4A (smaller, same quality)</option>
              </select>)}
          </div>

          {save.field}

          {isPlaylist && (<label className="flex items-start gap-2.5 text-sm cursor-pointer">
              <input type="checkbox" className="accent-primary mt-0.5" checked={sync} onChange={(e) => setSync(e.target.checked)}/>
              <span className="grid gap-0.5">
                <span>Also download new videos automatically</span>
                <span className="text-xs text-muted-foreground">The server checks this {preview.is_channel ? "channel" : "playlist"} every few hours and saves new videos the same way. Manage it in Settings › Integrations.</span>
              </span>
            </label>)}

          {error && (<div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-destructive/25 bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/><span className="min-w-0 break-words">{error}</span>
            </div>)}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !preview || save.blocked || (count === 0 && !(isPlaylist && sync))}>
              {busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin"/>Starting…</> : count === 0 && isPlaylist && sync ? "Sync new videos only" : count > 1 ? `Download ${count} ${noun}` : "Download"}
            </Button>
          </DialogFooter>
        </form>
        {save.dialogs}
      </DialogContent>
    </Dialog>);
};
