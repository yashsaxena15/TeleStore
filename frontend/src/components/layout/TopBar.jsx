import { useState } from "react";
import { ChevronLeft, ChevronRight, Search, LayoutGrid, List, X, ArrowUpDown, SlidersHorizontal, Check, RotateCcw, MoreHorizontal, Home, Inbox, PanelRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSortLabel, getTypeChips } from "./topBarConfig";

const SORT_OPTIONS = [
    ["name", "asc", "Name (A → Z)"], ["name", "desc", "Name (Z → A)"],
    ["date", "desc", "Date (newest first)"], ["date", "asc", "Date (oldest first)"],
    ["size", "desc", "Size (largest first)"], ["size", "asc", "Size (smallest first)"],
];
const SIZE_OPTIONS = [["all", "Any size"], ["small", "< 10 MB"], ["medium", "10 – 100 MB"], ["large", "100 MB – 1 GB"], ["huge", "> 1 GB"]];
const DATE_OPTIONS = [["all", "Any time"], ["today", "Today"], ["week", "Last 7 days"], ["month", "This month"]];
const SIZE_CHIP = { small: "<10MB", medium: "10–100MB", large: "100MB–1GB", huge: ">1GB" };
const DATE_CHIP = { today: "Today", week: "Last 7 days", month: "This month" };

const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

