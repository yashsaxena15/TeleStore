// Photos: the phone backup's photos and videos as a timeline grid, like the Android app's Photos tab.
// Only the backup folder (PHOTOS_FOLDER) is shown. Click opens the viewer or player; select with the
// circle (or a long press on touch screens) to download, star or trash several at once.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Download, Images, Loader2, PlayCircle, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { useMediaPlayer } from "@/features/player/MediaPlayerContext";
import { downloadManager } from "@/features/transfers/downloadManager";
import { apiFileToFileItem } from "@/features/explorer/fileTypes";
import { Thumbnail } from "@/features/explorer/Thumbnail";
import { createOpenItem } from "@/features/explorer/actions/openItem";
import { groupByDay, PHOTOS_FOLDER } from "./timeline";

const ImageViewer = lazy(() => import("@/features/viewers/ImageViewer").then((m) => ({ default: m.ImageViewer })));

const PAGE_SIZE = 200;
const LONG_PRESS_MS = 450;

const PhotoTile = ({ item, selected, selecting, onOpen, onToggle }) => {
    const pressTimer = useRef(null);
    const longPressed = useRef(false);
    const startPress = (e) => {
        if (e.pointerType !== "touch") return;
        longPressed.current = false;
        pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            navigator.vibrate?.(20);
            onToggle(item);
        }, LONG_PRESS_MS);
    };
    const endPress = () => clearTimeout(pressTimer.current);
    return (<div role="gridcell" data-testid="photo-tile" aria-selected={selected} className={cn("group relative aspect-square cursor-pointer select-none overflow-hidden transition-colors duration-200", selected ? "bg-primary/15" : "bg-muted/30")} onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress} onContextMenu={(e) => { if (e.nativeEvent.pointerType === "touch" || longPressed.current) e.preventDefault(); }} onClick={() => {
            if (longPressed.current) { longPressed.current = false; return; }
            if (selecting) onToggle(item); else onOpen(item);
        }}>
      {/* Selected photos shrink into a rounded tile, as in the app */}
      <div className={cn("absolute inset-0 overflow-hidden transition-all duration-200 ease-out", selected && "motion-safe:inset-2.5 rounded-xl")}>
        <Thumbnail item={item} size="fill"/>
      </div>
      {item.fileType === "video" && <PlayCircle className="absolute top-1.5 right-1.5 w-5 h-5 text-white drop-shadow pointer-events-none" aria-label="Video"/>}
      {item.starred && <Star className="absolute bottom-1.5 left-1.5 w-4 h-4 fill-white text-white drop-shadow pointer-events-none" aria-label="Starred"/>}
      <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(item); }} className={cn("absolute top-1.5 left-1.5 rounded-full transition-opacity", selecting || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")} aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`} aria-pressed={selected}>
        {selected
            ? <CheckCircle2 className="w-[22px] h-[22px] fill-primary text-primary-foreground motion-safe:animate-select-pop"/>
            : <Circle className="w-[22px] h-[22px] text-white drop-shadow"/>}
      </button>
    </div>);
};

