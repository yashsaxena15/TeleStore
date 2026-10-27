import { X, Download, FolderInput, Copy, Scissors, Star, StarOff, Package, ShieldCheck, House, Info, Trash2, RotateCcw, MoreHorizontal, ListPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const ACTION_META = {
    download: { label: "Download", icon: Download },
    "move-to": { label: "Move to…", icon: FolderInput },
    "file-to": { label: "File to…", icon: FolderInput },
    copy: { label: "Copy", icon: Copy, hint: "Ctrl+C" },
    cut: { label: "Cut", icon: Scissors, hint: "Ctrl+X" },
    star: { label: "Star", icon: Star },
    playlist: { label: "Add to playlist", icon: ListPlus },
    unstar: { label: "Unstar", icon: StarOff },
    compress: { label: "Compress", icon: Package },
    "to-vault": { label: "To vault", icon: ShieldCheck },
    "to-home": { label: "To Home", icon: House },
    details: { label: "Details", icon: Info, hint: "Alt+Enter" },
    restore: { label: "Restore", icon: RotateCcw },
    delete: { label: "Delete", icon: Trash2, danger: true, hint: "Del" },
    "delete-forever": { label: "Delete forever", icon: Trash2, danger: true, hint: "Del" },
};

// Floating bar shown while items are selected. Its actions depend on the section (see getSelectionActions).
export const SelectionBar = ({ count, allSelected, actions, onAction, onClear, onToggleAll, busy = false }) => {
    const secondary = actions.filter((a) => !a.primary);
    const button = (action, extra = "") => {
        const meta = ACTION_META[action.id];
        if (!meta) return null;
        const Icon = meta.icon;
        return (<button key={action.id} type="button" disabled={busy} onClick={() => onAction(action.id)} title={meta.hint ? `${meta.label} (${meta.hint})` : meta.label} aria-label={meta.label} className={cn("h-8 inline-flex items-center gap-1.5 px-2 sm:px-2.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50", meta.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted", extra)}>
          <Icon className="w-3.5 h-3.5 shrink-0"/>
          <span className="hidden lg:inline">{meta.label}</span>
        </button>);
    };
    return (<div role="toolbar" aria-label={`${count} selected`} className="absolute z-30 left-1/2 -translate-x-1/2 bottom-3 max-w-[calc(100%-1.5rem)] flex items-center gap-0.5 p-1 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-[0_18px_40px_-14px_rgba(0,0,0,0.85)] animate-in fade-in slide-in-from-bottom-2 duration-150">
      <button type="button" onClick={onClear} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="Clear selection (Esc)" aria-label="Clear selection">
        <X className="w-4 h-4"/>
      </button>
      <span className="px-1.5 text-xs font-medium whitespace-nowrap tabular-nums" aria-live="polite">{count} selected</span>
      <button type="button" onClick={onToggleAll} className="hidden sm:inline-flex h-8 items-center px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted whitespace-nowrap">
        {allSelected ? "Deselect all" : "Select all"}
      </button>
      <span className="w-px h-5 bg-border mx-1 shrink-0"/>
      {/* Desktop: every action. Phone: the main ones plus a ⋯ menu for the rest */}
      {actions.map((a) => button(a, a.primary ? "" : "hidden sm:inline-flex"))}
      {secondary.length > 0 && (<DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="sm:hidden h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-muted" aria-label="More actions">
              <MoreHorizontal className="w-4 h-4"/>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-[180px]">
            <DropdownMenuItem onSelect={onToggleAll}>{allSelected ? "Deselect all" : "Select all"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            {secondary.map((a) => {
                const meta = ACTION_META[a.id];
                if (!meta) return null;
                const Icon = meta.icon;
                return (<DropdownMenuItem key={a.id} disabled={busy} onSelect={() => onAction(a.id)} className={cn("gap-2", meta.danger && "text-destructive")}>
                    <Icon className="w-4 h-4"/>{meta.label}
                  </DropdownMenuItem>);
            })}
          </DropdownMenuContent>
        </DropdownMenu>)}
    </div>);
};
