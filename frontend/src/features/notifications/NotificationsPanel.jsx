// The bell: a sidebar row with the unread count that opens the list (a popover on desktop),
// and the list itself, also shown in a sheet on phones (see MobileNav).
import { useState } from "react";
import { ArrowUpDown, Bell, BellRing, CheckCheck, Film, HardDrive, Inbox, Instagram, KeyRound, ListMusic } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { badgeText, relativeTime } from "./notificationHelpers";
import { followTarget, popupsSupported, useMarkNotificationsRead, useNotifications } from "./useNotifications";

const KIND_ICON = {
    transfer: ArrowUpDown,
    media: Film,
    instagram: Instagram,
    playlist_sync: ListMusic,
    inbox: Inbox,
    storage: HardDrive,
    sign_in: KeyRound,
};

// Browser pop-ups: ask once; say so when the browser blocks them
const PopupControl = () => {
    const [permission, setPermission] = useState(() => (popupsSupported() ? Notification.permission : "unsupported"));
    if (permission === "unsupported" || permission === "granted") return null;
    const ask = async () => {
        try {
            setPermission(await Notification.requestPermission());
        }
        catch {
            setPermission(Notification.permission);
        }
    };
    return (<div className="flex items-center gap-2 px-3 py-2.5 border-t border-border text-xs text-muted-foreground">
      <BellRing className="w-3.5 h-3.5 shrink-0"/>
      {permission === "denied"
            ? <span>Pop-ups are blocked in this browser's site settings.</span>
            : (<>
            <span className="flex-1">Get a pop-up when something finishes.</span>
            <button type="button" onClick={ask} className="font-medium text-primary hover:underline">Allow pop-ups</button>
          </>)}
    </div>);
};

/** The list of notifications. onDone closes the popover or sheet around it (a sheet has its own ✕ top right). */
export const NotificationsPanel = ({ onNavigateView, onDone, inSheet = false }) => {
    const { items, unread } = useNotifications();
    const markRead = useMarkNotificationsRead();
    const now = new Date();
    const open = (n) => {
        if (!n.read) markRead([n.id]);
        onDone?.();
        followTarget(n.target, onNavigateView);
    };
    return (<div className="flex flex-col min-h-0">
      <div className={cn("flex items-center justify-between gap-2 px-3 h-11 border-b border-border", inSheet && "pr-12")}>
        <span className="text-sm font-semibold">Notifications</span>
        <button type="button" onClick={() => markRead("all")} disabled={!unread} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
          <CheckCheck className="w-3.5 h-3.5"/>Mark all as read
        </button>
      </div>
      {items.length === 0 ? (<div className="grid justify-items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
          <Bell className="w-6 h-6"/>
          <p>Nothing yet. Finished transfers, new Inbox files and sign-ins show up here.</p>
        </div>) : (<ul className="flex-1 min-h-0 max-h-[60vh] overflow-y-auto custom-scrollbar py-1" aria-label="Notifications">
          {items.map((n) => {
                const Icon = KIND_ICON[n.kind] || Bell;
                return (<li key={n.id}>
                <button type="button" onClick={() => open(n)} data-unread={n.read ? undefined : "true"} className={cn("w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted", !n.read && "bg-primary/5")}>
                  <span className={cn("mt-0.5 w-8 h-8 rounded-full grid place-items-center shrink-0", n.read ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}>
                    <Icon className="w-4 h-4"/>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13px] truncate", n.read ? "text-foreground" : "font-semibold")}>{n.title}</span>
                    {n.body && <span className="block text-xs text-muted-foreground line-clamp-2 break-words">{n.body}</span>}
                    <span className="block mt-0.5 text-[10.5px] font-mono text-muted-foreground/80">{relativeTime(n.created_at, now)}</span>
                  </span>
                  {!n.read && (<><span className="mt-2 w-2 h-2 rounded-full bg-primary shrink-0" aria-hidden="true"/><span className="sr-only">Unread</span></>)}
                </button>
              </li>);
            })}
        </ul>)}
      <PopupControl />
    </div>);
};

/** Sidebar row (desktop) with the unread count; opens the list beside it. */
export const NotificationBell = ({ collapsed, className, onNavigateView }) => {
    const [open, setOpen] = useState(false);
    const { unread } = useNotifications();
    const badge = badgeText(unread);
    return (<Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(className, "relative")} title={collapsed ? "Notifications" : undefined} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="w-4 h-4 shrink-0"/>
          {!collapsed && <span className="truncate">Notifications</span>}
          {badge && (collapsed
                ? <span className="absolute top-1 right-1.5 min-w-2 h-2 rounded-full bg-primary"/>
                : <span data-testid="notification-badge" className="ml-auto text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">{badge}</span>)}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-[360px] max-w-[calc(100vw-2rem)] p-0 overflow-hidden">
        <NotificationsPanel onNavigateView={onNavigateView} onDone={() => setOpen(false)}/>
      </PopoverContent>
    </Popover>);
};
