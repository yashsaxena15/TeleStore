import { useEffect } from "react";
import { ArrowUpDown, HardDrive, User, Settings, Users, Cloud, RefreshCw, Laptop, Moon, Sun, Monitor, LogOut, Plug, ShieldCheck } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useCloudAccounts, useIsOwner } from "@/hooks/useShellData";
import { setTheme } from "@/lib/theme";
import { LIBRARY, NEW_ITEM_GROUPS } from "./shellActions";

// Ctrl/⌘+K: jump anywhere or run any shell action.
export const CommandPalette = ({ open, onOpenChange, onNavigateView, onAction }) => {
    const cloudAccounts = useCloudAccounts();
    const isOwner = useIsOwner();
    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                onOpenChange(!open);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onOpenChange]);
    const run = (fn) => () => { onOpenChange(false); fn(); };
    const Item = ({ icon: Icon, label, onSelect, keywords, hint }) => (<CommandItem value={label} keywords={keywords} onSelect={run(onSelect)} className="gap-2.5 cursor-pointer">
        <Icon className="w-4 h-4 text-muted-foreground"/>
        <span>{label}</span>
        {hint && <CommandShortcut>{hint}</CommandShortcut>}
      </CommandItem>);

    return (<CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Go to a place or run a command…"/>
      <CommandList>
        <CommandEmpty>Nothing matches. Try “upload”, “trash” or “settings”.</CommandEmpty>
        <CommandGroup heading="Go to">
          {LIBRARY.map(({ name, icon, filter }) => <Item key={filter} icon={icon} label={name} onSelect={() => onNavigateView("files", filter)}/>)}
          {cloudAccounts.map((acc) => <Item key={acc.id} icon={Cloud} label={acc.account_name} keywords={["drive", "google", acc.account_email]} hint="Drive" onSelect={() => onNavigateView("files", `cloud:${acc.id}:root`)}/>)}
          <Item icon={ArrowUpDown} label="Transfers" keywords={["downloads", "uploads", "leech"]} onSelect={() => onNavigateView("transfers")}/>
          <Item icon={HardDrive} label="Storage" keywords={["analytics", "usage", "cache"]} onSelect={() => onNavigateView("storage")}/>
          <Item icon={User} label="Account" keywords={["profile", "telegram", "password"]} onSelect={() => onNavigateView("settings", "account")}/>
          <Item icon={Settings} label="Settings" keywords={["preferences"]} onSelect={() => onNavigateView("settings")}/>
          <Item icon={Plug} label="Connection settings" keywords={["backend", "server", "url", "index chat"]} onSelect={() => onNavigateView("settings", "connection")}/>
          <Item icon={Cloud} label="Integrations" keywords={["google drive", "webdav", "unlink"]} onSelect={() => onNavigateView("settings", "integrations")}/>
          <Item icon={ShieldCheck} label="Vault settings" keywords={["pin", "recovery email", "auto-lock"]} onSelect={() => onNavigateView("settings", "vault")}/>
          {isOwner && <Item icon={Users} label="Users" keywords={["admin", "permissions"]} onSelect={() => onNavigateView("settings", "users")}/>}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="New">
          {NEW_ITEM_GROUPS.flatMap((g) => g.items).map(({ id, label, icon }) => <Item key={id} icon={icon} label={label} onSelect={() => onAction(id)}/>)}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <Item icon={RefreshCw} label="Refresh files" keywords={["reload"]} onSelect={() => onAction("refresh")}/>
          <Item icon={Laptop} label="Mount as drive (WebDAV)" keywords={["raidrive", "mixplorer", "webdav"]} onSelect={() => onAction("webdav")}/>
          <Item icon={Moon} label="Theme: Dark" keywords={["obsidian", "appearance"]} onSelect={() => setTheme("dark")}/>
          <Item icon={Sun} label="Theme: Light" keywords={["appearance"]} onSelect={() => setTheme("light")}/>
          <Item icon={Monitor} label="Theme: System" keywords={["appearance", "auto"]} onSelect={() => setTheme("system")}/>
          <Item icon={LogOut} label="Log out" keywords={["sign out"]} onSelect={() => onAction("logout")}/>
        </CommandGroup>
      </CommandList>
    </CommandDialog>);
};