// Files top bar: breadcrumbs, folder search, sort, filter, view; then the type chips row.
export const TopBar = ({ currentPath, searchQuery, viewMode, onSearchChange, onViewModeChange, onBreadcrumbClick, sortField = "name", sortOrder = "asc", foldersFirst = true, onSortChange, onFoldersFirstChange, typeFilter = "all", onTypeFilterChange, sizeFilter = "all", onSizeFilterChange, dateFilter = "all", onDateFilterChange, onResetFilters, typeCounts, totalCount = 0, filteredCount = 0, isInboxMode = false, detailsOpen = false, onDetailsToggle }) => {
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
    const activeFilterCount = (sizeFilter !== "all" ? 1 : 0) + (dateFilter !== "all" ? 1 : 0);
    const typeChips = getTypeChips(isInboxMode);
    const folderName = currentPath[currentPath.length - 1];
    const canGoUp = currentPath.length > 1;

    const sortItems = onSortChange && SORT_OPTIONS.map(([field, order, label]) => (<DropdownMenuItem key={`${field}-${order}`} onClick={() => onSortChange(field, order)} className="flex items-center justify-between text-xs cursor-pointer">
        <span>{label}</span>
        {sortField === field && sortOrder === order && <Check className="h-3.5 w-3.5 text-primary"/>}
      </DropdownMenuItem>));
    const foldersFirstItem = !isInboxMode && onFoldersFirstChange && (<DropdownMenuCheckboxItem checked={foldersFirst} onCheckedChange={onFoldersFirstChange} className="text-xs cursor-pointer">
        Keep folders on top
      </DropdownMenuCheckboxItem>);

    const filterPopover = onSizeFilterChange && onDateFilterChange && (<Popover>
        <PopoverTrigger asChild>
          <Button variant={activeFilterCount > 0 ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 px-2 sm:px-2.5 text-xs relative text-muted-foreground hover:text-foreground" title="Filter by size and date" aria-label={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}>
            <SlidersHorizontal className="h-3.5 w-3.5"/>
            <span className="hidden lg:inline">Filter</span>
            {activeFilterCount > 0 && <span className="h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-semibold">{activeFilterCount}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3.5 space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-semibold">Filter</span>
            {activeFilterCount > 0 && onResetFilters && (<button type="button" onClick={onResetFilters} className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium">
                <RotateCcw className="h-3 w-3"/>Reset
              </button>)}
          </div>
          {[["File size", SIZE_OPTIONS, sizeFilter, onSizeFilterChange], ["Date modified", DATE_OPTIONS, dateFilter, onDateFilterChange]].map(([title, options, value, onChange]) => (<div key={title} className="space-y-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
              <div className="grid grid-cols-2 gap-1">
                {options.map(([id, label]) => (<button key={id} type="button" onClick={() => onChange(id)} aria-pressed={value === id} className={`text-xs px-2 py-1 rounded-md text-left transition-colors ${value === id ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
                    {label}
                  </button>))}
              </div>
            </div>))}
        </PopoverContent>
      </Popover>);

    const viewToggle = (<div className="flex items-center gap-0.5 shrink-0 bg-muted/40 p-0.5 rounded-lg border border-border" role="group" aria-label="View">
        <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" onClick={() => onViewModeChange("list")} className="h-7 w-7 rounded-md" title="List view" aria-label="List view" aria-pressed={viewMode === "list"}>
          <List className="h-3.5 w-3.5"/>
        </Button>
        <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => onViewModeChange("grid")} className="h-7 w-7 rounded-md" title="Grid view" aria-label="Grid view" aria-pressed={viewMode === "grid"}>
          <LayoutGrid className="h-3.5 w-3.5"/>
        </Button>
      </div>);

    const searchInput = (autoFocus) => (<div className="relative w-full" onContextMenu={stop}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"/>
        <Input autoFocus={autoFocus} aria-label={`Search in ${folderName}`} placeholder={`Search ${folderName}`} value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} className="pl-9 pr-8 h-8 bg-muted/40 border border-border rounded-md text-xs focus:bg-background focus:border-primary/50"/>
        {searchQuery && (<button type="button" onClick={() => onSearchChange("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5"/>
          </button>)}
      </div>);

    return (<div className="bg-background/90 backdrop-blur-md border-b border-border select-none sticky top-0 z-10 shrink-0" onContextMenu={stop}>
      {isMobileSearchOpen ? (<div className="flex items-center gap-2 px-3 h-12">
          {searchInput(true)}
          <Button variant="ghost" size="sm" onClick={() => setIsMobileSearchOpen(false)} className="text-xs px-2.5 h-8 shrink-0">Cancel</Button>
        </div>) : (<div className="flex items-center gap-1.5 px-3 sm:px-4 h-12">
          {/* Phone: up + current folder title */}
          <div className="md:hidden flex items-center gap-1 min-w-0 flex-1">
            {canGoUp && (<Button variant="ghost" size="icon" onClick={() => onBreadcrumbClick(currentPath.length - 2)} className="h-8 w-8 shrink-0 text-muted-foreground" aria-label={`Up to ${currentPath[currentPath.length - 2]}`}>
                <ChevronLeft className="h-5 w-5"/>
              </Button>)}
            <h1 className="text-[15px] font-semibold truncate">{folderName}</h1>
          </div>

          {/* Desktop: breadcrumbs */}
          <nav className="hidden md:flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar whitespace-nowrap" aria-label="Breadcrumb">
            {currentPath.map((folder, index) => {
                const isLast = index === currentPath.length - 1;
                const FirstIcon = index === 0 ? (folder === "Telegram Inbox" ? Inbox : folder === "Home" ? Home : null) : null;
                return (<div key={`${folder}-${index}`} className="flex items-center gap-0.5 shrink-0">
                  {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0"/>}
                  <button type="button" onClick={() => onBreadcrumbClick(index)} aria-current={isLast ? "page" : undefined} className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[13px] max-w-[220px] truncate transition-colors ${isLast ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}>
                    {FirstIcon && <FirstIcon className="h-3.5 w-3.5 shrink-0"/>}
                    <span className="truncate">{folder}</span>
                  </button>
                </div>);
            })}
          </nav>

          {/* Desktop: search + sort + filter + view */}
          <div className="hidden md:block w-52 lg:w-64 shrink-0">{searchInput(false)}</div>
          {onSortChange && (<div className="hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground" title="Sort">
                    <ArrowUpDown className="h-3.5 w-3.5"/>
                    <span className="hidden lg:inline">{getSortLabel(sortField, sortOrder)}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">Sort by</DropdownMenuLabel>
                  {sortItems}
                  {foldersFirstItem && <><DropdownMenuSeparator />{foldersFirstItem}</>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>)}
          <div className="hidden md:flex items-center gap-1.5">
            {filterPopover}{viewToggle}
            {onDetailsToggle && (<Button variant={detailsOpen ? "secondary" : "ghost"} size="icon" onClick={onDetailsToggle} className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground" title="Details pane (i)" aria-label="Details pane" aria-pressed={detailsOpen}>
                <PanelRight className="h-3.5 w-3.5"/>
              </Button>)}
          </div>

          {/* Phone: search, filter, more */}
          <div className="md:hidden flex items-center gap-0.5 shrink-0">
            <Button variant="ghost" size="icon" onClick={() => setIsMobileSearchOpen(true)} className="h-8 w-8 text-muted-foreground" aria-label={`Search in ${folderName}`}>
              <Search className="h-4 w-4"/>
            </Button>
            {filterPopover}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Sort and view options">
                  <MoreHorizontal className="h-4 w-4"/>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">View</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onViewModeChange("grid")} className="text-xs gap-2 cursor-pointer"><LayoutGrid className="h-3.5 w-3.5"/>Grid{viewMode === "grid" && <Check className="h-3.5 w-3.5 ml-auto text-primary"/>}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onViewModeChange("list")} className="text-xs gap-2 cursor-pointer"><List className="h-3.5 w-3.5"/>List{viewMode === "list" && <Check className="h-3.5 w-3.5 ml-auto text-primary"/>}</DropdownMenuItem>
                {onSortChange && <><DropdownMenuSeparator /><DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">Sort by</DropdownMenuLabel>{sortItems}</>}
                {foldersFirstItem && <><DropdownMenuSeparator />{foldersFirstItem}</>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>)}

      {/* Type chips + active filters + count */}
      {onTypeFilterChange && (<div className="flex items-center gap-1.5 px-3 sm:px-4 pb-2 pt-0.5 overflow-x-auto no-scrollbar" role="toolbar" aria-label="Filter by type">
          {typeChips.map((chip) => {
                const isSelected = typeFilter === chip.id;
                const count = typeCounts ? typeCounts[chip.id] : undefined;
                const ChipIcon = chip.icon;
                return (<button key={chip.id} type="button" onClick={() => onTypeFilterChange(isSelected && chip.id !== "all" ? "all" : chip.id)} aria-pressed={isSelected} className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium border transition-colors shrink-0 ${isSelected ? "bg-foreground text-background border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}>
                  {ChipIcon && <ChipIcon className="h-3.5 w-3.5"/>}
                  <span>{chip.label}</span>
                  {typeof count === "number" && count > 0 && <span className="text-[10px] font-mono opacity-70">{count}</span>}
                </button>);
            })}
          {sizeFilter !== "all" && onSizeFilterChange && (<button type="button" onClick={() => onSizeFilterChange("all")} className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-medium bg-accent text-accent-foreground border border-border shrink-0" aria-label="Remove size filter">
              Size: {SIZE_CHIP[sizeFilter]}<X className="h-3 w-3"/>
            </button>)}
          {dateFilter !== "all" && onDateFilterChange && (<button type="button" onClick={() => onDateFilterChange("all")} className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-medium bg-accent text-accent-foreground border border-border shrink-0" aria-label="Remove date filter">
              Date: {DATE_CHIP[dateFilter]}<X className="h-3 w-3"/>
            </button>)}
          {searchQuery && (<button type="button" onClick={() => onSearchChange("")} className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-medium bg-accent text-accent-foreground border border-border shrink-0" aria-label="Clear search">
              <span className="max-w-[120px] truncate">“{searchQuery}”</span><X className="h-3 w-3"/>
            </button>)}
          {(activeFilterCount > 0 || typeFilter !== "all" || Boolean(searchQuery)) && onResetFilters && (<button type="button" onClick={onResetFilters} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 shrink-0 px-1">
              Clear all
            </button>)}
          <div className="ml-auto pl-2 text-[11px] font-mono text-muted-foreground shrink-0 hidden sm:block">
            {filteredCount === totalCount ? `${totalCount} ${totalCount === 1 ? "item" : "items"}` : `${filteredCount} of ${totalCount} items`}
          </div>
        </div>)}
    </div>);
};
