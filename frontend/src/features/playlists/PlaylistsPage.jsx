// Playlists: the same playlists as the Android app. /playlists lists them (Liked music first);
// /playlists/<id> shows one, to play, shuffle, reorder, rename or delete.
import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ListMusic, Loader2, MoreVertical, Pencil, Play, Plus, Shuffle, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useMediaPlayer } from "@/features/player/MediaPlayerContext";
import { Thumbnail } from "@/features/explorer/Thumbnail";
import { createOpenItem } from "@/features/explorer/actions/openItem";
import { PlaylistCover } from "./PlaylistCover";
import { countLabel, mapPlaylist, moveItem, playOrder, playlistIdFromPath, usePlaylists, useRefreshPlaylists } from "./playlists";

const NameForm = ({ initial = "", confirm, onSubmit, onCancel }) => {
    const [name, setName] = useState(initial);
    return (<form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== initial) onSubmit(name.trim()); }}>
      <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" aria-label="Playlist name" className="h-9 w-56 max-w-full"/>
      <Button type="submit" size="sm" disabled={!name.trim() || name.trim() === initial}>{confirm}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel"><X className="w-4 h-4"/></Button>
    </form>);
};

const PlaylistList = ({ onOpen }) => {
    const { data: playlists, isLoading, isError, error, refetch } = usePlaylists();
    const refresh = useRefreshPlaylists();
    const [creating, setCreating] = useState(false);
    const create = async (name) => {
        try {
            const made = await api.createPlaylist(name);
            refresh();
            setCreating(false);
            onOpen(made.id);
        }
        catch (e) {
            toast.error(e.message);
        }
    };
    return (<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <PageHeader icon={ListMusic} title="Playlists" subtitle="The same playlists as in the Android app" actions={creating
            ? <NameForm confirm="Create" onSubmit={create} onCancel={() => setCreating(false)}/>
            : <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1"/>New playlist</Button>}/>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6">
        {isLoading ? (<div className="grid place-items-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground"/></div>) : isError ? (<div className="grid justify-items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">{error?.message || "Couldn't load your playlists."}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </div>) : (<>
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 sm:gap-4">
              {playlists.map((p) => (<button key={p.id} type="button" onClick={() => onOpen(p.id)} className="group text-left rounded-xl p-2 hover:bg-card transition-colors">
                  <PlaylistCover playlist={p} className="w-full h-auto aspect-square rounded-xl group-hover:shadow-lg transition-shadow"/>
                  <span className="block mt-2 text-sm font-medium truncate">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{countLabel(p.count)}{p.isLiked ? " · always here" : ""}</span>
                </button>))}
            </div>
            {playlists.length <= 1 && (<p className="mt-6 text-sm text-muted-foreground max-w-prose">
                Make a playlist with New playlist, or from any song or video: right-click › Add to playlist. The heart in the music player adds to Liked music.
              </p>)}
          </>)}
      </div>
    </div>);
};

const PlaylistDetail = ({ id, onBack }) => {
    const { playMedia } = useMediaPlayer();
    const refreshAll = useRefreshPlaylists();
    const lastOpenTimeRef = useRef(0);
    const [renaming, setRenaming] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const query = useQuery({
        queryKey: ["playlists", "one", id],
        queryFn: async () => mapPlaylist(await api.fetchPlaylist(id)),
    });
    const playlist = query.data;
    const items = playlist?.items || [];

    const change = async (fn, fallback) => {
        try {
            await fn();
        }
        catch (e) {
            toast.error(e.message || fallback);
        }
        refreshAll();
    };
    const play = (index, shuffle = false) => {
        const order = playOrder(items, index, shuffle);
        const open = createOpenItem({
            items: order.items, lastOpenTimeRef, playMedia,
            setImageViewer: () => { }, onDownload: () => { }, onNavigate: () => { }, setArchiveInspect: () => { }, setDocumentReader: () => { },
            setIsSelectionMode: () => { }, setLastSelectedIndex: () => { }, setSelectedItems: () => { },
        });
        lastOpenTimeRef.current = 0;
        open(order.items[order.index]);
    };
    const move = (index, by) => change(() => api.reorderPlaylist(id, moveItem(items, index, by).map((i) => i.id)), "Couldn't move it");

    if (query.isLoading) return <div className="flex-1 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground"/></div>;
    if (query.isError || !playlist) {
        return (<div className="flex-1 grid place-items-center p-6 text-center">
        <div className="grid gap-3 justify-items-center">
          <p className="text-sm text-muted-foreground">{query.error?.message || "Playlist not found"}</p>
          <Button variant="outline" size="sm" onClick={onBack}>All playlists</Button>
        </div>
      </div>);
    }
    const missing = playlist.count - items.length;
    return (<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <header className="flex flex-wrap items-end gap-4 px-4 sm:px-6 pt-5 pb-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="All playlists" className="self-start -ml-2"><ArrowLeft className="w-5 h-5"/></Button>
        <PlaylistCover playlist={playlist} className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl shadow-lg"/>
        <div className="min-w-0 flex-1 basis-56 grid gap-2">
          {renaming ? (<NameForm initial={playlist.name} confirm="Rename" onCancel={() => setRenaming(false)} onSubmit={(name) => change(async () => { await api.renamePlaylist(id, name); setRenaming(false); await query.refetch(); }, "Couldn't rename it")}/>) : (<h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{playlist.name}</h1>)}
          <p className="text-sm text-muted-foreground">{countLabel(items.length)}{missing > 0 ? ` · ${missing} in Trash or deleted` : ""}</p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => play(0)} disabled={!items.length}><Play className="w-4 h-4 mr-1 fill-current"/>Play</Button>
            <Button size="sm" variant="secondary" onClick={() => play(Math.floor(Math.random() * items.length), true)} disabled={items.length < 2}><Shuffle className="w-4 h-4 mr-1"/>Shuffle</Button>
            {!playlist.isLiked && (<DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Playlist options"><MoreVertical className="w-4 h-4"/></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil className="w-4 h-4 mr-2"/>Rename</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive"><Trash2 className="w-4 h-4 mr-2"/>Delete playlist</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>)}
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {items.length === 0 ? (<p className="p-6 text-sm text-muted-foreground">
            {playlist.isLiked ? "Click the heart in the music player to add songs here." : "Add songs and videos with right-click › Add to playlist."}
          </p>) : (<ol className="py-2" aria-label={`${playlist.name} items`}>
            {items.map((item, index) => (<li key={item.id} className="group flex items-center gap-3 px-3 sm:px-5 py-1.5 hover:bg-muted/50 motion-safe:animate-in motion-safe:fade-in duration-200">
                <span className="w-6 text-right text-xs font-mono text-muted-foreground shrink-0">{index + 1}</span>
                <button type="button" onClick={() => play(index)} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label={`Play ${item.name}`}>
                  <span className="w-10 h-10 rounded-md overflow-hidden bg-muted grid place-items-center shrink-0"><Thumbnail item={item} size="fill"/></span>
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{item.name}</span>
                    <span className="block text-xs text-muted-foreground font-mono">{item.size ? formatBytes(item.size) : ""}</span>
                  </span>
                </button>
                <div className={cn("flex items-center shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity")}>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${item.name} up`}><ArrowUp className="w-4 h-4"/></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${item.name} down`}><ArrowDown className="w-4 h-4"/></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => change(() => api.removeFromPlaylist(id, [item.id]), "Couldn't remove it")} aria-label={`Remove ${item.name} from the playlist`}><X className="w-4 h-4"/></Button>
                </div>
              </li>))}
          </ol>)}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{playlist.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The songs and videos stay in your files.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => change(async () => { await api.deletePlaylist(id); onBack(); }, "Couldn't delete it")}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>);
};

export const PlaylistsPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const id = playlistIdFromPath(location.pathname);
    return id
        ? <PlaylistDetail key={id} id={id} onBack={() => navigate("/playlists")}/>
        : <PlaylistList onOpen={(pid) => navigate(`/playlists/${encodeURIComponent(pid)}`)}/>;
};