export const PhotosPage = () => {
    const queryClient = useQueryClient();
    const { playMedia } = useMediaPlayer();
    const [selected, setSelected] = useState(() => new Set());
    const [imageViewer, setImageViewer] = useState(null);
    const lastOpenTimeRef = useRef(0);
    const sentinel = useRef(null);

    const query = useInfiniteQuery({
        queryKey: ["files", "photos", PHOTOS_FOLDER],
        queryFn: async ({ pageParam }) => {
            const res = await api.fetchMedia(PHOTOS_FOLDER, pageParam, PAGE_SIZE);
            return { files: (res.files || []).map(apiFileToFileItem), pagination: res.pagination };
        },
        initialPageParam: 1,
        getNextPageParam: (last, pages) => (last.pagination?.has_next ? pages.length + 1 : undefined),
        staleTime: 1000 * 60 * 2,
    });
    const items = useMemo(() => (query.data?.pages || []).flatMap((p) => p.files), [query.data]);
    const days = useMemo(() => groupByDay(items), [items]);
    const total = query.data?.pages?.[0]?.pagination?.total_items ?? items.length;

    // Load the next page when the end of the grid comes into view
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
    useEffect(() => {
        const el = sentinel.current;
        if (!el || !hasNextPage) return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
        }, { rootMargin: "800px" });
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, days.length]);

    const toggle = useCallback((item) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
    }), []);
    const toggleDay = (day) => setSelected((prev) => {
        const next = new Set(prev);
        const all = day.items.every((i) => next.has(i.id));
        day.items.forEach((i) => (all ? next.delete(i.id) : next.add(i.id)));
        return next;
    });
    const clearSelection = () => setSelected(new Set());
    const selecting = selected.size > 0;
    const selectedItems = () => items.filter((i) => selected.has(i.id));

    useEffect(() => {
        if (!selecting) return undefined;
        const onKey = (e) => { if (e.key === "Escape") clearSelection(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selecting]);

    const openItem = createOpenItem({
        items, lastOpenTimeRef, playMedia, setImageViewer,
        onDownload: () => { }, onNavigate: () => { }, setArchiveInspect: () => { }, setDocumentReader: () => { },
        setIsSelectionMode: () => { }, setLastSelectedIndex: () => { }, setSelectedItems: () => { },
    });

    const download = () => {
        const list = selectedItems();
        list.forEach((item, i) => setTimeout(() => downloadManager.addDownload(`/dl/${encodeURIComponent(item.name)}?file_id=${encodeURIComponent(item.id)}`, item.name), i * 300));
        toast.success(list.length === 1 ? `Downloading ${list[0].name}` : `Downloading ${list.length} items`);
        clearSelection();
    };
    const bulk = async (verb, action) => {
        const list = selectedItems();
        const results = await Promise.allSettled(list.map(action));
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed) toast.error(`${failed} of ${list.length} couldn't be ${verb.toLowerCase()}`);
        else toast.success(`${verb} ${list.length === 1 ? "1 item" : `${list.length} items`}`);
        clearSelection();
        queryClient.invalidateQueries({ queryKey: ["files"] });
    };
    const allStarred = selecting && selectedItems().every((i) => i.starred);

    return (<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {selecting ? (<div className="flex items-center gap-2 px-3 sm:px-5 h-[60px] border-b border-border bg-primary/5 animate-in fade-in slide-in-from-top-1 duration-200" role="toolbar" aria-label="Selected photos">
          <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Cancel selection"><X className="w-4 h-4"/></Button>
          <span className="text-sm font-medium flex-1">{selected.size} selected</span>
          <Button variant="ghost" size="icon" onClick={download} title="Download" aria-label="Download"><Download className="w-4 h-4"/></Button>
          <Button variant="ghost" size="icon" onClick={() => bulk(allStarred ? "Unstarred" : "Starred", (i) => api.toggleStar(i.id, !allStarred))} title={allStarred ? "Unstar" : "Star"} aria-label={allStarred ? "Unstar" : "Star"}><Star className={cn("w-4 h-4", allStarred && "fill-warning text-warning")}/></Button>
          <Button variant="ghost" size="icon" onClick={() => bulk("Moved to Trash", (i) => api.trashFile(i.id))} title="Move to Trash" aria-label="Move to Trash"><Trash2 className="w-4 h-4"/></Button>
        </div>) : (<PageHeader icon={Images} title="Photos" subtitle={query.isLoading ? "Loading…" : `${total} ${total === 1 ? "item" : "items"} from your phone backup`}/>)}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" data-testid="photos-scroll">
        {query.isLoading ? (<div className="h-full grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground"/></div>) : query.isError ? (<div className="h-full grid place-items-center p-6 text-center">
            <div className="grid gap-3 justify-items-center">
              <p className="text-sm text-muted-foreground">{query.error?.message || "Couldn't load your photos."}</p>
              <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try again</Button>
            </div>
          </div>) : items.length === 0 ? (<div className="h-full grid place-items-center p-6 text-center">
            <div className="grid gap-2 justify-items-center max-w-sm">
              <Images className="w-12 h-12 text-primary/70"/>
              <p className="font-medium">No backed-up photos yet</p>
              <p className="text-sm text-muted-foreground">Turn on Backup in the TeleStore Android app. Photos and videos from your phone appear here, in “{PHOTOS_FOLDER.replace("/Home/", "")}”.</p>
            </div>
          </div>) : (<div className="pb-6">
            {days.map((day) => {
                const allSelected = day.items.every((i) => selected.has(i.id));
                return (<section key={day.key} aria-label={day.label}>
                  <div className="flex items-center gap-2 px-3 sm:px-5 pt-4 pb-2">
                    <button type="button" onClick={() => toggleDay(day)} className={cn("transition-opacity", selecting ? "opacity-100" : "opacity-60 hover:opacity-100")} aria-label={`Select ${day.label}`} aria-pressed={allSelected}>
                      {allSelected ? <CheckCircle2 className="w-[18px] h-[18px] fill-primary text-primary-foreground"/> : <Circle className="w-[18px] h-[18px] text-muted-foreground"/>}
                    </button>
                    <h2 className="text-sm font-medium">{day.label}</h2>
                  </div>
                  <div role="grid" className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-0.5 sm:gap-1 px-0.5 sm:px-4">
                    {day.items.map((item) => <PhotoTile key={item.id} item={item} selected={selected.has(item.id)} selecting={selecting} onOpen={openItem} onToggle={toggle}/>)}
                  </div>
                </section>);
            })}
            <div ref={sentinel} className="h-10 grid place-items-center">
              {isFetchingNextPage && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/>}
            </div>
          </div>)}
      </div>

      {imageViewer && (<Suspense fallback={null}>
          <ImageViewer imageUrl={imageViewer.imageUrl} fileName={imageViewer.fileName} images={imageViewer.images} initialIndex={imageViewer.initialIndex} onClose={() => setImageViewer(null)}/>
        </Suspense>)}
    </div>);
};
