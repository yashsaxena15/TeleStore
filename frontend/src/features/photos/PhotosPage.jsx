// Photos, laid out like Google Photos (and the Android app): the phone backup's photos and videos
// as a timeline with memories, month titles, days with their places, and three layouts
// (Comfortable, Day, Month; ctrl + scroll or the Photos view dialog switches). Select with the
// circle (or a long press on touch screens): a "✕ 3" pill and a sheet of actions appear. Click
// opens the viewer; Edit there opens the editor.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Archive, ArrowLeft, Check, Download, FolderInput, FolderPlus, Images, LayoutDashboard, LayoutGrid, Grid3x3, Layers, Library, Loader2,
    MoreVertical, PlayCircle, Plus, Share2, Star, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { isProtectedError, notDeletedMessage, protectedSelectionReason } from "@/features/protection/protection";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/features/notifications/NotificationsPanel";
import { uploadManager } from "@/features/transfers/uploadManager";
import { apiFileToFileItem } from "@/features/explorer/fileTypes";
import { Thumbnail } from "@/features/explorer/Thumbnail";
import {
    bigger, comfortableRows, gridRows, groupByDay, groupByMonth, memories, monthLabel, monthTitle, PHOTOS_FOLDER, photosUnder, places, smaller,
    stacks, videoLength,
} from "./timeline";
import { usePhotosView } from "./photoView";
import { downloadItem, mediaUrl } from "./media";
import { PhotosMenu } from "./PhotosMenu";
import { PhotosViewer, AddToDialog } from "./PhotosViewer";
import { PhotoEditor } from "./PhotoEditor";
import { Collections } from "./Collections";

const PAGE_SIZE = 200;
const LONG_PRESS_MS = 450;
const GAP = 2;

