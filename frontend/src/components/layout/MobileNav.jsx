import { useState } from "react";
import { Bell, Folder, HardDriveDownload, Images, Inbox, ListMusic, ArrowUpDown, LayoutGrid, Plus, Star, ShieldCheck, Trash2, HardDrive, Cloud, User, Settings, Users, Laptop, LogOut } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTransferManager } from "@/features/transfers/useTransferManager";
import { useCloudAccounts, useIsOwner, useUserProfile, displayName } from "@/hooks/useShellData";
import { NotificationsPanel } from "@/features/notifications/NotificationsPanel";
import { useNotifications } from "@/features/notifications/useNotifications";
import { badgeText } from "@/features/notifications/notificationHelpers";
import { NewMenu } from "./NewMenu";

const Tab = ({ icon: Icon, label, active, onClick, badge }) => (<button onClick={onClick} className={`relative flex flex-col items-center justify-center gap-1 text-[10.5px] ${active ? "text-foreground" : "text-muted-foreground"}`} aria-current={active ? "page" : undefined}>
    <Icon className="w-5 h-5"/>
    <span>{label}</span>
    {badge > 0 && <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9.5px] font-mono font-semibold flex items-center justify-center">{badge}</span>}
  </button>);

const SheetRow = ({ icon: Icon, label, onClick, danger, hint }) => (<button onClick={onClick} className={`w-full flex items-center gap-3 h-11 px-2 rounded-lg text-sm text-left hover:bg-muted ${danger ? "text-destructive" : ""}`}>
    <Icon className={`w-[18px] h-[18px] ${danger ? "" : "text-muted-foreground"}`}/>
    <span className="flex-1 truncate">{label}</span>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </button>);

// Phone navigation: bottom tabs, a + button for the New menu, and a More sheet.
export const MobileNav = ({ selectedFilter, activeView, onNavigateView, onAction }) => {
    const [moreOpen, setMoreOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const { unread } = useNotifications();
    const { totalActiveCount } = useTransferManager();
    const cloudAccounts = useCloudAccounts();
    const isOwner = useIsOwner();
    const profile = useUserProfile();
    const inFiles = activeView === "files";
    const moreActive = !inFiles && !["transfers"].includes(activeView) || (inFiles && ["starred", "vault", "trash"].includes(selectedFilter)) || (inFiles && selectedFilter.startsWith("cloud:"));
    const go = (view, filter) => { setMoreOpen(false); onNavigateView(view, filter); };
    const act = (id) => { setMoreOpen(false); onAction(id); };

    return (<>
      <nav className="md:hidden relative shrink-0 grid grid-cols-5 h-[60px] border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom,0px)]" aria-label="Main navigation">
        <Tab icon={Folder} label="Files" active={inFiles && selectedFilter === "all"} onClick={() => go("files", "all")}/>
        <Tab icon={Inbox} label="Inbox" active={inFiles && selectedFilter === "inbox"} onClick={() => go("files", "inbox")}/>
        <div className="flex justify-center">
          <NewMenu onAction={onAction} side="top" align="center">
            <button className="-mt-5 w-[52px] h-[52px] rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform" aria-label="New: upload, folder, remote leech">
              <Plus className="w-6 h-6" strokeWidth={2.2}/>
            </button>
          </NewMenu>
        </div>
        <Tab icon={ArrowUpDown} label="Transfers" active={activeView === "transfers"} onClick={() => go("transfers")} badge={totalActiveCount}/>
        <Tab icon={LayoutGrid} label="More" active={moreActive} onClick={() => setMoreOpen(true)} badge={unread}/>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <SheetHeader className="text-left mb-2">
            <SheetTitle className="text-base">{displayName(profile)}</SheetTitle>
          </SheetHeader>
          <div className="grid gap-0.5">
            <SheetRow icon={Bell} label="Notifications" hint={badgeText(unread) ? `${badgeText(unread)} new` : undefined} onClick={() => { setMoreOpen(false); setNotificationsOpen(true); }}/>
            <SheetRow icon={Images} label="Photos" onClick={() => go("photos")}/>
            <SheetRow icon={ListMusic} label="Playlists" onClick={() => go("playlists")}/>
            <SheetRow icon={HardDriveDownload} label="Offline" onClick={() => go("offline")}/>
            <SheetRow icon={Star} label="Starred" onClick={() => go("files", "starred")}/>
            <SheetRow icon={ShieldCheck} label="Private Vault" onClick={() => go("files", "vault")}/>
            <SheetRow icon={Trash2} label="Trash" onClick={() => go("files", "trash")}/>
            <SheetRow icon={HardDrive} label="Storage" onClick={() => go("storage")}/>
          </div>
          <div className="mt-3 mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Cloud drives</div>
          <div className="grid gap-0.5">
            {cloudAccounts.map((acc) => <SheetRow key={acc.id} icon={Cloud} label={acc.account_name} hint={acc.account_email} onClick={() => go("files", `cloud:${acc.id}:root`)}/>)}
            <SheetRow icon={Cloud} label="Connect cloud drive" onClick={() => act("connect-drive")}/>
          </div>
          <div className="mt-3 mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Account</div>
          <div className="grid gap-0.5">
            <SheetRow icon={User} label="Account" onClick={() => go("profile")}/>
            <SheetRow icon={Settings} label="Settings" onClick={() => go("settings")}/>
            {isOwner && <SheetRow icon={Users} label="Users" onClick={() => go("users")}/>}
            <SheetRow icon={Laptop} label="Mount as drive (WebDAV)" onClick={() => act("webdav")}/>
            <SheetRow icon={LogOut} label="Log out" danger onClick={() => act("logout")}/>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] p-0 pb-[env(safe-area-inset-bottom,0px)] overflow-hidden flex flex-col" aria-describedby={undefined}>
          <SheetHeader className="sr-only">
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <NotificationsPanel inSheet onNavigateView={onNavigateView} onDone={() => setNotificationsOpen(false)}/>
        </SheetContent>
      </Sheet>
    </>);
};
