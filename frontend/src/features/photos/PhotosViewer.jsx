// The Photos viewer, laid out like Google Photos (and the app): "Nov 1 ›" with the time and place
// at the top, star and ⋮; Share, Edit, Add to and Trash at the bottom. Videos play in place.
// ← / → move, Esc closes, i shows the details (date, caption, camera, file and place, editable).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Archive, ArchiveRestore, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cloud, Download, Info, Loader2, MapPin, MoreVertical,
    Pencil, Play, Plus, Printer, Share2, SlidersHorizontal, Star, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { isProtectedError } from "@/features/protection/protection";
import { cameraLabel, mapsUrl } from "@/features/viewers/photoInfo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { detailsDate, exposureCells, fileChips, PHOTOS_FOLDER, timelineDate, viewerDay, viewerLine } from "./timeline";
import { downloadItem, mediaUrl } from "./media";

const BarButton = ({ icon: Icon, label, onClick }) => (<button type="button" onClick={onClick} className="w-20 py-1.5 grid justify-items-center gap-1.5 text-white rounded-xl hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
    <Icon className="w-6 h-6" aria-hidden="true"/>
    <span className="text-sm">{label}</span>
  </button>);

/** Prints one photo through a hidden frame (the browser's print dialog). */
function printPhoto(item) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><title>${item.name.replace(/</g, "")}</title><style>html,body{margin:0;height:100%}img{max-width:100%;max-height:100vh;display:block;margin:auto}</style><img src="${mediaUrl(item)}">`);
    doc.close();
    const img = doc.querySelector("img");
    const go = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60_000); };
    if (img.complete) go(); else img.onload = go;
}

/** Shares the photo as a file where the browser can (phones), else copies nothing and downloads it. */
async function sharePhoto(item) {
    try {
        if (navigator.canShare) {
            const blob = await (await fetch(mediaUrl(item))).blob();
            const file = new File([blob], item.name, { type: blob.type });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: item.name });
                return;
            }
        }
    } catch (e) {
        if (e?.name === "AbortError") return;
    }
    downloadItem(item);
    toast.info("This browser can't share files: downloading it instead.");
}

/** "Add to": Favourites, or an album (a folder in the phone backup). */
export const AddToDialog = ({ open, onOpenChange, starred, onFavourite, onAlbum }) => {
    const albums = useQuery({
        queryKey: ["photos", "album-folders", PHOTOS_FOLDER],
        queryFn: async () => ((await api.fetchFiles(PHOTOS_FOLDER, 1, 500)).files || []).filter((f) => f.file_type === "folder"),
        enabled: open,
        staleTime: 60_000,
    });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gphotos sm:max-w-sm">
        <DialogHeader><DialogTitle>Add to</DialogTitle></DialogHeader>
        <div className="grid gap-1 max-h-[60vh] overflow-y-auto -mx-2">
          {onFavourite && (<button type="button" onClick={onFavourite} className="flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-muted text-left">
              <Star className={cn("w-5 h-5", starred && "fill-current")}/>{starred ? "Remove from Favourites" : "Favourites"}
            </button>)}
          <p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">Albums</p>
          {albums.isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto my-3 text-muted-foreground"/>}
          {albums.data?.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No albums yet.</p>}
          {albums.data?.map((f) => (<button key={f.id} type="button" onClick={() => onAlbum(f.file_name, `${f.file_path.replace(/\/$/, "")}/${f.file_name}`)} className="flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-muted text-left">
              <Plus className="w-5 h-5 opacity-0" aria-hidden="true"/>{f.file_name}
            </button>))}
        </div>
      </DialogContent>
    </Dialog>);
};

/** "Add a location": a place name and, if known, its position. */
const LocationDialog = ({ open, onOpenChange, initial, onSave }) => {
    const [place, setPlace] = useState(initial?.place || "");
    const [coords, setCoords] = useState(initial?.coords || "");
    useEffect(() => { if (open) { setPlace(initial?.place || ""); setCoords(initial?.coords || ""); } }, [open, initial]);
    const parsed = coords.trim() ? coords.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n)) : [];
    const coordsOk = !coords.trim() || (parsed.length === 2 && Math.abs(parsed[0]) <= 90 && Math.abs(parsed[1]) <= 180);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gphotos sm:max-w-sm">
        <DialogHeader><DialogTitle>Add a location</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Input autoFocus value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Place, e.g. Gandhinagar, Gujarat" aria-label="Place"/>
          <Input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="Position (optional), e.g. 23.21, 72.63" aria-label="Position"/>
          {!coordsOk && <p className="text-xs text-destructive">Write the position as latitude, longitude.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!place.trim() || !coordsOk} onClick={() => onSave(place.trim(), parsed.length === 2 ? parsed : null)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
};

/** The details panel: date (pencil), caption, Details cards, and the place. */
const DetailsPanel = ({ item, onClose, onChanged }) => {
    const { data: info, isLoading } = useQuery({
        queryKey: ["photo-info", item.id],
        queryFn: () => api.getPhotoInfo(item.id),
        enabled: item.fileType !== "video",
        staleTime: 5 * 60_000,
        retry: false,
    });
    const [caption, setCaption] = useState(item.photoCaption || "");
    const [editingDate, setEditingDate] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(true);
    const [locating, setLocating] = useState(false);
    useEffect(() => setCaption(item.photoCaption || ""), [item.id, item.photoCaption]);

    const save = async (fields, change) => {
        try {
            await api.setPhotoMeta(item.id, fields);
            onChanged({ ...item, ...change });
        } catch (e) {
            toast.error(e.message || "Couldn't save that.");
        }
    };
    const taken = timelineDate(item);
    const localValue = taken ? new Date(taken.getTime() - taken.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
    const camera = info ? cameraLabel(info.camera_make, info.camera_model) : "";
    const cells = exposureCells(info || {});
    const chips = fileChips(info || {});
    const lat = info?.latitude;
    const lon = info?.longitude;
    const place = item.place || info?.place;
    const maps = lat != null && lon != null ? mapsUrl(lat, lon) : null;
    const stop = (e) => e.stopPropagation();

    return (<aside aria-label="Photo details" onClick={stop} onPointerDown={stop} onWheel={stop} className="gphotos dark absolute z-[3] inset-x-0 bottom-0 max-h-[75vh] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[400px] bg-background text-foreground rounded-t-3xl sm:rounded-none overflow-y-auto">
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="text-xl">{detailsDate(taken)}</h2>
        <div className="flex">
          <button type="button" onClick={() => setEditingDate((v) => !v)} className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" aria-label="Change date and time"><Pencil className="w-5 h-5"/></button>
          <button type="button" onClick={onClose} className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" aria-label="Close details"><X className="w-5 h-5"/></button>
        </div>
      </div>
      {editingDate && (<form className="flex gap-2 px-5 pt-3" onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("when");
            if (!value) return;
            const iso = new Date(value).toISOString();
            save({ taken_at: iso }, { takenAt: iso });
            setEditingDate(false);
        }}>
          <Input type="datetime-local" name="when" defaultValue={localValue} aria-label="Date and time taken"/>
          <Button type="submit">Save</Button>
        </form>)}
      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => { if (caption.trim() !== (item.photoCaption || "").trim()) save({ caption }, { photoCaption: caption.trim() || null }); }} rows={1} placeholder="Add a caption…" aria-label="Caption" className="w-full resize-none bg-transparent px-5 py-4 text-lg placeholder:text-muted-foreground focus:outline-none"/>
      <h3 className="px-5 pb-3 text-lg">Details</h3>
      <div className="mx-4 rounded-3xl overflow-hidden grid gap-[3px]">
        <div className="bg-card px-5 py-4 flex gap-4">
          <Cloud className="w-6 h-6 shrink-0 mt-0.5"/>
          <div>
            <p className="text-base">Backed up</p>
            <p className="text-primary underline">Original quality</p>
            <p className="text-muted-foreground">Stored in TeleStore on Telegram. It doesn't use space on your devices or the server.</p>
          </div>
        </div>
        {isLoading && <div className="bg-card px-5 py-6 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/></div>}
        {(camera || cells.length > 0) && (<>
            <button type="button" onClick={() => setCameraOpen((v) => !v)} className="bg-card px-5 py-4 flex items-center gap-4 text-left" aria-expanded={cameraOpen}>
              <span className="w-6 h-6 rounded-full border-2 border-current shrink-0" aria-hidden="true"/>
              <span className="flex-1 text-base">{camera || "Camera"}</span>
              {cells.length > 0 && (cameraOpen ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5"/>)}
            </button>
            {cameraOpen && cells.length > 0 && (<div className="bg-card px-5 py-4 flex items-center">
                {cells.map((c, i) => (<span key={c} className="flex-1 flex items-center">
                    {i > 0 && <span className="w-px h-3 bg-muted-foreground/60 mr-auto" aria-hidden="true"/>}
                    <span className="mx-auto">{c}</span>
                  </span>))}
              </div>)}
          </>)}
        <div className="bg-card px-5 py-4">
          <p className="text-base break-all">{info?.file_name || item.name}</p>
          {chips.length > 0 && <div className="flex gap-2 mt-2">{chips.map((c) => <span key={c} className="rounded-lg bg-muted px-3 py-1">{c}</span>)}</div>}
        </div>
        <div className="bg-card px-5 py-4">
          <p className="text-base">In TeleStore{item.size ? ` • ${formatBytes(item.size)}` : ""}</p>
          <p className="text-muted-foreground break-all">{info?.folder || item.file_path}</p>
        </div>
      </div>
      <div className="flex items-center gap-6 px-7 py-5">
        <MapPin className={cn("w-6 h-6 shrink-0", !place && lat == null && "text-primary")}/>
        <div className="flex-1 min-w-0">
          {place || lat != null ? (<>
              {place && <p className="text-base">{place}</p>}
              {maps && <a href={maps} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">Open in Maps</a>}
            </>) : (<button type="button" onClick={() => setLocating(true)} className="text-base text-primary">Add a location</button>)}
        </div>
        {(place || lat != null) && <Button variant="ghost" size="sm" onClick={() => setLocating(true)}>Change</Button>}
      </div>
      <LocationDialog open={locating} onOpenChange={setLocating} initial={{ place: place || "", coords: lat != null && item.place ? `${lat}, ${lon}` : "" }} onSave={(name, at) => {
            setLocating(false);
            save(at ? { place: name, latitude: at[0], longitude: at[1] } : { place: name }, { place: name });
        }}/>
    </aside>);
};

/**
 * [items]: the timeline's photos and videos; [index]: where to start. [onChanged] gets the
 * updated item (or null with its id when it left: trashed or archived out of the list).
 */
export const PhotosViewer = ({ items: initialItems, index: startIndex, onClose, onChanged, onEdit }) => {
    const [items, setItems] = useState(initialItems);
    const [index, setIndex] = useState(startIndex);
    const [chrome, setChrome] = useState(true);
    const [details, setDetails] = useState(false);
    const [slideshow, setSlideshow] = useState(false);
    const [addTo, setAddTo] = useState(false);
    const [zoom, setZoom] = useState(null);
    const current = items[Math.min(index, items.length - 1)];
    const touch = useRef(null);

    const go = useCallback((delta) => {
        setZoom(null);
        setIndex((i) => Math.max(0, Math.min(items.length - 1, i + delta)));
    }, [items.length]);
    const replace = (next) => {
        setItems((list) => list.map((i) => (i.id === next.id ? next : i)));
        onChanged?.(next);
    };
    const remove = (item) => {
        const left = items.filter((i) => i.id !== item.id);
        onChanged?.(null, item.id);
        if (!left.length) return onClose();
        setItems(left);
        setIndex((i) => Math.min(i, left.length - 1));
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.target.closest?.("input, textarea")) return;
            if (e.key === "ArrowRight") go(1);
            else if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "Escape") { if (details) setDetails(false); else onClose(); }
            else if (e.key === "i") setDetails((v) => !v);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [go, details, onClose]);

    // Slideshow: a new photo every 4 seconds until the last (a click stops it)
    useEffect(() => {
        if (!slideshow) return undefined;
        const t = setTimeout(() => (index < items.length - 1 ? go(1) : setSlideshow(false)), 4000);
        return () => clearTimeout(t);
    }, [slideshow, index, items.length, go]);

    const star = async () => {
        try {
            await api.toggleStar(current.id, !current.starred);
            replace({ ...current, starred: !current.starred });
        } catch (e) { toast.error(e.message); }
    };
    const archive = async () => {
        try {
            await api.setPhotoMeta(current.id, { archived: !current.archived });
            toast.success(current.archived ? "Back in Photos" : "Moved to Archive");
            replace({ ...current, archived: !current.archived });
        } catch (e) { toast.error(e.message); }
    };
    const trash = async () => {
        if (current.protected || current.protected_by) return toast.error("This photo is protected from deletion.");
        try {
            await api.trashFile(current.id);
            toast.success("Moved to Trash");
            remove(current);
        } catch (e) { toast.error(isProtectedError(e) ? e.message : e.message || "Couldn't move it to Trash."); }
    };
    const toAlbum = async (name, path) => {
        setAddTo(false);
        try {
            await api.moveFile(current.id, path);
            toast.success(`Added to ${name}`);
            replace({ ...current, file_path: path });
        } catch (e) { toast.error(e.message); }
    };

    const date = useMemo(() => (current ? timelineDate(current) : null), [current]);
    if (!current) return null;
    const isVideo = current.fileType === "video";
    const shown = chrome && !slideshow;

    return (<div className="gphotos dark fixed inset-0 z-50 bg-black text-white select-none" role="dialog" aria-label={current.name}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
            if (touch.current == null || zoom) return;
            const dx = e.changedTouches[0].clientX - touch.current;
            if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
            touch.current = null;
        }}>
      <div className="absolute inset-0 grid place-items-center overflow-hidden" onClick={() => { if (slideshow) setSlideshow(false); else setChrome((v) => !v); }}>
        {isVideo ? (<video key={current.id} src={mediaUrl(current)} controls autoPlay playsInline className="max-w-full max-h-full" onClick={(e) => e.stopPropagation()}/>)
            : (<img key={current.id} src={mediaUrl(current)} alt={current.photoCaption || current.name} draggable={false}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setZoom((z) => (z ? null : { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }));
                }}
                style={zoom ? { transform: "scale(2.5)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
                className="max-w-full max-h-full object-contain transition-transform duration-200"/>)}
      </div>

      {shown && index > 0 && <button type="button" onClick={() => go(-1)} className="hidden sm:grid absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 place-items-center rounded-full bg-black/40 hover:bg-black/60" aria-label="Previous"><ChevronLeft className="w-7 h-7"/></button>}
      {shown && index < items.length - 1 && <button type="button" onClick={() => go(1)} className="hidden sm:grid absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 place-items-center rounded-full bg-black/40 hover:bg-black/60" aria-label="Next"><ChevronRight className="w-7 h-7"/></button>}

      <div className={cn("absolute inset-x-0 top-0 flex items-center gap-1 px-2 pt-3 pb-8 bg-gradient-to-b from-black/80 to-transparent transition-opacity", shown ? "opacity-100" : "opacity-0 pointer-events-none")}>
        <button type="button" onClick={onClose} className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/10" aria-label="Back"><ArrowLeft className="w-6 h-6"/></button>
        <button type="button" onClick={() => setDetails(true)} className="flex-1 min-w-0 grid justify-items-center">
          <span className="flex items-center text-xl">{viewerDay(date) || current.name}<ChevronRight className="w-5 h-5"/></span>
          <span className="text-sm text-white/80 truncate max-w-full">{viewerLine(date, current.place)}</span>
        </button>
        <button type="button" onClick={star} className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/10" aria-label={current.starred ? "Remove from Favourites" : "Add to Favourites"} aria-pressed={current.starred}>
          <Star className={cn("w-6 h-6", current.starred && "fill-white")}/>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/10" aria-label="More"><MoreVertical className="w-6 h-6"/></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="gphotos dark w-60 bg-black text-white border-white/10">
            <DropdownMenuItem onSelect={() => setDetails(true)} className="gap-4 py-3 text-base"><Info className="w-5 h-5"/>About</DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/15"/>
            <DropdownMenuItem onSelect={archive} className="gap-4 py-3 text-base">{current.archived ? <ArchiveRestore className="w-5 h-5"/> : <Archive className="w-5 h-5"/>}{current.archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { setChrome(false); setSlideshow(true); }} className="gap-4 py-3 text-base"><Play className="w-5 h-5"/>Slideshow</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => downloadItem(current)} className="gap-4 py-3 text-base"><Download className="w-5 h-5"/>Download</DropdownMenuItem>
            {!isVideo && <DropdownMenuItem onSelect={() => printPhoto(current)} className="gap-4 py-3 text-base"><Printer className="w-5 h-5"/>Print</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn("absolute inset-x-0 bottom-0 flex justify-around pt-8 pb-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity", shown && !isVideo ? "opacity-100" : shown ? "opacity-100 pointer-events-none [&>*]:pointer-events-auto" : "opacity-0 pointer-events-none")}>
        <BarButton icon={Share2} label="Share" onClick={() => sharePhoto(current)}/>
        <BarButton icon={SlidersHorizontal} label="Edit" onClick={() => (isVideo ? toast.info("Trim videos in the TeleStore Android app.") : onEdit?.(current))}/>
        <BarButton icon={Plus} label="Add to" onClick={() => setAddTo(true)}/>
        <BarButton icon={Trash2} label="Trash" onClick={trash}/>
      </div>

      {details && <DetailsPanel item={current} onClose={() => setDetails(false)} onChanged={replace}/>}
      <AddToDialog open={addTo} onOpenChange={setAddTo} starred={current.starred} onFavourite={() => { setAddTo(false); star(); }} onAlbum={toAlbum}/>
    </div>);
};
