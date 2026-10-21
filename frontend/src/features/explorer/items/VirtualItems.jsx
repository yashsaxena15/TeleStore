import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { gridColumnCount } from "../lib/virtualLayout";

/**
 * Long folders draw only the rows near the screen. Small folders use the plain layout
 * (see FileGrid), so this only runs past VIRTUALIZE_AT items.
 *
 * The ref exposes `scrollToIndex(itemIndex)` and `columns`, so keyboard navigation can reach
 * items that are not in the page yet.
 */
export const VirtualItems = forwardRef(function VirtualItems({ items, mode, scrollRef, renderItem, gridClassName, rowGapClassName }, ref) {
    const containerRef = useRef(null);
    const [width, setWidth] = useState(0);
    const [scrollMargin, setScrollMargin] = useState(0);
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el)
            return;
        const measure = () => {
            setWidth(el.clientWidth);
            // Distance from the top of the scrolling area (headers, status line above the list)
            const scroller = scrollRef.current;
            if (scroller)
                setScrollMargin(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [scrollRef]);

    const columns = mode === "grid" ? gridColumnCount(width) : 1;
    const rowCount = Math.ceil(items.length / columns);
    // Grid tiles are 16:10 plus two lines of text; list rows are 36px (48px on phones)
    const tileWidth = columns ? width / columns : 150;
    const estimate = mode === "grid" ? Math.round(tileWidth * 0.625 + 58) : (width < 768 ? 50 : 36);
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => estimate,
        overscan: mode === "grid" ? 3 : 10,
        scrollMargin,
    });
    useEffect(() => {
        virtualizer.measure();
    }, [estimate, columns, virtualizer]);

    useImperativeHandle(ref, () => ({
        columns,
        scrollToIndex: (index) => virtualizer.scrollToIndex(Math.floor(index / columns), { align: "auto" }),
    }), [columns, virtualizer]);

    const rows = virtualizer.getVirtualItems();
    return (<div ref={containerRef} style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
      {rows.map((row) => {
            const start = row.index * columns;
            const slice = items.slice(start, start + columns);
            return (<div key={row.key} data-index={row.index} ref={virtualizer.measureElement} className={rowGapClassName} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}>
            <div className={gridClassName} style={mode === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
              {slice.map((item, i) => renderItem(item, start + i))}
            </div>
          </div>);
        })}
    </div>);
});
