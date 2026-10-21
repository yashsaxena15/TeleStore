// The player's File details dialog and the Open in external player menu.
import { Check, Copy, ExternalLink, Info, Play, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { formatTime } from "../playerFormat";

export const PlayerInfoDialogs = ({ activeMenu, duration, fileExt, fileName, fullMediaUrl, setActiveMenu, showControls, videoDimensions }) => (<>
    {/* ================================================================= */}
    {/* File Details / Info Modal                                         */}
    {/* ================================================================= */}
    {activeMenu === "info" && (<div onClick={() => {
              setActiveMenu("none");
              showControls(4500);
          }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-5 text-white animate-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center space-x-2">
              <Info className="w-5 h-5 text-primary"/>
              <h3 className="text-base font-semibold">Media Details</h3>
            </div>
            <button onClick={() => {
              setActiveMenu("none");
              showControls(4500);
          }} className="p-1 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors" title="Close details" aria-label="Close details">
              <X className="w-4 h-4"/>
            </button>
          </div>

          <div className="py-4 space-y-3 text-sm">
            <div className="flex items-start justify-between">
              <span className="text-white/50 text-xs">File Name</span>
              <span className="text-right font-medium max-w-[240px] truncate text-white/95">
                {fileName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50 text-xs">Format / Container</span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-white/10 text-white/90">
                {fileExt}
              </span>
            </div>
            {videoDimensions && (<div className="flex items-center justify-between">
                <span className="text-white/50 text-xs">Resolution</span>
                <span className="font-mono text-xs text-white/90">
                  {videoDimensions.width} × {videoDimensions.height}
                </span>
              </div>)}
            <div className="flex items-center justify-between">
              <span className="text-white/50 text-xs">Total Duration</span>
              <span className="font-mono text-xs text-white/90">{formatTime(duration)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50 text-xs">Streaming Mode</span>
              <span className="text-xs text-success font-medium">
                HTTP/1.1 Range Requests
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-white/10 flex justify-end">
            <button onClick={() => {
              setActiveMenu("none");
              showControls(4500);
          }} className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>)}

    {/* External Player Menu Dialog (Opened via top bar button only) */}
    {activeMenu === "external" && (<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto" onClick={() => setActiveMenu("none")}>
        <div className="w-full max-w-sm bg-zinc-900 border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center space-x-2">
              <ExternalLink className="w-5 h-5 text-primary"/>
              <h3 className="font-semibold text-white text-sm sm:text-base">Open in External Player</h3>
            </div>
            <button onClick={() => setActiveMenu("none")} className="p-1 rounded-full text-white/50 hover:text-white hover:bg-white/10">
              <X className="w-4 h-4"/>
            </button>
          </div>

          <p className="text-xs text-white/70 leading-relaxed">
            Play this video directly in an external app installed on your device:
          </p>

          <div className="space-y-2.5">
            {/* VLC Button */}
            <a href={`vlc://${fullMediaUrl}`} target="_blank" rel="noreferrer" className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl bg-card border border-border hover:bg-muted text-foreground font-medium text-xs sm:text-sm transition-colors shadow-sm cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Play className="w-4 h-4 text-warning shrink-0"/>
                <span>VLC Media Player</span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground"/>
            </a>

            {/* MX Player / External App Intent */}
            <a href={`intent:${fullMediaUrl}#Intent;type=video/*;end`} className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl bg-card border border-border hover:bg-muted text-foreground font-medium text-xs sm:text-sm transition-colors shadow-sm cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-primary shrink-0"/>
                <span>MX Player / Mobile App</span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground"/>
            </a>

            {/* Copy Stream Link */}
            <button type="button" onClick={() => {
              navigator.clipboard.writeText(fullMediaUrl);
              toast.success("Stream link copied to clipboard!");
              setActiveMenu("none");
          }} className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl bg-card border border-border hover:bg-muted text-foreground font-medium text-xs sm:text-sm transition-colors cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Copy className="w-4 h-4 text-muted-foreground shrink-0"/>
                <span>Copy Stream URL</span>
              </div>
              <Check className="w-4 h-4 text-muted-foreground"/>
            </button>
          </div>

          <div className="pt-2 border-t border-border flex justify-end">
            <button onClick={() => {
              setActiveMenu("none");
              showControls(4500);
          }} className="px-4 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-medium text-foreground transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>)}
  </>);
