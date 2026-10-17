import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Grid3x3,
  List,
  RefreshCw,
  X,
  ArrowUpDown,
  SlidersHorizontal,
  Check,
  RotateCcw,
  PanelLeft,
  CloudDownload,
  Home,
  Inbox,
} from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem, } from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger, } from "./ui/popover";
import { getSortLabel, getTypeChips } from "@/lib/topBarConfig";
export const TopBar = ({ currentPath, searchQuery, viewMode, onSearchChange, onViewModeChange, onBack, onRefresh, onBreadcrumbClick, sortField = "name", sortOrder = "asc", foldersFirst = true, onSortChange, onFoldersFirstChange, typeFilter = "all", onTypeFilterChange, sizeFilter = "all", onSizeFilterChange, dateFilter = "all", onDateFilterChange, onResetFilters, typeCounts, totalCount = 0, filteredCount = 0, isInboxMode = false, onToggleSidebar, onOpenRemoteDownload, }) => {
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
    const activeFilterCount = (typeFilter !== "all" ? 1 : 0) +
        (sizeFilter !== "all" ? 1 : 0) +
        (dateFilter !== "all" ? 1 : 0);
    const typeChips = getTypeChips(isInboxMode);
    return (<div className="backdrop-blur-md bg-background/80 border-b border-border select-none sticky top-0 z-10 shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.02)]" onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
        }}>
      {/* Top Main Row */}
      {isMobileSearchOpen ? (<div className="flex items-center gap-2 px-3 sm:px-4 py-2 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"/>
            <Input autoFocus aria-label={`Search in ${currentPath[currentPath.length - 1]}`} placeholder={`Search ${currentPath[currentPath.length - 1]}`} value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} className="pl-10 pr-9 h-9 bg-muted/50 border border-border/40 rounded-lg text-sm focus:bg-background focus:border-primary/50" onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}/>
            {searchQuery && (<button type="button" onClick={() => onSearchChange("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4"/>
              </button>)}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setIsMobileSearchOpen(false)} aria-label="Cancel search" className="text-xs px-2.5 h-9 shrink-0">
            Cancel
          </Button>
        </div>) : (<div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2">
          {/* Navigation controls */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {onToggleSidebar && (<Button variant="ghost" size="icon" onClick={onToggleSidebar} className="h-8 w-8 rounded-lg transition-all duration-200 hover:bg-accent hover:scale-105 mr-0.5 text-muted-foreground hover:text-foreground" title="Toggle Sidebar" aria-label="Toggle navigation sidebar">
                <PanelLeft className="h-4 w-4"/>
              </Button>)}
            <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 rounded-lg transition-all duration-200 hover:bg-accent hover:scale-105 text-muted-foreground hover:text-foreground" title="Back" aria-label="Go back">
              <ChevronLeft className="h-4 w-4"/>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => window.history.forward()} className="hidden sm:inline-flex h-8 w-8 rounded-lg transition-all duration-200 hover:bg-accent hover:scale-105 text-muted-foreground hover:text-foreground" title="Forward" aria-label="Go forward">
              <ChevronRight className="h-4 w-4"/>
            </Button>
            <Button variant="ghost" size="icon" onClick={onRefresh} className="h-8 w-8 rounded-lg transition-all duration-200 hover:bg-accent hover:scale-105 text-muted-foreground hover:text-foreground" title="Refresh" aria-label="Refresh file list">
              <RefreshCw className="h-4 w-4"/>
            </Button>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 flex-1 min-w-0 bg-muted/40 border border-border/40 backdrop-blur-sm rounded-lg px-2.5 sm:px-3 py-1.5 text-sm overflow-x-auto no-scrollbar whitespace-nowrap transition-all duration-200 hover:bg-muted/60" onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}>
            {currentPath.map((folder, index) => {
                const isFirst = index === 0;
                const isLast = index === currentPath.length - 1;
                return (<div key={index} className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => onBreadcrumbClick(index)} aria-current={isLast ? "page" : undefined} className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-all duration-200 hover:bg-accent/60 max-w-[120px] sm:max-w-none truncate text-xs sm:text-sm ${isLast ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground"}`}>
                      {isFirst && folder === "Home" && <Home className="w-3.5 h-3.5 text-muted-foreground shrink-0"/>}
                      {isFirst && folder === "Telegram Inbox" && <Inbox className="w-3.5 h-3.5 text-muted-foreground shrink-0"/>}
                      <span className="truncate">{folder}</span>
                    </button>
                    {!isLast && (<ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0"/>)}
                  </div>);
            })}
          </div>

          {/* Mobile search trigger */}
          <Button variant="ghost" size="icon" onClick={() => setIsMobileSearchOpen(true)} className="md:hidden h-8 w-8 shrink-0 rounded-lg transition-all duration-200 hover:bg-accent hover:scale-105 text-muted-foreground hover:text-foreground" title="Search" aria-label="Open search">
            <Search className="h-4 w-4"/>
          </Button>

          {/* Desktop search bar */}
          <div className="hidden md:block relative w-48 lg:w-60 shrink-0 transition-all duration-200" onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"/>
            <Input aria-label={`Search in ${currentPath[currentPath.length - 1]}`} placeholder={`Search ${currentPath[currentPath.length - 1]}`} value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} className="pl-8 pr-7 h-8 bg-muted/40 border border-border/40 backdrop-blur-sm rounded-lg text-xs transition-all duration-200 focus:bg-background focus:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/40" onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}/>
            {searchQuery && (<button type="button" onClick={() => onSearchChange("")} aria-label="Clear search query" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5"/>
              </button>)}
          </div>

          {/* Sorting Dropdown Menu */}
          {onSortChange && (<DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={`Sort files by ${getSortLabel(sortField, sortOrder)}`} className="h-8 gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 hover:bg-accent transition-all text-muted-foreground hover:text-foreground" title="Sort items">
                  <ArrowUpDown className="h-3.5 w-3.5"/>
                  <span className="hidden lg:inline text-xs font-normal">
                    {getSortLabel(sortField, sortOrder)}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
                  Sort By
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onSortChange("name", "asc")} className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Name (A → Z)</span>
                  {sortField === "name" && sortOrder === "asc" && <Check className="h-3.5 w-3.5 text-primary"/>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSortChange("name", "desc")} className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Name (Z → A)</span>
                  {sortField === "name" && sortOrder === "desc" && <Check className="h-3.5 w-3.5 text-primary"/>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSortChange("date", "desc")} className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Date (Newest first)</span>
                  {sortField === "date" && sortOrder === "desc" && <Check className="h-3.5 w-3.5 text-primary"/>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSortChange("date", "asc")} className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Date (Oldest first)</span>
                  {sortField === "date" && sortOrder === "asc" && <Check className="h-3.5 w-3.5 text-primary"/>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSortChange("size", "desc")} className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Size (Largest first)</span>
                  {sortField === "size" && sortOrder === "desc" && <Check className="h-3.5 w-3.5 text-primary"/>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSortChange("size", "asc")} className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Size (Smallest first)</span>
                  {sortField === "size" && sortOrder === "asc" && <Check className="h-3.5 w-3.5 text-primary"/>}
                </DropdownMenuItem>

                {!isInboxMode && onFoldersFirstChange && (<>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={foldersFirst} onCheckedChange={onFoldersFirstChange} className="text-xs cursor-pointer">
                      Keep folders on top
                    </DropdownMenuCheckboxItem>
                  </>)}
              </DropdownMenuContent>
            </DropdownMenu>)}

          {/* Filter Popover Menu (Size, Date, etc.) */}
          {onSizeFilterChange && onDateFilterChange && (<Popover>
              <PopoverTrigger asChild>
                <Button variant={activeFilterCount > 0 ? "secondary" : "ghost"} size="sm" aria-label="Filter options" className="h-8 gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 relative hover:bg-accent transition-all text-muted-foreground hover:text-foreground" title="Advanced filters">
                  <SlidersHorizontal className="h-3.5 w-3.5"/>
                  <span className="hidden lg:inline text-xs font-normal">Filters</span>
                  {activeFilterCount > 0 && (<span className="h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                      {activeFilterCount}
                    </span>)}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3.5 space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-semibold text-foreground">Filter Options</span>
                  {activeFilterCount > 0 && onResetFilters && (<button type="button" onClick={onResetFilters} aria-label="Reset all filters" className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium">
                      <RotateCcw className="h-3 w-3"/>
                      Reset
                    </button>)}
                </div>

                {/* Size Filter */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">File Size</span>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                    { id: "all", label: "Any Size" },
                    { id: "small", label: "< 10 MB" },
                    { id: "medium", label: "10 – 100 MB" },
                    { id: "large", label: "100 MB – 1 GB" },
                    { id: "huge", label: "> 1 GB" },
                ].map((s) => (<button key={s.id} type="button" onClick={() => onSizeFilterChange(s.id)} className={`text-xs px-2 py-1 rounded-md text-left transition-colors ${sizeFilter === s.id
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
                        {s.label}
                      </button>))}
                  </div>
                </div>

                {/* Date Filter */}
                <div className="space-y-1.5 border-t pt-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Date Modified</span>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                    { id: "all", label: "Any Time" },
                    { id: "today", label: "Today" },
                    { id: "week", label: "Last 7 Days" },
                    { id: "month", label: "This Month" },
                ].map((d) => (<button key={d.id} type="button" onClick={() => onDateFilterChange(d.id)} className={`text-xs px-2 py-1 rounded-md text-left transition-colors ${dateFilter === d.id
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
                        {d.label}
                      </button>))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>)}

          {/* Remote Cloud Download Trigger */}
          {onOpenRemoteDownload && (<Button variant="outline" size="sm" onClick={onOpenRemoteDownload} className="h-8 gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 border-border/60 text-foreground hover:bg-accent transition-all shadow-xs" title="Remote Cloud Download (Google Drive & Direct Links)" aria-label="Remote Cloud Download">
              <CloudDownload className="h-3.5 w-3.5 text-primary"/>
              <span className="hidden sm:inline font-medium">Remote Leech</span>
            </Button>)}

          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 shrink-0 bg-muted/40 p-0.5 rounded-lg border border-border/40" role="group" aria-label="View mode">
            <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => onViewModeChange("grid")} aria-pressed={viewMode === "grid"} aria-label="Switch to grid view" className="h-7 w-7 rounded-md transition-all duration-150" title="Grid view">
              <Grid3x3 className="h-3.5 w-3.5"/>
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" onClick={() => onViewModeChange("list")} aria-pressed={viewMode === "list"} aria-label="Switch to list view" className="h-7 w-7 rounded-md transition-all duration-150" title="List view">
              <List className="h-3.5 w-3.5"/>
            </Button>
          </div>
        </div>)}

      {/* Row 2: Quick Filter Chips Bar */}
      {onTypeFilterChange && (<div className="flex items-center gap-1.5 px-3 sm:px-4 pb-2 pt-0.5 overflow-x-auto no-scrollbar">
          {typeChips.map((chip) => {
                const isSelected = typeFilter === chip.id;
                const count = typeCounts ? typeCounts[chip.id] : undefined;
                const ChipIcon = chip.icon;
                return (<button key={chip.id} type="button" onClick={() => onTypeFilterChange(isSelected && chip.id !== "all" ? "all" : chip.id)} aria-pressed={isSelected} aria-label={`Filter by ${chip.label}`} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 shrink-0 select-none ${isSelected
                        ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                {ChipIcon && <ChipIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-primary-foreground" : "text-muted-foreground"}`}/>}
                <span>{chip.label}</span>
                {typeof count === "number" && count > 0 && (<span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${isSelected
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-background/80 text-muted-foreground"}`}>
                    {count}
                  </span>)}
              </button>);
            })}

          {/* Active Size Filter Chip */}
          {sizeFilter !== "all" && onSizeFilterChange && (<button type="button" onClick={() => onSizeFilterChange("all")} aria-label="Remove size filter" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent text-accent-foreground border border-border/60 hover:bg-accent/80 shrink-0 transition-colors" title="Click to remove size filter">
              <span>Size: {sizeFilter === "small" ? "<10MB" : sizeFilter === "medium" ? "10–100MB" : sizeFilter === "large" ? "100MB–1GB" : ">1GB"}</span>
              <X className="h-3 w-3"/>
            </button>)}

          {/* Active Date Filter Chip */}
          {dateFilter !== "all" && onDateFilterChange && (<button type="button" onClick={() => onDateFilterChange("all")} aria-label="Remove date filter" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent text-accent-foreground border border-border/60 hover:bg-accent/80 shrink-0 transition-colors" title="Click to remove date filter">
              <span>Date: {dateFilter === "today" ? "Today" : dateFilter === "week" ? "Last 7 Days" : "This Month"}</span>
              <X className="h-3 w-3"/>
            </button>)}

          {/* Active Search Chip */}
          {searchQuery && (<button type="button" onClick={() => onSearchChange("")} aria-label="Clear search query" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent text-accent-foreground border border-border/60 hover:bg-accent/80 shrink-0 transition-colors" title="Click to clear search">
              <span className="max-w-[120px] truncate">Search: "{searchQuery}"</span>
              <X className="h-3 w-3"/>
            </button>)}

          {/* Reset all button if active filters */}
          {(activeFilterCount > 0 || Boolean(searchQuery)) && onResetFilters && (<button type="button" onClick={onResetFilters} aria-label="Clear all active filters and search" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 shrink-0 font-medium px-1">
              Clear all
            </button>)}

          {/* Total & Filtered Item Count on Far Right */}
          <div className="ml-auto pl-2 text-xs text-muted-foreground shrink-0 hidden sm:block">
            {filteredCount === totalCount ? (<span>{totalCount} {totalCount === 1 ? "item" : "items"}</span>) : (<span>{filteredCount} of {totalCount} items</span>)}
          </div>
        </div>)}
    </div>);
};
