import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a video's sound going when the user switches to another app. Phone browsers pause a
 * page's video in the background but let audio play on, so when the page is hidden mid-video the
 * same file continues in an audio-only element from the same second (with lock-screen controls),
 * and on return the video picks up where the audio got to. Picture-in-Picture keeps the video
 * itself playing, so no hand-off happens then.
 *
 * - position(): the video's current time in the file, in seconds
 * - audioSource(position): { url, startAt } to play from there; startAt is the seek inside url
 * - resumeAt(position, playing): bring the video back to that time
 */
export function useBackgroundAudio({ videoRef, title, position, audioSource, resumeAt }) {
    // Whether the user has the video playing; pauses the browser makes in the background don't count
    const playingRef = useRef(false);
    const handoffRef = useRef(null);
    const latest = useRef({});
    latest.current = { title, position, audioSource, resumeAt };

    const onVideoPlay = useCallback(() => { playingRef.current = true; }, []);
    const onVideoPause = useCallback(() => {
        if (document.visibilityState !== "hidden")
            playingRef.current = false;
    }, []);

    useEffect(() => {
        const stop = () => {
            const handoff = handoffRef.current;
            handoffRef.current = null;
            if (!handoff)
                return null;
            const { audio, base } = handoff;
            const at = base + (audio.currentTime || 0);
            const playing = !audio.paused && !audio.ended;
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            clearMediaSession();
            return { at, playing };
        };

        const handOff = () => {
            const video = videoRef.current;
            if (!video || !playingRef.current || handoffRef.current || document.pictureInPictureElement)
                return;
            const { title: name, position: getPosition, audioSource: getSource } = latest.current;
            const at = getPosition();
            const { url, startAt } = getSource(at);
            const audio = new Audio();
            audio.preload = "auto";
            audio.src = url;
            if (startAt > 0)
                audio.addEventListener("loadedmetadata", () => { audio.currentTime = startAt; }, { once: true });
            handoffRef.current = { audio, base: at - startAt };
            video.pause();
            audio.play().catch(() => {
                // The browser refused background sound; the video simply stays paused
                if (handoffRef.current?.audio === audio) {
                    handoffRef.current = null;
                }
            });
            setMediaSession(audio, name);
        };

        const onVisibility = () => {
            if (document.visibilityState === "hidden") {
                handOff();
                return;
            }
            const back = stop();
            if (back)
                latest.current.resumeAt(back.at, back.playing);
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            stop();
        };
    }, [videoRef]);

    return { onVideoPlay, onVideoPause };
}

function setMediaSession(audio, title) {
    if (!("mediaSession" in navigator))
        return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: title || "Video", artist: "TeleStore", artwork: [{ src: "/logo.jpg", sizes: "192x192", type: "image/jpeg" }] });
        navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => { }));
        navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    }
    catch {
        // Lock-screen controls are a bonus; playback works without them
    }
}

function clearMediaSession() {
    if (!("mediaSession" in navigator))
        return;
    try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
    }
    catch {
        // Nothing to clear
    }
}
