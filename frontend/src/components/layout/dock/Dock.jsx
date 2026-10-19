import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { DockTransfers } from "@/features/transfers/DockTransfers";
import { useDock } from "./useDock";
import { getDockState } from "./dockState";

// One bar under the page: what's playing on the left, the transfers summary on the right.
// It sits in the page flow (not floating), so it never covers page content.
export const Dock = () => {
    const dock = useDock();
    const { pathname } = useLocation();
    if (!dock)
        return null;
    const { setMediaSlot, setPanelSlot, presence } = dock;
    const { hasMedia, showTransfers, visible } = getDockState(presence, pathname);
    return (<section aria-label="Now playing and transfers" className={cn("shrink-0 px-2 md:px-3 pt-1.5 pb-2", !visible && "hidden")}>
      {/* Panels that stack above the bar (e.g. Google Drive upload progress) */}
      <div ref={setPanelSlot} className="empty:hidden mb-2"/>
      <div className="relative flex items-center gap-2 h-14 rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] pl-2 pr-1.5">
        <div ref={setMediaSlot} className="flex-1 min-w-0 flex items-center empty:hidden"/>
        {showTransfers && <DockTransfers alone={!hasMedia}/>}
      </div>
    </section>);
};
