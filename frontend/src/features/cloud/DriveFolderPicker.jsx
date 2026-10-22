import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, ChevronRight, Cloud, Folder, FolderPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const MY_DRIVE = { id: "my_drive", name: "My Drive" };

/** Pick a folder inside one Google Drive account. onSelect receives { id, name }. */
export const DriveFolderPicker = ({ open, onOpenChange, accountId, accountName, onSelect }) => {
    const [trail, setTrail] = useState([MY_DRIVE]);
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [newName, setNewName] = useState(null);
    const [creating, setCreating] = useState(false);
    const here = trail[trail.length - 1];

    useEffect(() => {
        if (open)
            setTrail([MY_DRIVE]);
    }, [open, accountId]);

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.fetchCloudFiles(accountId, here.id, 200);
            setFolders((res.files || []).filter((f) => f.is_folder).map((f) => ({ id: f.id, name: f.name })));
        }
        catch (err) {
            toast.error(err.message);
            setFolders([]);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        if (open && accountId)
            load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the folder changes
    }, [open, accountId, here.id]);

    const create = async (e) => {
        e.preventDefault();
        const name = (newName || "").trim();
        if (!name)
            return;
        setCreating(true);
        try {
            await api.createCloudFolder(accountId, name, here.id === "my_drive" ? "root" : here.id);
            setNewName(null);
            await load();
        }
        catch (err) {
            toast.error(err.message);
        }
        finally {
            setCreating(false);
        }
    };

    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base"><Cloud className="w-4 h-4 text-info"/>Choose a folder in {accountName || "Google Drive"}</DialogTitle>
          <DialogDescription className="text-xs">Files are saved into the folder that is open when you press Save here.</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-2 border-b border-border bg-muted/20 flex items-center gap-2 min-w-0">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={trail.length === 1} onClick={() => setTrail(trail.slice(0, -1))} aria-label="Go to parent folder">
            <ArrowLeft className="w-3.5 h-3.5"/>
          </Button>
          <nav aria-label="Drive folder" className="flex items-center gap-1 min-w-0 overflow-x-auto text-xs">
            {trail.map((f, i) => (<span key={f.id} className="flex items-center gap-1 shrink-0">
                {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground"/>}
                <button type="button" onClick={() => setTrail(trail.slice(0, i + 1))} className={i === trail.length - 1 ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}>{f.name}</button>
              </span>))}
          </nav>
          <Button type="button" variant="outline" size="sm" className="h-7 ml-auto shrink-0 text-xs" onClick={() => setNewName(newName === null ? "" : null)}>
            <FolderPlus className="w-3.5 h-3.5 mr-1"/>New folder
          </Button>
        </div>

        {newName !== null && (<form onSubmit={create} className="px-5 py-2 border-b border-border flex gap-2">
            <Input autoFocus aria-label="New folder name" placeholder="Folder name" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-xs"/>
            <Button type="submit" size="sm" className="h-8" disabled={creating || !newName.trim()}>{creating ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : "Create"}</Button>
          </form>)}

        <div className="flex-1 overflow-y-auto p-4 min-h-[200px] max-h-[320px]">
          {loading ? (<div className="flex items-center justify-center h-40 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin"/></div>) : folders.length === 0 ? (<p className="text-xs text-muted-foreground text-center pt-14">No folders here. You can save into this one.</p>) : (<div className="grid sm:grid-cols-2 gap-2">
              {folders.map((f) => (<button key={f.id} type="button" aria-label={`Open ${f.name}`} onClick={() => setTrail([...trail, f])} className="flex items-center gap-2 p-2.5 rounded-lg border border-border hover:bg-accent text-left text-xs min-w-0">
                  <Folder className="w-4 h-4 text-primary shrink-0"/><span className="truncate">{f.name}</span>
                </button>))}
            </div>)}
        </div>

        <DialogFooter className="p-4 border-t border-border gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => { onSelect(here); onOpenChange(false); }}><Check className="w-3.5 h-3.5 mr-1.5"/>Save here</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
};
