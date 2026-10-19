import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, } from "lucide-react";
export const FilePagination = ({ pagination, currentPage, pageSize, onPageChange, onPageSizeChange, isLoading = false, }) => {
    // Hooks must run on every render, before any early return
    const [jumpPage, setJumpPage] = useState(currentPage.toString());
    const [isEditingPage, setIsEditingPage] = useState(false);
    useEffect(() => {
        setJumpPage(currentPage.toString());
    }, [currentPage]);
    if (!pagination || pagination.total_items === 0) {
        return null;
    }
    const isAll = pageSize === -1;
    const total_items = pagination.total_items;
    const total_pages = isAll ? 1 : pagination.total_pages;
    const start_index = isAll ? (total_items > 0 ? 1 : 0) : pagination.start_index;
    const end_index = isAll ? total_items : pagination.end_index;
    const has_prev = !isAll && pagination.has_prev;
    const has_next = !isAll && pagination.has_next;
    // Nothing to page through and no smaller page size to pick: stay out of the way
    if (total_pages <= 1 && total_items <= 25) {
        return null;
    }
    const handleJumpSubmit = (e) => {
        e.preventDefault();
        const p = parseInt(jumpPage, 10);
        if (!isNaN(p) && p >= 1 && p <= total_pages) {
            onPageChange(p);
        }
        else {
            setJumpPage(currentPage.toString());
        }
        setIsEditingPage(false);
    };
    return (<div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-1.5 border-t border-border text-xs select-none shrink-0">
      {/* Left: which slice is showing (the total is already in the filter row) */}
      <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {total_pages > 1 ? `${start_index}–${end_index} of ${total_items}` : ""}
      </div>

      {/* Center: Pagination controls */}
      {!isAll && total_pages > 1 && (<div className="flex items-center gap-1 sm:gap-1.5">
          <Button variant="outline" size="icon" className="h-7 w-7 rounded-md" onClick={() => onPageChange(1)} disabled={!has_prev || currentPage <= 1 || isLoading} aria-label="First page" title="First page">
            <ChevronsLeft className="h-4 w-4"/>
          </Button>

          <Button variant="outline" size="icon" className="h-7 w-7 rounded-md" onClick={() => onPageChange(currentPage - 1)} disabled={!has_prev || currentPage <= 1 || isLoading} aria-label="Previous page" title="Previous page">
            <ChevronLeft className="h-4 w-4"/>
          </Button>

          {/* Page indicator & quick jump */}
          <div className="flex items-center mx-1 text-xs font-medium">
            {isEditingPage ? (<form onSubmit={handleJumpSubmit} className="flex items-center">
                <input type="number" min={1} max={total_pages} value={jumpPage} onChange={(e) => setJumpPage(e.target.value)} onBlur={handleJumpSubmit} autoFocus aria-label="Jump to page number" className="w-12 h-7 px-1 text-center font-bold bg-muted border border-primary rounded text-xs focus:outline-none"/>
                <span className="ml-1 text-muted-foreground">/ {total_pages}</span>
              </form>) : (<button type="button" onClick={() => setIsEditingPage(true)} aria-label="Current page, click to jump to page" className="px-2 py-1 rounded hover:bg-muted/80 text-foreground transition-colors cursor-pointer" title="Click to jump to page">
                Page <span className="font-semibold text-primary">{currentPage}</span> of <span className="font-semibold">{total_pages}</span>
              </button>)}
          </div>

          <Button variant="outline" size="icon" className="h-7 w-7 rounded-md" onClick={() => onPageChange(currentPage + 1)} disabled={!has_next || currentPage >= total_pages || isLoading} aria-label="Next page" title="Next page">
            <ChevronRight className="h-4 w-4"/>
          </Button>

          <Button variant="outline" size="icon" className="h-7 w-7 rounded-md" onClick={() => onPageChange(total_pages)} disabled={!has_next || currentPage >= total_pages || isLoading} aria-label="Last page" title="Last page">
            <ChevronsRight className="h-4 w-4"/>
          </Button>
        </div>)}

      {/* Right: Page size selector */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto sm:ml-0">
        <span className="hidden sm:inline">Per page:</span>
        <Select value={pageSize.toString()} onValueChange={(val) => onPageSizeChange(parseInt(val, 10))} disabled={isLoading}>
          <SelectTrigger className="h-7 w-[76px] text-xs" aria-label="Items per page">
            <SelectValue placeholder={isAll ? "All" : `${pageSize}`}/>
          </SelectTrigger>
          <SelectContent side="top">
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
            <SelectItem value="200">200</SelectItem>
            <SelectItem value="-1">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>);
};
