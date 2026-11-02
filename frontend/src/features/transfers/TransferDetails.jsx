import { Copy, ExternalLink, FolderOpen, Pause, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatBytes } from "@/lib/utils";
import { detailFacts, googleNote, statusInfo } from "./transferRows";

export const TONE_CHIP = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/15 text-info",
    cloud: "bg-cloud/15 text-cloud",
    destructive: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
};

export const copyLink = async (link) => {
    try {
        await navigator.clipboard.writeText(link);
        toast.success("Link copied");
    }
    catch {
        toast.error("Couldn't copy the link");
    }
};

/**
 * Everything about one transfer (source link, destination, size, start, machine, full error) and
 * what can be done with it. `actions` holds only the buttons that apply: { open, showInFolder,
 * pause, resume, retry, cancel, resumeNow } as functions (missing ones are hidden).
 */
export const TransferDetails = ({ item, actions = {}, onClose }) => {
    const open = Boolean(item);
    const st = item ? statusInfo(item) : null;
    const facts = item ? detailFacts(item, { bytes: (b) => formatBytes(b, 1) }) : [];
    const note = item ? googleNote(item) : "";
    const run = (fn, close = false) => () => {
        fn();
        if (close) onClose();
    };
    return (<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {item && (<>
          <DialogHeader>
            <DialogTitle className="pr-6 break-words">{item.filename || item.name}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex items-center gap-2 text-xs">
                <span className={cn("px-1.5 py-px rounded text-[10px] font-semibold", TONE_CHIP[st.tone])}>{st.label}</span>
                {Number.isFinite(item.progress) && <span className="font-mono text-muted-foreground">{Math.round(item.progress || 0)}%</span>}
              </div>
            </DialogDescription>
          </DialogHeader>
          {note && <p className="text-sm text-warning">{note}</p>}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {facts.map((f) => (<div key={f.label} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className={cn("min-w-0 break-words", f.kind === "error" && "text-destructive", f.kind === "link" && "font-mono text-xs")}>
                  {f.kind === "link" ? (<a href={f.value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{f.value}</a>) : f.value}
                </dd>
              </div>))}
          </dl>
          <div className="flex flex-wrap gap-2 pt-2">
            {actions.open && <Button size="sm" variant="outline" className="gap-1.5" onClick={run(actions.open, true)}><ExternalLink className="w-4 h-4"/>Open</Button>}
            {actions.showInFolder && <Button size="sm" variant="outline" className="gap-1.5" onClick={run(actions.showInFolder, true)}><FolderOpen className="w-4 h-4"/>Show in folder</Button>}
            {actions.resumeNow && <Button size="sm" variant="outline" className="gap-1.5 text-warning border-warning/40 hover:bg-warning/10 hover:text-warning" onClick={run(actions.resumeNow)}><Play className="w-4 h-4"/>Resume now</Button>}
            {actions.pause && <Button size="sm" variant="outline" className="gap-1.5" onClick={run(actions.pause)}><Pause className="w-4 h-4"/>Pause</Button>}
            {actions.resume && <Button size="sm" variant="outline" className="gap-1.5" onClick={run(actions.resume)}><Play className="w-4 h-4"/>Resume</Button>}
            {actions.retry && <Button size="sm" variant="outline" className="gap-1.5" onClick={run(actions.retry, true)}><RotateCcw className="w-4 h-4"/>Retry</Button>}
            {item.source_url && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copyLink(item.source_url)}><Copy className="w-4 h-4"/>Copy link</Button>}
            {actions.cancel && <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={run(actions.cancel, true)}><X className="w-4 h-4"/>Cancel</Button>}
          </div>
        </>)}
      </DialogContent>
    </Dialog>);
};
