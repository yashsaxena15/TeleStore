// How one file or folder looks in the grid and in the list. FileGrid owns the behaviour
// (selection, focus, drag and drop, menus) and passes it in as `ctx`.
import { Folder, MoreVertical, Check, Star } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { isVideoItem } from "../fileTypes";
import { RenameInput } from "../RenameInput";
import { Thumbnail } from "../Thumbnail";
import { getTypeInfo, formatShortDate, TYPE_TONE } from "../lib/explorerItems";
import { getItemDuration } from "../lib/fileCardHelpers";

// Grid and list layout, shared by the plain and the virtualized lists
export const GRID_CLASS = "grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 sm:gap-2.5";
export const LIST_COLUMNS = "grid-cols-[18px_minmax(0,1fr)_64px_84px_92px_84px]";

export const GridTile = ({ item, index, ctx }) => {
    const { getItemState, itemRowProps, checkbox, starOrRestore, openItemContextMenu, loadedThumbnails, loadingStates, onRenameConfirm, onRenameCancel } = ctx;
    const s = getItemState(item, index);
    const typeInfo = getTypeInfo(item);
    const duration = isVideoItem(item) ? getItemDuration(item) : null;
    const meta = item.type === "folder"
        ? (formatShortDate(item.modified) || "Folder")
        : [item.size ? formatBytes(item.size) : null, formatShortDate(item.modified)].filter(Boolean).join(" · ");
    return (<div {...itemRowProps(item, index, s)} className={cn("group relative rounded-[10px] p-1.5 cursor-pointer select-none outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary", s.isSelected ? "bg-primary/10" : s.isFocused ? "bg-muted/60" : "hover:bg-card", (s.isDragging || s.isCut) && "opacity-50", s.isDropTarget && "ring-2 ring-primary/50")}>
      <div role="gridcell" className="contents">
      <div className={cn("relative aspect-[16/10] rounded-lg border border-border bg-muted/30 overflow-hidden grid place-items-center transition-[box-shadow,transform] duration-200 ease-out", s.isSelected ? "outline outline-2 outline-primary outline-offset-2 motion-safe:scale-[0.95]" : "group-hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.5),0_0_26px_-8px_hsl(var(--primary)/0.5)]")}>
        {item.type === "folder" ? <Folder className="w-10 h-10 text-primary pointer-events-none" strokeWidth={1.4}/> : <div className="w-full h-full grid place-items-center pointer-events-none"><Thumbnail item={item} size="fill" thumbnailSrc={item.thumbnail ? loadedThumbnails[item.thumbnail] : undefined} loadingState={item.thumbnail ? loadingStates[item.thumbnail] : undefined}/></div>}
        {!s.isRenaming && checkbox(item, index, s, "absolute top-2 left-2 z-20")}
        {!s.isRenaming && (<div className="absolute top-1.5 right-1.5 z-10 flex gap-1">
            {starOrRestore(item, s, "w-6 h-6 rounded-md bg-black/55 text-white hover:bg-black/75")}
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openItemContextMenu(item, index, e.clientX, e.clientY); }} className="w-6 h-6 rounded-md grid place-items-center bg-black/55 text-white hover:bg-black/75 opacity-0 group-hover:opacity-100 focus:opacity-100 touch:opacity-100 transition-opacity" title="More actions" aria-label={`More actions for ${item.name}`}>
              <MoreVertical className="w-3.5 h-3.5"/>
            </button>
          </div>)}
        {item.type !== "folder" && typeInfo.label && <span className={cn("absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold tracking-wide bg-background/85 pointer-events-none", TYPE_TONE[typeInfo.kind])}>{typeInfo.label}</span>}
        {duration && <span data-testid="duration-badge" className="absolute right-1.5 bottom-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[9.5px] text-white font-mono pointer-events-none">{duration}</span>}
      </div>
      {s.isRenaming ? (<div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          <RenameInput initialName={item.name} onSave={onRenameConfirm} onCancel={onRenameCancel}/>
        </div>) : (<div className="px-0.5 pointer-events-none">
          <p className={cn("mt-1.5 text-[12.5px] font-medium truncate", s.isSelected && "text-primary")} title={item.name}>{item.name}</p>
          <p className="text-[10.5px] font-mono text-muted-foreground truncate mt-0.5">{meta}</p>
        </div>)}
      </div>
    </div>);
};

