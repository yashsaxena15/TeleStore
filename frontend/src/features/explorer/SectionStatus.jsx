import { Trash2, Lock, Cloud, ShieldCheck, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

// One quiet line under the filters for places with something to know or one thing to do.
// Returns nothing for ordinary folders.
export const SectionStatus = ({ section, itemCount = 0, driveName, driveEmail, onEmptyTrash, onLockVault, vaultAutoLockMinutes = 15 }) => {
    const config = {
        trash: { icon: Trash2, tone: "text-warning", text: "Items stay here until you empty the trash or delete them forever.", action: itemCount > 0 && onEmptyTrash && { label: "Empty trash", icon: Trash2, onClick: onEmptyTrash, danger: true } },
        "drive-trash": { icon: Trash2, tone: "text-warning", text: "Google Drive trash. Items here are deleted by Drive after 30 days.", action: itemCount > 0 && onEmptyTrash && { label: "Empty trash", icon: Trash2, onClick: onEmptyTrash, danger: true } },
        vault: { icon: ShieldCheck, tone: "text-cloud", text: `Private vault · locks itself after ${vaultAutoLockMinutes === 60 ? "1 hour" : `${vaultAutoLockMinutes} minutes`} without activity.`, action: onLockVault && { label: "Lock vault", icon: Lock, onClick: onLockVault } },
        inbox: { icon: Inbox, tone: "text-info", text: "Files sent to your bots land here. Select them and use File to… to put them in a folder." },
        drive: { icon: Cloud, tone: "text-info", text: [driveName || "Google Drive", driveEmail].filter(Boolean).join(" · "), hint: "Copy files here and paste them into Home to move them to Telegram." },
    }[section];
    if (!config)
        return null;
    const Icon = config.icon;
    const ActionIcon = config.action?.icon;
    return (<div role="status" className="mx-3 sm:mx-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs">
      <Icon className={cn("w-3.5 h-3.5 shrink-0", config.tone)}/>
      <span className="min-w-0 flex-1 text-muted-foreground">
        <span className={cn(section === "drive" && "text-foreground font-medium")}>{config.text}</span>
        {config.hint && <span className="hidden md:inline"> · {config.hint}</span>}
      </span>
      {config.action && (<button type="button" onClick={config.action.onClick} className={cn("h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md border text-xs font-medium transition-colors shrink-0", config.action.danger ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-border hover:bg-muted")}>
          <ActionIcon className="w-3.5 h-3.5"/>{config.action.label}
        </button>)}
    </div>);
};