/** One tile: a photo, or a stack of similar ones shown by its first. */
const Tile = ({ tile, style, selected, selecting, onOpen, onToggle }) => {
    const item = tile.items[0];
    const pressTimer = useRef(null);
    const longPressed = useRef(false);
    const startPress = (e) => {
        if (e.pointerType !== "touch") return;
        longPressed.current = false;
        pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            navigator.vibrate?.(20);
            onToggle(tile);
        }, LONG_PRESS_MS);
    };
    const endPress = () => clearTimeout(pressTimer.current);
    const length = item.fileType === "video" ? videoLength(item.duration) : null;
    return (<div role="gridcell" data-testid="photo-tile" aria-selected={selected} style={style}
        className={cn("group relative cursor-pointer select-none overflow-hidden transition-colors duration-200", selected ? "bg-muted" : "bg-card")}
        onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
        onContextMenu={(e) => { if (e.nativeEvent.pointerType === "touch" || longPressed.current) e.preventDefault(); }}
        onClick={() => {
            if (longPressed.current) { longPressed.current = false; return; }
            if (selecting) onToggle(tile); else onOpen(item);
        }}>
      {/* Selected photos shrink into a rounded tile on grey, as in Google Photos */}
      <div className={cn("absolute inset-0 overflow-hidden transition-all duration-200 ease-out", selected && "motion-safe:inset-3.5 rounded-2xl")}>
        <Thumbnail item={item} size="fill"/>
      </div>
      {item.fileType === "video" ? (<span className="absolute top-1.5 right-1.5 flex items-center gap-1 text-white text-sm font-medium drop-shadow pointer-events-none">
          {length}<PlayCircle className="w-6 h-6" aria-label="Video"/>
        </span>) : tile.items.length > 1 && (<span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-lg bg-black/40 px-1.5 py-0.5 text-white text-xs pointer-events-none" aria-label={`${tile.items.length} similar photos`}>
          <Layers className="w-3.5 h-3.5"/>{tile.items.length}
        </span>)}
      {item.starred && !selecting && <Star className="absolute bottom-1.5 left-1.5 w-[18px] h-[18px] fill-white text-white drop-shadow pointer-events-none" aria-label="Favourite"/>}
      <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(tile); }}
          className={cn("absolute top-1.5 left-1.5 rounded-full transition-opacity", selecting || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}
          aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`} aria-pressed={selected}>
        {selected
            ? <span className="w-[26px] h-[26px] rounded-full bg-primary text-primary-foreground grid place-items-center ring-2 ring-muted motion-safe:animate-select-pop"><Check className="w-4 h-4" strokeWidth={3}/></span>
            : <span className="block w-[26px] h-[26px] rounded-full border-2 border-white drop-shadow"/>}
      </button>
    </div>);
};

/** A row of tiles: even squares, one wide photo, or a big square beside two small ones. */
const TileRow = ({ row, width, render }) => {
    if (row.kind === "hero") return <div className="w-full aspect-[3/2]">{render(row.item, { width: "100%", height: "100%" })}</div>;
    if (row.kind === "feature") {
        const small = (width - GAP * 2) / 3;
        const big = small * 2 + GAP;
        const column = (<div className="flex flex-col" style={{ gap: GAP }}>{row.small.map((t) => <div key={t.items[0].id}>{render(t, { width: small, height: small })}</div>)}</div>);
        return (<div className="flex" style={{ gap: GAP }}>
          {row.bigOnLeft && render(row.big, { width: big, height: big })}
          {column}
          {!row.bigOnLeft && render(row.big, { width: big, height: big })}
        </div>);
    }
    return (<div className="grid" style={{ gap: GAP, gridTemplateColumns: `repeat(${row.columns}, minmax(0, 1fr))` }}>
      {row.items.map((t) => <div key={t.items[0].id} className="aspect-square">{render(t, { width: "100%", height: "100%" })}</div>)}
    </div>);
};

/** "Today" with its places, the tick that selects the whole day, and the day's menu. */
const DayHeader = ({ day, allSelected, onToggleDay, onDownloadDay }) => {
    const where = places(day.items.map((i) => i.place));
    return (<div className="flex items-center gap-1 pl-4 pr-1 pt-5 pb-2.5">
      <div className="flex-1 min-w-0">
        <h2 className="text-xl">{day.label}</h2>
        {where && <p className="text-muted-foreground truncate">{where}</p>}
      </div>
      <button type="button" onClick={onToggleDay} className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" aria-label={allSelected ? `Deselect ${day.label}` : `Select ${day.label}`} aria-pressed={allSelected}>
        {allSelected ? <span className="w-[26px] h-[26px] rounded-full bg-primary text-primary-foreground grid place-items-center"><Check className="w-4 h-4" strokeWidth={3}/></span>
            : <span className="w-[26px] h-[26px] rounded-full border-2 border-muted-foreground grid place-items-center"><Check className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={3}/></span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" aria-label={`More for ${day.label}`}><MoreVertical className="w-5 h-5"/></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="gphotos">
          <DropdownMenuItem onSelect={onToggleDay} className="gap-3"><Check className="w-4 h-4"/>{allSelected ? "Unselect all" : "Select all"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onDownloadDay} className="gap-3"><Download className="w-4 h-4"/>Download all</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>);
};

/** Tall rounded cards with the memory's name ("1 year ago", "Recent highlights"). */
const Memories = ({ list, onOpen }) => (<div className="flex gap-2.5 overflow-x-auto px-4 pt-2 pb-3 custom-scrollbar" role="list" aria-label="Memories">
    {list.map((m) => (<button key={m.title} type="button" role="listitem" onClick={() => onOpen(m.items)} className="relative shrink-0 w-[42vw] max-w-[200px] aspect-[3/4] rounded-[20px] overflow-hidden bg-muted text-left">
        <Thumbnail item={m.items[0]} size="fill"/>
        <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60"/>
        <span className="absolute left-3.5 right-3 bottom-4 text-white text-xl leading-tight font-medium drop-shadow">{m.title}</span>
      </button>))}
  </div>);

/** "Photos view": the layout and stacks (other apps' photos are a phone setting, in the app). */
const PhotosViewDialog = ({ open, onOpenChange, view, onChange }) => {
    const choices = [["comfortable", LayoutDashboard, "Comfortable"], ["day", LayoutGrid, "Day"], ["month", Grid3x3, "Month"]];
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gphotos sm:max-w-md">
        <DialogHeader><DialogTitle>Photos view</DialogTitle></DialogHeader>
        <p className="text-sm">Layout</p>
        <div className="flex justify-around py-2" role="radiogroup" aria-label="Layout">
          {choices.map(([key, Icon, label]) => (<button key={key} type="button" role="radio" aria-checked={view.layout === key} onClick={() => onChange({ layout: key })} className="grid justify-items-center gap-3">
              <Icon className={cn("w-9 h-9", view.layout === key ? "text-primary" : "text-muted-foreground")}/>
              <span className={cn("px-3.5 py-1 rounded-full text-sm", view.layout === key && "bg-primary text-primary-foreground")}>{label}</span>
            </button>))}
        </div>
        <label className="flex items-center gap-4 pt-4">
          <span className="flex-1">
            <span className="block text-base">Stack similar photos</span>
            <span className="block text-sm text-muted-foreground">Automatically group similar photos that were taken together.</span>
          </span>
          <Switch checked={view.stackSimilar} onCheckedChange={(on) => onChange({ stackSimilar: on })}/>
        </label>
        <p className="text-xs text-muted-foreground pt-2">Which phone apps' photos show is set in the TeleStore Android app.</p>
      </DialogContent>
    </Dialog>);
};

const NewAlbumDialog = ({ open, onOpenChange, onCreate }) => {
    const [name, setName] = useState("");
    useEffect(() => { if (open) setName(""); }, [open]);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gphotos sm:max-w-sm">
        <DialogHeader><DialogTitle>New album</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim().replace(/\//g, "-")); }}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Album name" aria-label="Album name"/>
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim()}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
};

/** The sheet at the bottom while photos are selected: actions, then "Add to album" with covers. */
const SelectionSheet = ({ count, onShare, onAddTo, onFavourite, allStarred, onDownload, onArchive, archived, onTrash, trashBlocked, onAlbum, onNewAlbum }) => {
    const albums = useQuery({
        queryKey: ["photos", "albums", PHOTOS_FOLDER],
        queryFn: async () => (await api.fetchFiles(PHOTOS_FOLDER, 1, 500)).files.filter((f) => f.file_type === "folder").map((f) => f.file_name).sort((a, b) => a.localeCompare(b)),
        staleTime: 60_000,
    });
    const actions = [
        [Share2, "Share", onShare], [Plus, "Add to album", onAddTo], [Star, allStarred ? "Unfavourite" : "Favourite", onFavourite],
        [Download, "Download", onDownload], [Archive, archived ? "Unarchive" : "Archive", onArchive], [Trash2, "Trash", onTrash, trashBlocked],
    ];
    return (<div className="absolute inset-x-0 bottom-0 z-20 rounded-t-[28px] bg-card shadow-2xl animate-in slide-in-from-bottom duration-200" role="toolbar" aria-label={`${count} selected`}>
      <div className="mx-auto mt-3 mb-2 h-1 w-8 rounded-full bg-muted-foreground/40" aria-hidden="true"/>
      <div className="flex overflow-x-auto px-2 custom-scrollbar">
        {actions.map(([Icon, label, onClick, blocked]) => (<button key={label} type="button" onClick={onClick} title={blocked || undefined} aria-disabled={Boolean(blocked) || undefined}
            className={cn("shrink-0 w-24 py-2.5 grid justify-items-center gap-2.5 rounded-2xl hover:bg-muted", blocked && "opacity-45")}>
            <Icon className="w-6 h-6"/><span className="text-sm text-center leading-tight">{label}</span>
          </button>))}
      </div>
      <div className="mx-5 my-3 h-px bg-border"/>
      <div className="flex items-center px-5">
        <h3 className="flex-1 text-xl">Add to album</h3>
        <Button variant="ghost" onClick={onAddTo} className="text-primary">View all</Button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto px-4 pt-2 pb-4 custom-scrollbar">
        <button type="button" onClick={onNewAlbum} className="shrink-0 w-28 text-left">
          <span className="w-28 h-28 rounded-2xl bg-muted grid place-items-center"><FolderPlus className="w-8 h-8 text-primary"/></span>
          <span className="block mt-1.5 text-sm">New album</span>
        </button>
        {albums.data?.map((name) => (<button key={name} type="button" onClick={() => onAlbum(name)} className="shrink-0 w-28 text-left">
            <AlbumCover name={name}/>
            <span className="block mt-1.5 text-sm truncate">{name}</span>
          </button>))}
      </div>
    </div>);
};

const AlbumCover = ({ name }) => {
    const cover = useQuery({
        queryKey: ["photos", "cover", name],
        queryFn: async () => {
            const res = await api.fetchMedia(`${PHOTOS_FOLDER}/${name}`, 1, 1);
            return res.files?.[0] ? apiFileToFileItem(res.files[0]) : null;
        },
        staleTime: 5 * 60_000,
    });
    return (<span className="block w-28 h-28 rounded-2xl overflow-hidden bg-muted">
      {cover.data ? <Thumbnail item={cover.data} size="fill"/> : <span className="w-full h-full grid place-items-center"><Images className="w-8 h-8 text-primary"/></span>}
    </span>);
};

const VIEW_TITLES = { starred: "Favourites", archive: "Archive" };

export const PhotosPage = () => {
    const queryClient = useQueryClient();
    const [view, setView] = usePhotosView();
    const [selected, setSelected] = useState(() => new Set());
    // What shows: all photos, Favourites, the Archive, one album, or Collections
    const [show, setShow] = useState({ kind: "all" });
    const [viewer, setViewer] = useState(null);
    const [editing, setEditing] = useState(null);
    const [viewDialog, setViewDialog] = useState(false);
    const [newAlbum, setNewAlbum] = useState(null);
    const [addTo, setAddTo] = useState(false);
    const [width, setWidth] = useState(0);
    const scroller = useRef(null);
    const sentinel = useRef(null);
    const uploadInput = useRef(null);
    const under = photosUnder(show);
    const archive = show.kind === "archive";

    const query = useInfiniteQuery({
        queryKey: ["files", "photos", archive ? "archive" : under],
        queryFn: async ({ pageParam }) => {
            const res = archive ? await api.fetchFiles("archive", pageParam, PAGE_SIZE) : await api.fetchMedia(under, pageParam, PAGE_SIZE);
            return { files: (res.files || []).filter((f) => f.file_type !== "folder").map(apiFileToFileItem), pagination: res.pagination };
        },
        initialPageParam: 1,
        getNextPageParam: (last, pages) => (last.pagination?.has_next ? pages.length + 1 : undefined),
        staleTime: 1000 * 60 * 2,
        enabled: show.kind !== "collections",
    });
    const loaded = useMemo(() => (query.data?.pages || []).flatMap((p) => p.files), [query.data]);
    const items = useMemo(() => (show.kind === "starred" ? loaded.filter((i) => i.starred) : loaded), [loaded, show.kind]);
    const days = useMemo(() => groupByDay(items), [items]);
    const memoryList = useMemo(() => (show.kind === "all" ? memories(items) : []), [items, show.kind]);

    // The width decides how many photos fit in a row
    useEffect(() => {
        const el = scroller.current;
        if (!el) return undefined;
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(el);
        return () => observer.disconnect();
    }, [show.kind]);
    // (Before the first measurement a phone-sized width keeps the sums sensible)
    const comfortableWidth = Math.min(width || 360, 960);
    const columns = view.layout === "month" ? Math.max(5, Math.floor(width / 110)) : Math.max(3, Math.floor(width / 220));

    // Rows: month titles, day headings and rows of tiles (Month view: one title per month)
    const rows = useMemo(() => {
        const tilesOf = (list) => (view.stackSimilar ? stacks(list) : list.map((i) => [i])).map((group) => ({ items: group }));
        const out = [];
        if (view.layout === "month") {
            groupByMonth(days).forEach((month) => {
                out.push({ kind: "month", key: month.key, title: monthLabel(month.date), small: true });
                gridRows(tilesOf(month.items), columns).forEach((row, n) => out.push({ kind: "tiles", key: `${month.key}-${n}`, row }));
            });
        } else {
            let previous = null;
            days.forEach((day) => {
                const title = monthTitle(previous, day.date);
                if (title) out.push({ kind: "month", key: `m-${day.key}`, title });
                out.push({ kind: "day", key: `d-${day.key}`, day });
                const tiles = tilesOf(day.items);
                (view.layout === "comfortable" ? comfortableRows(tiles) : gridRows(tiles, columns)).forEach((row, n) => out.push({ kind: "tiles", key: `${day.key}-${n}`, row }));
                if (day.date) previous = day.date;
            });
        }
        return out;
    }, [days, view.layout, view.stackSimilar, columns]);

    // Load the next page when the end comes into view
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
    useEffect(() => {
        const el = sentinel.current;
        if (!el || !hasNextPage) return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
        }, { rootMargin: "800px" });
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);

    // Ctrl + scroll (a trackpad pinch) switches layout, one step per gesture
    useEffect(() => {
        const el = scroller.current;
        if (!el) return undefined;
        let last = 0;
        const onWheel = (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            if (Date.now() - last < 500 || Math.abs(e.deltaY) < 4) return;
            last = Date.now();
            setView({ layout: e.deltaY < 0 ? bigger(view.layout) : smaller(view.layout) });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [view.layout, setView, show.kind]);

    const toggleTile = useCallback((tile) => setSelected((prev) => {
        const next = new Set(prev);
        const all = tile.items.every((i) => next.has(i.id));
        tile.items.forEach((i) => (all ? next.delete(i.id) : next.add(i.id)));
        return next;
    }), []);
    const toggleDay = (day) => toggleTile({ items: day.items });
    const clearSelection = () => setSelected(new Set());
    const selecting = selected.size > 0;
    const selectedItems = () => items.filter((i) => selected.has(i.id));

    useEffect(() => {
        if (!selecting) return undefined;
        const onKey = (e) => { if (e.key === "Escape") clearSelection(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selecting]);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ["files"] });
    const open = (item) => setViewer({ items, index: Math.max(0, items.findIndex((i) => i.id === item.id)) });
    const changeShow = (next) => {
        clearSelection();
        setShow(next);
        scroller.current?.scrollTo?.({ top: 0 });
    };

    const downloadAll = (list) => {
        list.forEach((item, i) => setTimeout(() => downloadItem(item), i * 300));
        toast.success(list.length === 1 ? `Downloading ${list[0].name}` : `Downloading ${list.length} items`);
    };
    const bulk = async (verb, action, list = selectedItems()) => {
        const results = await Promise.allSettled(list.map(action));
        const rejected = results.filter((r) => r.status === "rejected");
        // Protected photos (the server refuses them with 423 and says why; see features/protection)
        const locked = rejected.filter((r) => isProtectedError(r.reason));
        const kept = locked.length;
        const failed = rejected.length - kept;
        if (kept) toast.info(list.length === 1 ? locked[0].reason.message : notDeletedMessage(kept));
        if (failed) toast.error(`${failed} of ${list.length} couldn't be ${verb.toLowerCase()}`);
        else if (!kept) toast.success(`${verb} ${list.length === 1 ? "1 item" : `${list.length} items`}`);
        clearSelection();
        refresh();
    };
    const allStarred = selecting && selectedItems().every((i) => i.starred);
    // Protected photos can't go to Trash: the button looks off and says why
    const trashBlocked = selecting ? protectedSelectionReason(selectedItems()) : null;
    const share = async () => {
        const list = selectedItems();
        if (navigator.canShare && list.length <= 10) {
            try {
                const files = await Promise.all(list.map(async (i) => { const b = await (await fetch(mediaUrl(i))).blob(); return new File([b], i.name, { type: b.type }); }));
                if (navigator.canShare({ files })) { await navigator.share({ files }); clearSelection(); return; }
            } catch (e) { if (e?.name === "AbortError") return; }
        }
        downloadAll(list);
        clearSelection();
    };
    const moveTo = (name) => bulk(`Added to ${name}:`, (i) => api.moveFile(i.id, `${PHOTOS_FOLDER}/${name}`));
    const createAlbum = async (name) => {
        const moving = newAlbum?.withSelection;
        setNewAlbum(null);
        try {
            await api.createFolderPath(`${PHOTOS_FOLDER}/${name}`);
            queryClient.invalidateQueries({ queryKey: ["photos"] });
            if (moving && selecting) await moveTo(name);
            else { toast.success(`Album "${name}" created`); changeShow({ kind: "album", name }); }
        } catch (e) { toast.error(e.message || "Couldn't create the album."); }
    };
    const upload = async (files) => {
        if (!files?.length) return;
        const folder = `${PHOTOS_FOLDER}/Uploads`;
        try {
            await api.createFolderPath(folder);
            [...files].forEach((f) => uploadManager.addUpload(f, folder));
            toast.success(`Uploading ${files.length} item${files.length === 1 ? "" : "s"}. See Transfers.`);
        } catch (e) { toast.error(e.message || "Couldn't start the upload."); }
    };

    if (show.kind === "collections") {
        return (<div className="gphotos flex-1 flex flex-col min-h-0 overflow-hidden bg-background text-foreground">
          <Collections onBack={() => changeShow({ kind: "all" })} onOpen={changeShow}/>
        </div>);
    }

    const title = show.kind === "album" ? show.name : VIEW_TITLES[show.kind];
    const render = (tile, style) => (<Tile key={tile.items[0].id} tile={tile} style={style} selected={tile.items.every((i) => selected.has(i.id))} selecting={selecting} onOpen={open} onToggle={toggleTile}/>);

    return (<div className="gphotos flex-1 flex flex-col min-h-0 overflow-hidden relative bg-background text-foreground">
      {selecting ? (<div className="flex items-center px-3 h-16 shrink-0">
          <button type="button" onClick={clearSelection} className="flex items-center gap-4 rounded-full bg-muted pl-3 pr-5 py-2.5" aria-label={`Cancel selection of ${selected.size}`}>
            <X className="w-6 h-6"/><span className="text-xl tabular-nums">{selected.size}</span>
          </button>
        </div>) : (<div className="flex items-center gap-1 px-2 sm:px-4 h-16 shrink-0">
          {title ? (<>
              <button type="button" onClick={() => changeShow({ kind: "all" })} className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" aria-label="Back to Photos"><ArrowLeft className="w-5 h-5"/></button>
              <h1 className="text-xl truncate">{title}</h1>
            </>) : (<h1 className="flex items-center gap-2.5 text-xl pl-2"><Images className="w-6 h-6 text-primary"/>Photos</h1>)}
          <span className="flex-1"/>
          <button type="button" onClick={() => changeShow({ kind: "collections" })} className="w-11 h-11 grid place-items-center rounded-full hover:bg-muted" aria-label="Collections" title="Collections"><Library className="w-6 h-6"/></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="w-11 h-11 grid place-items-center rounded-full hover:bg-muted" aria-label="Create" title="Create"><Plus className="w-7 h-7"/></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="gphotos w-56">
              <DropdownMenuItem onSelect={() => setNewAlbum({})} className="gap-3 py-2.5"><FolderPlus className="w-5 h-5"/>New album</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => uploadInput.current?.click()} className="gap-3 py-2.5"><Upload className="w-5 h-5"/>Upload from this computer</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("changeCategory", { detail: { folderPath: "/Home" } }))} className="gap-3 py-2.5"><FolderInput className="w-5 h-5"/>Import from Files</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <NotificationBell icon className="w-11 h-11 grid place-items-center rounded-full hover:bg-muted"/>
          <PhotosMenu onPhotosView={() => setViewDialog(true)} onCollections={() => changeShow({ kind: "collections" })}/>
          <input ref={uploadInput} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }}/>
        </div>)}

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" data-testid="photos-scroll">
        {query.isLoading ? (<div className="h-full grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground"/></div>) : query.isError ? (<div className="h-full grid place-items-center p-6 text-center">
            <div className="grid gap-3 justify-items-center">
              <p className="text-sm text-muted-foreground">{query.error?.message || "Couldn't load your photos."}</p>
              <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button>
            </div>
          </div>) : items.length === 0 ? (<div className="h-full grid place-items-center p-6 text-center">
            {show.kind === "all" ? (<div className="grid gap-2 justify-items-center max-w-sm">
                <Images className="w-12 h-12 text-primary/70"/>
                <p className="font-medium">No backed-up photos yet</p>
                <p className="text-sm text-muted-foreground">Turn on Backup in the TeleStore Android app. Photos and videos from your phone appear here, in “{PHOTOS_FOLDER.replace("/Home/", "")}”.</p>
              </div>) : (<div className="grid gap-3 justify-items-center max-w-sm">
                <p className="font-medium">{archive ? "Nothing in the Archive" : show.kind === "starred" ? "No favourites yet" : `Nothing in ${show.name} yet`}</p>
                <Button variant="outline" size="sm" onClick={() => changeShow({ kind: "all" })}>Show all photos</Button>
              </div>)}
          </div>) : (<div className={cn("pb-6", selecting && "pb-[340px]")}>
            {memoryList.length > 0 && <Memories list={memoryList} onOpen={(list) => setViewer({ items: list, index: 0 })}/>}
            <div className={cn(view.layout === "comfortable" && "mx-auto")} style={view.layout === "comfortable" ? { maxWidth: 960 } : undefined}>
              {rows.map((r) => {
                  if (r.kind === "month") return <h2 key={r.key} className={cn("px-4", r.small ? "text-xl pt-5 pb-2.5" : "text-[34px] pt-7")}>{r.title}</h2>;
                  if (r.kind === "day") return (<DayHeader key={r.key} day={r.day} allSelected={r.day.items.every((i) => selected.has(i.id))}
                      onToggleDay={() => toggleDay(r.day)} onDownloadDay={() => downloadAll(r.day.items)}/>);
                  return <div key={r.key} role="row" style={{ marginBottom: GAP }}><TileRow row={r.row} width={comfortableWidth} render={render}/></div>;
              })}
            </div>
            <div ref={sentinel} className="h-10 grid place-items-center">
              {isFetchingNextPage && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/>}
            </div>
          </div>)}
      </div>

      {selecting && (<SelectionSheet count={selected.size}
          onShare={share}
          onAddTo={() => setAddTo(true)}
          onFavourite={() => bulk(allStarred ? "Removed from Favourites:" : "Added to Favourites:", (i) => api.toggleStar(i.id, !allStarred))}
          allStarred={allStarred}
          onDownload={() => { downloadAll(selectedItems()); clearSelection(); }}
          archived={archive}
          onArchive={() => bulk(archive ? "Back in Photos:" : "Moved to Archive:", (i) => api.setPhotoMeta(i.id, { archived: !archive }))}
          onTrash={() => (trashBlocked ? toast.error(trashBlocked) : bulk("Moved to Trash:", (i) => api.trashFile(i.id)))}
          trashBlocked={trashBlocked}
          onAlbum={moveTo}
          onNewAlbum={() => setNewAlbum({ withSelection: true })}/>)}

      <AddToDialog open={addTo} onOpenChange={setAddTo} onAlbum={(name) => { setAddTo(false); moveTo(name); }}/>
      <NewAlbumDialog open={Boolean(newAlbum)} onOpenChange={(o) => !o && setNewAlbum(null)} onCreate={createAlbum}/>
      <PhotosViewDialog open={viewDialog} onOpenChange={setViewDialog} view={view} onChange={setView}/>
      {viewer && (<PhotosViewer items={viewer.items} index={viewer.index}
          onClose={() => { setViewer(null); refresh(); }}
          onEdit={(item) => setEditing(item)}/>)}
      {editing && <PhotoEditor item={editing} onClose={(saved) => { setEditing(null); if (saved) refresh(); }}/>}
    </div>);
};
