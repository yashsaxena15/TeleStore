import { useEffect } from "react";
import { PLAYBACK_RATES } from "../playerFormat";

/**
 * Theater keyboard shortcuts: Space/K play, arrows seek and change volume, J/L skip, M mute,
 * F fullscreen, </> speed, Shift+N/P or [ ] next and previous video, Escape closes menus or the
 * player. Inactive while the player is docked, so the page keeps its own shortcuts.
 */
export function usePlayerKeyboard({ activeMenu, handlePlaybackRateChange, handleVolumeChange, isFullscreen, isMini, onClose, onNext, onPrev, playbackRate, seekRelative, setActiveMenu, toggleFullscreen, toggleMute, togglePlay, volume }) {
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Player shortcuts belong to theater mode; while docked, the page owns the keyboard
            if (isMini)
                return;
            const active = document.activeElement;
            if (active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)) {
                return;
            }
            switch (e.key) {
                case " ":
                case "k":
                case "K":
                    e.preventDefault();
                    togglePlay();
                    break;
                case "ArrowLeft":
                case "j":
                case "J":
                    e.preventDefault();
                    seekRelative(-10);
                    break;
                case "ArrowRight":
                case "l":
                case "L":
                    e.preventDefault();
                    seekRelative(10);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    handleVolumeChange(volume + 0.1);
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    handleVolumeChange(volume - 0.1);
                    break;
                case "m":
                case "M":
                    e.preventDefault();
                    toggleMute();
                    break;
                case "f":
                case "F":
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case "Escape":
                    if (isFullscreen) {
                        document.exitFullscreen?.();
                    }
                    else if (activeMenu !== "none") {
                        setActiveMenu("none");
                    }
                    else {
                        onClose();
                    }
                    break;
                case "<":
                case ",": {
                    e.preventDefault();
                    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
                    if (currentIndex > 0) {
                        handlePlaybackRateChange(PLAYBACK_RATES[currentIndex - 1]);
                    }
                    break;
                }
                case ">":
                case ".": {
                    e.preventDefault();
                    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
                    if (currentIndex < PLAYBACK_RATES.length - 1) {
                        handlePlaybackRateChange(PLAYBACK_RATES[currentIndex + 1]);
                    }
                    break;
                }
                case "N":
                case "]": {
                    if (onNext) {
                        e.preventDefault();
                        onNext();
                    }
                    break;
                }
                case "P":
                case "[": {
                    if (onPrev) {
                        e.preventDefault();
                        onPrev();
                    }
                    break;
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    // setActiveMenu is a React state setter (stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isMini,
        togglePlay,
        seekRelative,
        handleVolumeChange,
        volume,
        toggleMute,
        toggleFullscreen,
        isFullscreen,
        activeMenu,
        onClose,
        playbackRate,
        handlePlaybackRateChange,
        onNext,
        onPrev,
    ]);
}
