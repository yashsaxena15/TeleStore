import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, UserRound, Palette, Plug, FolderDown, Cloud, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useIsOwner } from "@/hooks/useShellData";
import { cn } from "@/lib/utils";
import { AccountSection } from "./sections/AccountSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { ConnectionSection } from "./sections/ConnectionSection";
import { DownloadsSection } from "./sections/DownloadsSection";
import { IntegrationsSection } from "./sections/IntegrationsSection";
import { VaultSection } from "./sections/VaultSection";
import { UsersSection } from "./sections/UsersSection";
import { settingsTabFromLocation, SETTINGS_TABS } from "./settingsTabs";

const ICONS = { account: UserRound, appearance: Palette, connection: Plug, downloads: FolderDown, integrations: Cloud, vault: ShieldCheck, users: Users };

/**
 * Settings, with a sub-menu: Account, Appearance, Connection, Downloads, Integrations, Vault, Users (owner).
 * The tab lives in the URL (/settings?tab=vault); the old /profile and /users addresses open their tab.
 */
export const SettingsContent = ({ onOpenDrive, onOpenVault, onLogout }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const isOwner = useIsOwner();
    const tabs = SETTINGS_TABS.filter((t) => !t.ownerOnly || isOwner);
    const requested = settingsTabFromLocation(location.pathname, location.search);
    // Users is owner-only; anyone else (or the owner check still loading) sees Account
    const tab = tabs.some((t) => t.id === requested) ? requested : "account";
    const select = (id) => navigate(`/settings?tab=${id}`, { replace: true });
    // On phones the sub-menu is a scrolling row; keep the open tab in view
    const activeRef = useRef(null);
    useEffect(() => {
        activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }, [tab]);
    const sections = {
        account: <AccountSection onLogout={onLogout}/>,
        appearance: <AppearanceSection />,
        connection: <ConnectionSection />,
        downloads: <DownloadsSection />,
        integrations: <IntegrationsSection onOpenDrive={onOpenDrive}/>,
        vault: <VaultSection onOpenVault={onOpenVault}/>,
        users: <UsersSection />,
    };
    return (<div className="flex-1 flex flex-col min-h-0 bg-background">
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Account, connection, integrations and vault in one place"/>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 md:grid md:grid-cols-[180px_minmax(0,1fr)] md:gap-8 md:items-start">
          <nav aria-label="Settings sections" className="flex md:flex-col gap-1 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-3 md:pb-0 md:sticky md:top-0">
            {tabs.map(({ id, label }) => {
            const Icon = ICONS[id];
            const active = id === tab;
            return (<button key={id} ref={active ? activeRef : undefined} type="button" onClick={() => select(id)} aria-current={active ? "page" : undefined} className={cn("shrink-0 h-8 md:h-9 inline-flex items-center gap-2.5 px-3 rounded-md text-sm transition-colors whitespace-nowrap", active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/60")}>
                  <Icon className="w-4 h-4 shrink-0"/>{label}
                </button>);
        })}
          </nav>
          <div className="min-w-0 pb-24">{sections[tab]}</div>
        </div>
      </div>
    </div>);
};
export default SettingsContent;
