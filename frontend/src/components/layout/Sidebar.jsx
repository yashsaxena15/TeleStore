import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDrive, Images, ListMusic, User, Settings, Users, LogOut, Laptop, ArrowUpDown, Lock, Cloud, Unlink, Plus, Search, PanelLeftClose, PanelLeftOpen, ChevronsUpDown } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useTransferManager } from "@/features/transfers/useTransferManager";
import { useCloudAccounts, useIsOwner, useUserProfile, displayName } from "@/hooks/useShellData";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NewMenu } from "./NewMenu";
import { LIBRARY } from "./shellActions";


function formatStorageBytes(bytes) {
    if (!bytes || bytes <= 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const navClass = (active, collapsed) => `w-full flex items-center gap-2.5 h-8 rounded-md text-[13px] transition-colors ${collapsed ? "justify-center px-0" : "px-2.5"} ${active
    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"}`;

const SectionLabel = ({ children, collapsed, action }) => collapsed ? <div className="my-2 mx-2 border-t border-sidebar-border"/> : (<div className="flex items-center justify-between px-2.5 pt-4 pb-1.5">
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{children}</span>
    {action}
  </div>);

const CloudAccountRow = ({ acc, isSelected, collapsed, onSelect, onDisconnect }) => {
    const { data: quota } = useQuery({
        queryKey: ["cloudStorageQuota", acc.id],
        queryFn: () => api.fetchCloudStorageQuota(acc.id),
        staleTime: 60000,
        enabled: !collapsed,
    });
    const usedBytes = quota ? (quota.usageInDrive || quota.usage) : 0;
    const limitBytes = quota?.limit || 0;
    const percentage = limitBytes > 0 ? Math.min(100, Math.max(1, Math.round((usedBytes / limitBytes) * 100))) : 0;
    return (<div className={`group rounded-md ${isSelected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`}>
      <div className="flex items-center">
        <button onClick={onSelect} className={`${navClass(false, collapsed)} !bg-transparent ${isSelected ? "!text-sidebar-accent-foreground font-medium" : ""}`} title={`${acc.account_name} (${acc.account_email})`}>
          <Cloud className="w-4 h-4 shrink-0 text-info"/>
          {!collapsed && <span className="truncate">{acc.account_name}</span>}
        </button>
        {!collapsed && (<button onClick={onDisconnect} className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 mr-1 rounded text-muted-foreground hover:text-destructive transition-opacity" title="Disconnect cloud account" aria-label={`Disconnect ${acc.account_name}`}>
            <Unlink className="w-3.5 h-3.5"/>
          </button>)}
      </div>
      {!collapsed && quota && limitBytes > 0 && (<div className="px-2.5 pb-2 pl-[34px]">
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono mb-1">
            <span>{formatStorageBytes(usedBytes)} / {formatStorageBytes(limitBytes)}</span>
            <span>{percentage}%</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${percentage > 90 ? "bg-destructive" : percentage > 75 ? "bg-warning" : "bg-info"}`} style={{ width: `${percentage}%` }}/>
          </div>
        </div>)}
    </div>);
};

// Desktop sidebar. Phones use MobileNav (bottom tabs) instead.
export const Sidebar = ({ selectedFilter, activeView = "files", onNavigateView, onDrop, onAction, onOpenPalette, isCollapsed = false, onToggleCollapse, isVaultUnlocked = false }) => {
    const [dragOverFilter, setDragOverFilter] = useState(null);
    const cloudAccounts = useCloudAccounts();
    const isOwner = useIsOwner();
    const profile = useUserProfile();
    const { totalActiveCount } = useTransferManager();
    const collapsed = isCollapsed;

    const [disconnectingAccount, setDisconnectingAccount] = useState(null);

    const handleConfirmDisconnect = async () => {
        const acc = disconnectingAccount;
        if (!acc) return;
        setDisconnectingAccount(null);
        try {
            await api.disconnectCloudAccount(acc.id);
            toast.success("Account disconnected.");
            window.dispatchEvent(new Event("cloudAccountsChanged"));
            if (selectedFilter.startsWith(`cloud:${acc.id}`)) {
                onNavigateView("files", "all");
            }
        }
        catch (err) {
            toast.error(err.message || "Failed to disconnect account.");
        }
    };
    const dropProps = (filter) => ({
        onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setDragOverFilter(filter); },
        onDragLeave: () => setDragOverFilter(null),
        onDrop: (e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverFilter(null);
            try {
                const itemData = e.dataTransfer.getData("application/json");
                if (itemData)
                    onDrop(JSON.parse(itemData), filter);
            }
            catch {
                // Not a TeleStore item (e.g. an OS file dragged over the sidebar)
            }
        },
    });

    return (<aside className={`hidden md:flex ${collapsed ? "w-14" : "w-60"} h-full shrink-0 flex-col bg-sidebar border-r border-sidebar-border select-none transition-[width] duration-200`} aria-label="Main navigation">
      {/* Brand + collapse */}
      <div className={`flex items-center gap-2.5 h-12 shrink-0 ${collapsed ? "justify-center px-2" : "px-3"}`}>
        {!collapsed && (<button onClick={() => onNavigateView("files", "all")} className="flex items-center gap-2.5 min-w-0 flex-1 text-left" title="Home">
            <img src="/logo-symbol.svg" alt="" className="w-8 h-8 shrink-0"/>
            <span className="font-semibold text-[14px] tracking-tight truncate text-sidebar-foreground">TeleStore</span>
          </button>)}
        <button onClick={onToggleCollapse} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60" title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen className="w-4 h-4"/> : <PanelLeftClose className="w-4 h-4"/>}
        </button>
      </div>

      {/* New + search */}
      <div className={`flex flex-col gap-1.5 pb-2 ${collapsed ? "px-2" : "px-3"}`}>
        <NewMenu onAction={onAction}>
          <button className={`h-9 rounded-md bg-primary text-primary-foreground font-semibold text-[13px] flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors ${collapsed ? "w-10" : "w-full"}`} title="New: upload, folder, remote leech" aria-label="New">
            <Plus className="w-4 h-4"/>
            {!collapsed && <span>New</span>}
          </button>
        </NewMenu>
        <button onClick={onOpenPalette} className={`h-8 rounded-md border border-border bg-muted/40 text-muted-foreground text-xs flex items-center gap-2 hover:text-foreground ${collapsed ? "w-10 justify-center" : "w-full px-2.5"}`} title="Search and commands (Ctrl+K)" aria-label="Open command palette">
          <Search className="w-3.5 h-3.5"/>
          {!collapsed && (<><span className="flex-1 text-left">Go to or run…</span><kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border bg-background">⌘K</kbd></>)}
        </button>
      </div>

      <nav className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-2 ${collapsed ? "px-2" : "px-2"}`}>
        <SectionLabel collapsed={collapsed}>Library</SectionLabel>
        {LIBRARY.map(({ name, icon: Icon, filter }) => (<button key={filter} onClick={() => onNavigateView("files", filter)} {...dropProps(filter)} className={`${navClass(activeView === "files" && selectedFilter === filter, collapsed)} ${dragOverFilter === filter ? "ring-2 ring-primary ring-inset" : ""}`} title={collapsed ? name : undefined} aria-label={name}>
            <Icon className="w-4 h-4 shrink-0"/>
            {!collapsed && <span className="truncate">{name}</span>}
            {!collapsed && filter === "vault" && !isVaultUnlocked && <Lock className="w-3 h-3 ml-auto text-muted-foreground/70"/>}
          </button>))}

        <button onClick={() => onNavigateView("photos")} className={navClass(activeView === "photos", collapsed)} title={collapsed ? "Photos" : undefined} aria-label="Photos">
          <Images className="w-4 h-4 shrink-0"/>
          {!collapsed && <span className="truncate">Photos</span>}
        </button>

        <button onClick={() => onNavigateView("playlists")} className={navClass(activeView === "playlists", collapsed)} title={collapsed ? "Playlists" : undefined} aria-label="Playlists">
          <ListMusic className="w-4 h-4 shrink-0"/>
          {!collapsed && <span className="truncate">Playlists</span>}
        </button>

        <SectionLabel collapsed={collapsed} action={<button onClick={() => onAction("connect-drive")} className="text-[11px] text-primary hover:underline font-medium" aria-label="Connect cloud drive">+ Connect</button>}>
          Cloud drives
        </SectionLabel>
        {cloudAccounts.map((acc) => (<CloudAccountRow key={acc.id} acc={acc} collapsed={collapsed} isSelected={activeView === "files" && selectedFilter.startsWith(`cloud:${acc.id}`)} onSelect={() => onNavigateView("files", `cloud:${acc.id}:root`)} onDisconnect={() => setDisconnectingAccount(acc)}/>))}
        {cloudAccounts.length === 0 && !collapsed && (<button onClick={() => onAction("connect-drive")} className="w-full mt-0.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-md py-2 flex items-center justify-center gap-1.5 hover:bg-sidebar-accent/40">
            <Cloud className="w-3.5 h-3.5"/>Connect Google Drive
          </button>)}

        <SectionLabel collapsed={collapsed}>Activity</SectionLabel>
        <button onClick={() => onNavigateView("transfers")} className={`${navClass(activeView === "transfers", collapsed)} relative`} title={collapsed ? "Transfers" : undefined} aria-label="Transfers">
          <ArrowUpDown className="w-4 h-4 shrink-0"/>
          {!collapsed && <span className="truncate">Transfers</span>}
          {totalActiveCount > 0 && (collapsed
            ? <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-primary animate-pulse"/>
            : <span className="ml-auto text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{totalActiveCount}</span>)}
        </button>
        <button onClick={() => onNavigateView("storage")} className={navClass(activeView === "storage", collapsed)} title={collapsed ? "Storage" : undefined} aria-label="Storage">
          <HardDrive className="w-4 h-4 shrink-0"/>
          {!collapsed && <span className="truncate">Storage</span>}
        </button>
      </nav>

      {/* Account menu */}
      <div className="p-2 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`w-full flex items-center gap-2.5 p-1.5 rounded-md hover:bg-sidebar-accent/60 text-left ${collapsed ? "justify-center" : ""}`} aria-label="Account menu">
              <span className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-semibold shrink-0 overflow-hidden">
                {profile?.telegram_profile_picture ? <img src={profile.telegram_profile_picture} alt="" className="w-full h-full object-cover"/> : displayName(profile).charAt(0).toUpperCase()}
              </span>
              {!collapsed && (<>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium truncate text-sidebar-foreground">{displayName(profile)}</span>
                    <span className="block text-[10.5px] text-muted-foreground truncate">{isOwner ? "Owner" : (profile?.email || "Member")}</span>
                  </span>
                  <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground"/>
                </>)}
            </button>
          </DropdownMenuTrigger>
          <AccountMenuItems onNavigateView={onNavigateView} onAction={onAction} isOwner={isOwner} profile={profile}/>
        </DropdownMenu>
      </div>

      <AlertDialog open={Boolean(disconnectingAccount)} onOpenChange={(o) => !o && setDisconnectingAccount(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnectingAccount?.account_name}?</AlertDialogTitle>
            <AlertDialogDescription>TeleStore stops showing this Drive. Nothing is deleted from Google Drive, and you can connect it again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDisconnect} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Disconnect account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>);
};

// Shared by the sidebar account menu (desktop).
const AccountMenuItems = ({ onNavigateView, onAction, isOwner, profile }) => (<DropdownMenuContent side="top" align="start" className="w-60">
    <DropdownMenuLabel className="font-normal">
      <span className="block text-sm font-medium truncate">{displayName(profile)}</span>
      {profile?.email && <span className="block text-xs text-muted-foreground truncate">{profile.email}</span>}
    </DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => onNavigateView("profile")}><User className="w-4 h-4 text-muted-foreground"/>Account</DropdownMenuItem>
    <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => onNavigateView("settings")}><Settings className="w-4 h-4 text-muted-foreground"/>Settings</DropdownMenuItem>
    {isOwner && <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => onNavigateView("users")}><Users className="w-4 h-4 text-muted-foreground"/>Users</DropdownMenuItem>}
    <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => onAction("webdav")}><Laptop className="w-4 h-4 text-muted-foreground"/>Mount as drive (WebDAV)</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive focus:text-destructive" onSelect={() => onAction("logout")}><LogOut className="w-4 h-4"/>Log out</DropdownMenuItem>
  </DropdownMenuContent>);
