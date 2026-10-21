// The player's settings popover (bottom sheet on phones): speed, quality, audio track, subtitles, and the playlist view.
import { ArrowLeft, Check, ListVideo, Play, Upload, X } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { PLAYBACK_RATES, getFileExtension } from "../playerFormat";

export const PlayerSettingsSheet = ({ activeMenu, audioTracks, availableQualities, currentAudioTrack, currentIndex, currentQuality, currentSubtitle, customSubtitleInputRef, handleAudioTrackChange, handleCustomSubtitleUpload, handlePlaybackRateChange, handleQualityChange, onSelectTrack, playbackRate, playlist, setActiveMenu, setCurrentSubtitle, showControls, subtitlesList }) => (<>
    {/* ================================================================= */}
    {/* Settings Popover (Desktop) & Bottom Sheet (Mobile)                */}
    {/* ================================================================= */}
    <input ref={customSubtitleInputRef} type="file" accept=".srt,.vtt" className="hidden" onChange={handleCustomSubtitleUpload}/>
    {activeMenu !== "none" && activeMenu !== "info" && (<>
        {/* Backdrop on mobile */}
        <div onClick={(e) => {
              e.stopPropagation();
              setActiveMenu("none");
              showControls(4500);
          }} className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 sm:hidden"/>

        <div onClick={(e) => e.stopPropagation()} className={`z-50 text-white bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-2xl transition-all duration-200 fixed inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh] p-4 sm:absolute sm:inset-auto sm:bottom-20 sm:right-6 sm:rounded-2xl sm:p-2.5 sm:max-h-[60vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 sm:animate-in sm:fade-in sm:zoom-in-95 ${activeMenu === "playlist" ? "sm:w-84 md:w-96" : "sm:w-72"}`}>
          {/* Playlist View */}
          {activeMenu === "playlist" && (<div className="space-y-2">
              <div className="flex items-center justify-between px-2 py-2 border-b border-white/10 text-sm font-medium">
                <div className="flex items-center gap-2">
                  <ListVideo className="w-4 h-4 text-primary"/>
                  <span>Playlist</span>
                  <span className="text-xs font-mono text-white/50 px-1.5 py-0.5 rounded bg-white/10">
                    {currentIndex + 1} of {playlist.length}
                  </span>
                </div>
                <button onClick={() => {
                  setActiveMenu("none");
                  showControls(4500);
              }} className="p-1 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Close playlist">
                  <X className="w-4 h-4"/>
                </button>
              </div>
              <div className="py-1 max-h-72 sm:max-h-96 overflow-y-auto space-y-1 px-1">
                {playlist.map((video, idx) => {
                  const isActive = idx === currentIndex;
                  const vName = video.name || video.fileName || "";
                  const vExt = getFileExtension(vName);
                  return (<button key={video.id || video.url || idx} onClick={() => {
                      if (onSelectTrack) {
                          onSelectTrack(idx);
                      }
                      setActiveMenu("none");
                  }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-all touch-manipulation ${isActive ? "bg-primary/20 text-white border border-primary/40 font-medium" : "hover:bg-white/10 text-white/80 border border-transparent"}`}>
                      <span className="w-5 text-center font-mono text-xs text-white/40 shrink-0">
                        {isActive ? <Play className="w-3.5 h-3.5 fill-primary text-primary mx-auto"/> : idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[13px] ${isActive ? "text-primary font-semibold" : "text-white/90"}`} title={vName}>
                          {vName}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-white/50 font-mono mt-0.5">
                          <span className="uppercase text-[10px] font-bold px-1 py-0.2 rounded bg-white/10 text-white/70">{vExt}</span>
                          {video.size ? <span>{formatBytes(video.size)}</span> : null}
                        </div>
                      </div>
                      {isActive && (<span className="text-[10px] font-mono uppercase tracking-wider text-primary px-1.5 py-0.5 rounded bg-primary/20 shrink-0">
                          Playing
                        </span>)}
                    </button>);
              })}
              </div>
            </div>)}

          {/* Main Menu View */}
          {activeMenu === "settings" && (<div className="space-y-4">
              <div className="flex items-center justify-between px-1 pb-2 border-b border-white/10">
                <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Player settings</span>
                <button onClick={() => {
                  setActiveMenu("none");
                  showControls(4500);
              }} className="p-1 rounded-full hover:bg-white/10 text-white/60 hover:text-white" aria-label="Close settings">
                  <X className="w-4 h-4"/>
                </button>
              </div>
              <section className="px-1" aria-label="Playback speed">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Speed</h4>
                <div className="flex flex-wrap gap-1.5">
                  {PLAYBACK_RATES.map((rate) => (<button key={rate} onClick={() => handlePlaybackRateChange(rate)} aria-pressed={playbackRate === rate} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${playbackRate === rate ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                      {rate === 1 ? "1×" : `${rate}×`}
                    </button>))}
                </div>
              </section>
              <section className="px-1" aria-label="Quality">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Quality</h4>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => handleQualityChange("original")} aria-pressed={currentQuality === "original"} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentQuality === "original" ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>Original</button>
                  {availableQualities.map((q) => (<button key={q.id} onClick={() => handleQualityChange(q.id)} aria-pressed={currentQuality === q.id} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentQuality === q.id ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                      {q.id}
                    </button>))}
                </div>
                <p className="text-[11px] text-white/45 mt-1.5">Original streams the file directly; lower qualities use less data.</p>
              </section>
              {audioTracks.length > 1 && (<section className="px-1" aria-label="Audio track">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Audio track</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {audioTracks.map((track) => (<button key={track.index} onClick={() => handleAudioTrackChange(track.index)} aria-pressed={currentAudioTrack === track.index} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentAudioTrack === track.index ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                        {track.title || `Track ${track.index + 1}`}
                      </button>))}
                  </div>
                </section>)}
              <section className="px-1" aria-label="Subtitles">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">Subtitles</h4>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setCurrentSubtitle("off")} aria-pressed={currentSubtitle === "off"} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentSubtitle === "off" ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>Off</button>
                  {subtitlesList.map((sub) => (<button key={sub.id} onClick={() => setCurrentSubtitle(sub.id)} aria-pressed={currentSubtitle === sub.id} className={`h-8 px-2.5 rounded-md text-xs font-mono border transition-colors touch-manipulation ${currentSubtitle === sub.id ? "bg-primary text-primary-foreground border-transparent font-semibold" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                      {sub.label}
                    </button>))}
                  <button type="button" onClick={() => customSubtitleInputRef.current?.click()} className="h-8 px-2.5 rounded-md text-xs border border-dashed border-white/25 text-white/80 hover:bg-white/10 flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5"/>.srt / .vtt
                  </button>
                </div>
              </section>
            </div>)}

          {/* Playback Speed Submenu */}
          {activeMenu === "speed" && (<div className="space-y-1">
              <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                  <ArrowLeft className="w-4 h-4"/>
                </button>
                <span>Playback Speed</span>
              </div>
              <div className="py-1 max-h-64 overflow-y-auto space-y-0.5">
                {PLAYBACK_RATES.map((rate) => (<button key={rate} onClick={() => {
                      handlePlaybackRateChange(rate);
                      setActiveMenu("settings");
                  }} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${playbackRate === rate
                      ? "bg-primary/25 text-primary font-medium"
                      : "hover:bg-white/10 text-white/80"}`}>
                    <span>{rate === 1 ? "1x (Normal)" : `${rate}x`}</span>
                    {playbackRate === rate && <Check className="w-4 h-4 text-primary"/>}
                  </button>))}
              </div>
            </div>)}

          {/* Quality Submenu */}
          {activeMenu === "quality" && (<div className="space-y-1">
              <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                  <ArrowLeft className="w-4 h-4"/>
                </button>
                <span>Video Quality</span>
              </div>
              <div className="py-1 max-h-64 overflow-y-auto space-y-0.5">
                {/* Auto (Original Source) */}
                <button onClick={() => handleQualityChange("original")} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${currentQuality === "original"
                  ? "bg-primary/25 text-primary font-medium"
                  : "hover:bg-white/10 text-white/80"}`}>
                  <div className="flex flex-col text-left">
                    <span>Auto (Original Source)</span>
                    <span className="text-[10px] text-white/40">Direct stream • 0% CPU</span>
                  </div>
                  {currentQuality === "original" && <Check className="w-4 h-4 text-primary"/>}
                </button>

                {/* Filtered ladder where height <= native video height */}
                {availableQualities.map((q) => (<button key={q.id} onClick={() => handleQualityChange(q.id)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${currentQuality === q.id
                      ? "bg-primary/25 text-primary font-medium"
                      : "hover:bg-white/10 text-white/80"}`}>
                    <div className="flex flex-col text-left">
                      <span>{q.label}</span>
                      <span className="text-[10px] text-white/40">Downscaled • Low data</span>
                    </div>
                    {currentQuality === q.id && <Check className="w-4 h-4 text-primary"/>}
                  </button>))}
              </div>
            </div>)}

          {/* Audio Tracks Submenu */}
          {activeMenu === "audio" && (<div className="space-y-1">
              <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                  <ArrowLeft className="w-4 h-4"/>
                </button>
                <span>Audio Tracks</span>
              </div>
              <div className="py-1 max-h-64 overflow-y-auto space-y-0.5">
                {audioTracks.map((track) => (<button key={track.index} onClick={() => handleAudioTrackChange(track.index)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors touch-manipulation ${currentAudioTrack === track.index
                      ? "bg-primary/25 text-primary font-medium"
                      : "hover:bg-white/10 text-white/80"}`}>
                    <div className="flex flex-col text-left">
                      <span>{track.title || `Track ${track.index + 1}`}</span>
                      <span className="text-[10px] text-white/40">{track.language} {track.codec ? `• ${track.codec.toUpperCase()}` : ''}</span>
                    </div>
                    {currentAudioTrack === track.index && <Check className="w-4 h-4 text-primary"/>}
                  </button>))}
              </div>
            </div>)}

          {/* Subtitles Submenu */}
          {activeMenu === "subtitles" && (<div className="space-y-2">
              <div className="flex items-center space-x-2 px-2 py-2 border-b border-white/10 text-sm font-medium">
                <button onClick={() => setActiveMenu("settings")} className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white" aria-label="Back to settings menu">
                  <ArrowLeft className="w-4 h-4"/>
                </button>
                <span>Subtitles / CC</span>
              </div>
              <div className="py-1 max-h-64 overflow-y-auto space-y-0.5 px-1">
                {/* Off Option */}
                <button onClick={() => {
                  setCurrentSubtitle("off");
                  setActiveMenu("none");
              }} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors touch-manipulation ${currentSubtitle === "off"
                  ? "bg-primary/25 text-primary font-medium"
                  : "hover:bg-white/10 text-white/80"}`}>
                  <span>Off</span>
                  {currentSubtitle === "off" && <Check className="w-4 h-4 text-primary"/>}
                </button>

                {/* Available Subtitle Tracks */}
                {subtitlesList.map((sub) => (<button key={sub.id} onClick={() => {
                      setCurrentSubtitle(sub.id);
                      setActiveMenu("none");
                  }} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors touch-manipulation ${currentSubtitle === sub.id
                      ? "bg-primary/25 text-primary font-medium"
                      : "hover:bg-white/10 text-white/80"}`}>
                    <span className="truncate pr-2">{sub.label}</span>
                    {currentSubtitle === sub.id && <Check className="w-4 h-4 text-primary shrink-0"/>}
                  </button>))}

                {/* Custom Subtitle Upload Button */}
                <div className="pt-2 border-t border-white/10 mt-2">
                  
                  <button type="button" onClick={() => customSubtitleInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition-colors">
                    <Upload className="w-3.5 h-3.5"/>
                    <span>Upload Subtitle (.srt / .vtt)</span>
                  </button>
                </div>
              </div>
            </div>)}

        </div>
      </>)}
  </>);
