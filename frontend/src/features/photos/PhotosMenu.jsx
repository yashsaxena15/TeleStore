// The account button at the top right of Photos: your initial in a ring (as in the app, where the
// ring shows the phone backup's status; backup doesn't run in the browser, so it stays grey). It
// opens Photos view, Collections and the backup folder in Files.
import { FolderOpen, LayoutDashboard, Library, Smartphone } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUserProfile, displayName } from "@/hooks/useShellData";
import { PHOTOS_FOLDER } from "./timeline";

export const PhotosMenu = ({ onPhotosView, onCollections }) => {
    const profile = useUserProfile();
    const name = profile ? displayName(profile) : "";
    const initial = (name || "?").charAt(0).toUpperCase();
    const openFolder = () => window.dispatchEvent(new CustomEvent("changeCategory", { detail: { folderPath: PHOTOS_FOLDER } }));
    return (<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account and Photos settings" className="w-11 h-11 rounded-full p-[3px] ring-2 ring-muted-foreground/35 hover:ring-primary/60 transition-shadow grid place-items-center ml-1">
          <span className="w-full h-full rounded-full bg-primary/20 text-primary text-sm font-semibold grid place-items-center">{initial}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="gphotos w-64">
        {name && <DropdownMenuLabel className="font-medium">{name}</DropdownMenuLabel>}
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-xs text-muted-foreground">
          <Smartphone className="w-3.5 h-3.5 shrink-0"/>Backup runs in the TeleStore Android app
        </DropdownMenuLabel>
        <DropdownMenuSeparator/>
        <DropdownMenuItem onSelect={onCollections} className="gap-3 py-2.5"><Library className="w-4 h-4"/>Collections</DropdownMenuItem>
        <DropdownMenuItem onSelect={onPhotosView} className="gap-3 py-2.5"><LayoutDashboard className="w-4 h-4"/>Photos view</DropdownMenuItem>
        <DropdownMenuItem onSelect={openFolder} className="gap-3 py-2.5"><FolderOpen className="w-4 h-4"/>Open backup folder in Files</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
};
