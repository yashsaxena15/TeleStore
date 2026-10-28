// The button at the top right of Photos: your initial in a ring (as in the app, where the ring
// shows the phone backup's status; here backup isn't running in the browser, so it stays grey).
// It opens the views: all photos, starred, one album, and the backup folder in Files.
import { useQuery } from "@tanstack/react-query";
import { Check, FolderOpen, Images, Smartphone, Star } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUserProfile, displayName } from "@/hooks/useShellData";
import { api } from "@/lib/api";
import { albumNames, PHOTOS_FOLDER } from "./timeline";

const Choice = ({ icon: Icon, label, active, onSelect }) => (<DropdownMenuItem onSelect={onSelect} className="gap-2">
    <Icon className="w-4 h-4"/>
    <span className="flex-1 truncate">{label}</span>
    {active && <Check className="w-4 h-4 text-primary" aria-label="Showing"/>}
  </DropdownMenuItem>);

export const PhotosMenu = ({ view, onViewChange }) => {
    const profile = useUserProfile();
    const initial = (profile ? displayName(profile) : "?").charAt(0).toUpperCase();
    const albums = useQuery({
        queryKey: ["photos", "albums", PHOTOS_FOLDER],
        queryFn: async () => albumNames((await api.fetchFiles(PHOTOS_FOLDER, 1, 500)).files),
        staleTime: 1000 * 60 * 5,
    });
    const openFolder = () => window.dispatchEvent(new CustomEvent("changeCategory", { detail: { folderPath: PHOTOS_FOLDER } }));
    return (<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Photos menu" className="w-10 h-10 rounded-full p-[3px] ring-2 ring-muted-foreground/35 hover:ring-primary/60 transition-shadow grid place-items-center">
          <span className="w-full h-full rounded-full bg-primary/15 text-primary text-sm font-semibold grid place-items-center">{initial}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-xs text-muted-foreground">
          <Smartphone className="w-3.5 h-3.5 shrink-0"/>Backup runs in the TeleStore Android app
        </DropdownMenuLabel>
        <DropdownMenuSeparator/>
        <Choice icon={Images} label="All photos" active={view.kind === "all"} onSelect={() => onViewChange({ kind: "all" })}/>
        <Choice icon={Star} label="Starred" active={view.kind === "starred"} onSelect={() => onViewChange({ kind: "starred" })}/>
        <DropdownMenuSeparator/>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Albums</DropdownMenuLabel>
        {albums.isLoading && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading albums…</p>}
        {albums.isError && <p className="px-2 py-1.5 text-xs text-destructive">Couldn't load albums.</p>}
        {albums.data?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No albums yet.</p>}
        <div className="max-h-56 overflow-y-auto">
          {albums.data?.map((name) => <Choice key={name} icon={FolderOpen} label={name} active={view.kind === "album" && view.name === name} onSelect={() => onViewChange({ kind: "album", name })}/>)}
        </div>
        <DropdownMenuSeparator/>
        <DropdownMenuItem onSelect={openFolder} className="gap-2"><FolderOpen className="w-4 h-4"/>Open backup folder in Files</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
};
