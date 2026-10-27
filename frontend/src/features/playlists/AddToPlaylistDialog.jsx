// "Add to playlist": opened from the file menu, the selection bar and the players (see
// requestAddToPlaylist). Mounted once, in FileExplorer.
import { useEffect, useState } from "react";
import { CheckCircle2, ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PlaylistCover } from "./PlaylistCover";
import { countLabel, onAddToPlaylistRequest, usePlaylists, useRefreshPlaylists } from "./playlists";

export const AddToPlaylistDialog = () => {
    const [items, setItems] = useState(null);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const { data: playlists, isLoading } = usePlaylists();
    const refresh = useRefreshPlaylists();

    useEffect(() => onAddToPlaylistRequest((list) => {
        setItems(list);
        setCreating(false);
        setName("");
        refresh();
    }), []); // eslint-disable-line react-hooks/exhaustive-deps

    const close = () => setItems(null);
    const ids = (items || []).map((i) => i.id);
    const what = items?.length === 1 ? items[0].name : `${items?.length || 0} items`;

    const addTo = async (playlist) => {
        setBusy(true);
        try {
            const res = await api.addToPlaylist(playlist.id, ids);
            const added = res.added ?? ids.length;
            toast.success(added === 0 ? `Already in ${playlist.name}` : `Added ${countLabel(added)} to ${playlist.name}`);
            refresh();
            close();
        }
        catch (e) {
            toast.error(e.message);
        }
        finally {
            setBusy(false);
        }
    };
    const create = async (e) => {
        e.preventDefault();
        const clean = name.trim();
        if (!clean) return;
        setBusy(true);
        try {
            await api.createPlaylist(clean, ids);
            toast.success(`Added to ${clean}`);
            refresh();
            close();
        }
        catch (err) {
            toast.error(err.message);
        }
        finally {
            setBusy(false);
        }
    };

    return (<Dialog open={Boolean(items)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>Add to playlist</DialogTitle>
          <DialogDescription className="truncate">{what}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-2 pb-3">
          {creating ? (<form onSubmit={create} className="flex gap-2 px-3 py-2">
              <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" aria-label="Playlist name"/>
              <Button type="submit" disabled={busy || !name.trim()}>Create</Button>
            </form>) : (<button type="button" onClick={() => setCreating(true)} className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-muted">
              <span className="w-11 h-11 rounded-lg grid place-items-center bg-primary/15 text-primary shrink-0"><ListPlus className="w-5 h-5"/></span>
              <span className="text-sm font-medium">New playlist</span>
            </button>)}
          {isLoading && <div className="grid place-items-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/></div>}
          {(playlists || []).map((p) => {
            const already = ids.length > 0 && ids.every((id) => p.fileIds.includes(id));
            return (<button key={p.id} type="button" disabled={busy || already} onClick={() => addTo(p)} className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-muted disabled:hover:bg-transparent disabled:cursor-default">
                <PlaylistCover playlist={p} className="w-11 h-11"/>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{countLabel(p.count)}</span>
                </span>
                {already && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" aria-label="Already in it"/>}
              </button>);
        })}
        </div>
      </DialogContent>
    </Dialog>);
};