export const ListHeader = ({ items, selectedCount, onToggleAll }) => (<div role="row" className={cn("hidden md:grid gap-3 items-center h-8 px-2 border-b border-border text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground", LIST_COLUMNS)}>
      <div role="columnheader">
        <button type="button" onClick={onToggleAll} className={cn("w-4 h-4 rounded flex items-center justify-center border transition-colors", selectedCount > 0 && selectedCount === items.length ? "bg-primary border-primary text-primary-foreground" : selectedCount > 0 ? "bg-primary/20 border-primary text-primary" : "border-muted-foreground/50 hover:border-foreground")} title={selectedCount === items.length ? "Deselect all" : "Select all"} aria-label={selectedCount === items.length ? "Deselect all" : "Select all"}>
          <Check className={cn("w-3 h-3 stroke-[3]", selectedCount > 0 ? "opacity-100" : "opacity-0")}/>
        </button>
      </div>
      <div role="columnheader">Name</div>
      <div role="columnheader">Type</div>
      <div role="columnheader" className="text-right">Size</div>
      <div role="columnheader">Modified</div>
      <div role="columnheader"/>
    </div>);

export const ListRow = ({ item, index, ctx }) => {
    const { getItemState, itemRowProps, checkbox, starOrRestore, rowActions, openItemContextMenu, getFileIcon, onRenameConfirm, onRenameCancel } = ctx;
    const s = getItemState(item, index);
    const typeInfo = getTypeInfo(item);
    const date = formatShortDate(item.modified);
    const size = item.type === "folder" ? "" : (item.size ? formatBytes(item.size) : "");
    return (<div {...itemRowProps(item, index, s)} className={cn("group relative rounded-md cursor-pointer select-none outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary", s.isSelected ? "bg-primary/10" : s.isFocused ? "bg-muted/60" : "hover:bg-muted/50", (s.isDragging || s.isCut) && "opacity-50", s.isDropTarget && "ring-2 ring-primary/50")}>
        {/* Desktop row */}
        <div className={cn("hidden md:grid gap-3 items-center h-9 px-2 text-xs", LIST_COLUMNS)}>
          <div role="gridcell">{!s.isRenaming && checkbox(item, index, s)}</div>
          <div role="gridcell" className="flex items-center gap-2.5 min-w-0">
            <span className={cn("w-6 h-6 rounded-md grid place-items-center shrink-0 pointer-events-none transition-transform duration-200", s.isSelected && "motion-safe:scale-90")}>{getFileIcon(item)}</span>
            {s.isRenaming ? (<div className="flex-1" onClick={(e) => e.stopPropagation()}>
                <RenameInput initialName={item.name} onSave={onRenameConfirm} onCancel={onRenameCancel}/>
              </div>) : (<span className={cn("truncate pointer-events-none", s.isSelected && "text-primary font-medium")} title={item.name}>{item.name}</span>)}
            {s.starred && !s.isRenaming && <Star className="w-3 h-3 shrink-0 fill-warning text-warning pointer-events-none" aria-label="Starred"/>}
          </div>
          <div role="gridcell" className="pointer-events-none">
            {item.type === "folder" ? <span className="text-muted-foreground">Folder</span> : typeInfo.label && <span className={cn("px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold tracking-wide", TYPE_TONE[typeInfo.kind])}>{typeInfo.label}</span>}
          </div>
          <div role="gridcell" className="text-right font-mono text-[11px] text-muted-foreground pointer-events-none">{size}</div>
          <div role="gridcell" className="font-mono text-[11px] text-muted-foreground truncate pointer-events-none" title={item.modified ? new Date(item.modified).toLocaleString() : undefined}>{date}</div>
          <div role="gridcell" className="flex justify-end gap-0.5">
            {!s.isRenaming && rowActions(item, index, s, "opacity-0 group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100")}
          </div>
        </div>
        {/* Phone row */}
        <div role="gridcell" className="md:hidden flex items-center gap-3 min-h-[48px] px-2 py-1.5">
          {!s.isRenaming && checkbox(item, index, s)}
          <span className={cn("w-8 h-8 rounded-md grid place-items-center shrink-0 pointer-events-none transition-transform duration-200", s.isSelected && "motion-safe:scale-90")}>{getFileIcon(item)}</span>
          <div className="min-w-0 flex-1 pointer-events-none">
            {s.isRenaming ? (<div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                <RenameInput initialName={item.name} onSave={onRenameConfirm} onCancel={onRenameCancel}/>
              </div>) : (<>
                <p className={cn("text-sm font-medium truncate", s.isSelected && "text-primary")}>{item.name}</p>
                <p className="text-[11px] font-mono text-muted-foreground truncate">{item.type === "folder" ? (date || "Folder") : [typeInfo.label, size, date].filter(Boolean).join(" · ")}</p>
              </>)}
          </div>
          {!s.isRenaming && (<div className="flex items-center shrink-0">
              {starOrRestore(item, s, "w-8 h-8 rounded-md text-muted-foreground hover:bg-muted", true)}
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openItemContextMenu(item, index, e.clientX, e.clientY); }} className="w-8 h-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted" title="More actions" aria-label={`More actions for ${item.name}`}>
                <MoreVertical className="w-4 h-4"/>
              </button>
            </div>)}
        </div>
      </div>);
};
