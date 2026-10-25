// The theater's bottom bar: timeline with buffered and hover time, play/pause, previous/next, skip 10s, volume, subtitles, settings, picture-in-picture and fullscreen.
import { Captions, ListVideo, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Settings, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { formatTime } from "../playerFormat";

export const PlayerControlsBar = ({ activeMenu, currentTime, areControlsVisible, bufferedPercent, canPiP, currentIndex, duration, handleTimelinePointerDown, handleTimelinePointerLeave, handleTimelinePointerMove, handleTimelinePointerUp, handleVolumeChange, hoverPosPercent, hoverTime, isFullscreen, isMobile, isMuted, isPiPActive, isPlaying, isScrubbing, onNext, onPrev, playedPercent, playlist, seekRelative, setActiveMenu, showControls, timelineRef, toggleFullscreen, toggleMute, togglePiP, togglePlay, volume }) => (<>
    {/* ================================================================= */}
    {/* Bottom Control Bar (Google Drive Style)                            */}
    {/* ================================================================= */}
    <div onClick={(e) => {
          e.stopPropagation();
          showControls(5000);
      }} onPointerDown={(e) => {
          e.stopPropagation();
          showControls(5000);
      }} className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-300 ease-out bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-10 pb-3 sm:pb-4 px-3 sm:px-6 flex flex-col ${areControlsVisible || !isPlaying || activeMenu !== "none"
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-full pointer-events-none"}`}>
      {/* Timeline Scrubber */}
      <div className="relative w-full pb-1 sm:pb-2">
        {/* Hover Timestamp Tooltip */}
        {hoverTime !== null && (<div className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-zinc-900/90 text-white text-[11px] font-mono border border-white/20 shadow-lg pointer-events-none" style={{ left: `${Math.min(96, Math.max(4, hoverPosPercent))}%` }}>
            {formatTime(hoverTime)}
          </div>)}

        <div ref={timelineRef} onPointerDown={handleTimelinePointerDown} onPointerMove={handleTimelinePointerMove} onPointerUp={handleTimelinePointerUp} onPointerLeave={handleTimelinePointerLeave} className="group relative h-6 flex items-center cursor-pointer touch-none" aria-label="Seek timeline">
          <div className="w-full h-1.5 group-hover:h-2.5 bg-white/20 rounded-full relative overflow-hidden transition-all duration-150">
            {/* Buffered progress bar */}
            <div className="absolute left-0 top-0 h-full bg-white/35 rounded-full transition-all duration-150" style={{ width: `${bufferedPercent}%` }}/>
            {/* Played progress bar */}
            <div className="absolute left-0 top-0 h-full bg-primary rounded-full transition-all duration-75" style={{ width: `${playedPercent}%` }}/>
          </div>
          {/* Scrubber thumb handle */}
          <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-lg transition-transform pointer-events-none ${isScrubbing
          ? "scale-125 bg-primary"
          : isMobile
              ? "scale-100"
              : "scale-0 group-hover:scale-100"}`} style={{ left: `${playedPercent}%` }}/>
        </div>
      </div>

      {/* Playback Controls Row */}
      <div className="flex items-center justify-between text-white">
        {/* Left Controls: Previous, Play, Next, Rewind 10s, Forward 10s, Time, Volume */}
        <div className="flex items-center space-x-1 sm:space-x-2">
          {/* Previous Track */}
          {playlist && playlist.length > 1 && (
            <button onClick={onPrev} disabled={!onPrev || currentIndex <= 0} className="p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title="Previous video (Shift+P or [)" aria-label="Previous video">
              <SkipBack className="w-5 h-5 fill-current"/>
            </button>
          )}

          {/* Play/Pause Button */}
          <button onClick={togglePlay} className="p-2 sm:p-2.5 rounded-full hover:bg-white/10 text-white transition-transform active:scale-90 focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center" title={isPlaying ? "Pause (Space/k)" : "Play (Space/k)"} aria-label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? (<Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-current"/>) : (<Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current ml-0.5"/>)}
          </button>

          {/* Next Track */}
          {playlist && playlist.length > 1 && (
            <button onClick={onNext} disabled={!onNext || currentIndex >= playlist.length - 1} className="p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title="Next video (Shift+N or ])" aria-label="Next video">
              <SkipForward className="w-5 h-5 fill-current"/>
            </button>
          )}

          {/* Rewind 10s */}
          <button onClick={() => seekRelative(-10)} className="p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors relative focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title="Rewind 10 seconds (Left Arrow/j)" aria-label="Rewind 10 seconds">
            <RotateCcw className="w-5 h-5"/>
            <span className="absolute text-[8px] font-bold top-2 left-2">10</span>
          </button>

          {/* Forward 10s */}
          <button onClick={() => seekRelative(10)} className="p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors relative focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title="Forward 10 seconds (Right Arrow/l)" aria-label="Forward 10 seconds">
            <RotateCw className="w-5 h-5"/>
            <span className="absolute text-[8px] font-bold top-2 left-2">10</span>
          </button>

          {/* Time Indicator */}
          <div className="text-xs sm:text-sm font-mono text-white/85 tracking-tight px-1 select-none tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span className="text-white/40 mx-1">/</span>
            <span>{formatTime(duration)}</span>
          </div>

          {/* Volume Control (desktop / tablet) */}
          <div className="hidden sm:flex items-center space-x-1 pl-2">
            <button onClick={toggleMute} className="p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40" title={isMuted ? "Unmute (m)" : "Mute (m)"} aria-label={isMuted ? "Unmute" : "Mute"}>
              {isMuted || volume === 0 ? (<VolumeX className="w-5 h-5"/>) : volume < 0.5 ? (<Volume1 className="w-5 h-5"/>) : (<Volume2 className="w-5 h-5"/>)}
            </button>
            <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={(e) => handleVolumeChange(parseFloat(e.target.value))} className="w-16 sm:w-20 h-1 accent-primary bg-white/20 rounded-full cursor-pointer transition-all" aria-label="Volume slider"/>
          </div>
        </div>

        {/* Right Controls: Playlist, Subtitles, Settings, PiP, Fullscreen */}
        <div className="flex items-center space-x-1 sm:space-x-2 relative">
          {/* Playlist Toggle */}
          {playlist && playlist.length > 0 && (
            <button onClick={(e) => {
              e.stopPropagation();
              setActiveMenu((prev) => (prev === "playlist" ? "none" : "playlist"));
              showControls(5000);
          }} className={`p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center gap-1 ${activeMenu === "playlist" ? "bg-white/20 text-white" : ""}`} title="Playlist" aria-label="Playlist">
              <ListVideo className="w-5 h-5"/>
              {playlist.length > 1 && (
                <span className="hidden sm:inline text-[11px] font-mono">
                  {currentIndex + 1}/{playlist.length}
                </span>
              )}
            </button>
          )}

          {/* Subtitles / CC Toggle */}
          <button onClick={(e) => {
          e.stopPropagation();
          setActiveMenu((prev) => (prev === "subtitles" ? "none" : "subtitles"));
          showControls(5000);
      }} className={`p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center ${activeMenu === "subtitles" ? "bg-white/20 text-white" : ""}`} title="Subtitles / CC" aria-label="Subtitles / CC">
            <Captions className="w-5 h-5"/>
          </button>

          {/* Settings Gear */}
          <button onClick={(e) => {
          e.stopPropagation();
          setActiveMenu((prev) => (prev === "settings" ? "none" : "settings"));
          showControls(5000);
      }} className={`p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center ${activeMenu === "settings" ? "bg-white/20 text-white" : ""}`} title="Settings" aria-label="Settings">
            <Settings className="w-5 h-5"/>
          </button>

          {/* Picture-in-Picture: the video keeps playing in a small window over other apps */}
          {canPiP && (<button onClick={(e) => {
              e.stopPropagation();
              togglePiP();
          }} className={`inline-flex p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] items-center justify-center ${isPiPActive ? "bg-primary text-primary-foreground" : ""}`} title="Picture-in-Picture" aria-label="Picture-in-Picture">
              <PictureInPicture2 className="w-5 h-5"/>
            </button>)}

          {/* Fullscreen Button */}
          <button onClick={(e) => {
          e.stopPropagation();
          toggleFullscreen();
      }} className="p-2 sm:p-2 rounded-full hover:bg-white/10 text-white/85 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center" title={isFullscreen ? "Exit Fullscreen (f/Esc)" : "Fullscreen (f)"} aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
            {isFullscreen ? <Minimize className="w-5 h-5"/> : <Maximize className="w-5 h-5"/>}
          </button>
        </div>
      </div>
    </div>
  </>);
