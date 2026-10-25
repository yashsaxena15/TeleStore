// Quality and audio choices for "Download video or audio", built from what the link offers.

const formatSize = (bytes) => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

// Playlists and channels: each video can differ, so these are "up to" heights
const LADDER = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
const COMPAT = { value: "compat", label: "Most compatible (H.264, up to 1080p)" };

const size = (bytes) => (bytes ? ` · ~${formatSize(bytes)}` : "");
const heightLabel = (v) => `${v.height}p${v.hdr ? " HDR" : ""}${v.fps > 30 ? ` ${v.fps}fps` : ""}`;

/** [{value, label}] for the Quality list. A single video lists exactly the sizes it has. */
export function videoChoices(preview) {
    const video = preview?.kind === "video" ? preview.options?.video || [] : [];
    if (!video.length) {
        return [{ value: "best", label: "Best available" }, ...LADDER.map((h) => ({ value: String(h), label: `Up to ${h}p` })), COMPAT];
    }
    if (video[0].height === undefined) {
        // Sites that only name their versions (Facebook: HD, SD)
        return [{ value: "best", label: "Best available" }, ...video.map((v) => ({ value: v.value, label: `${v.label}${size(v.size)}` }))];
    }
    return [
        { value: "best", label: `Best available (${heightLabel(video[0])})` },
        ...video.map((v) => ({ value: v.value, label: `${heightLabel(v)}${size(v.size)}` })),
        COMPAT,
    ];
}

/** [{group, items: [{value, label}]}] for the Audio list: the site's own versions, then conversions. */
export function audioChoices(preview) {
    const sources = preview?.kind === "video" ? preview.options?.audio || [] : [];
    const original = [{ value: "original", label: sources[0] ? `Best original (${sources[0].codec} ${sources[0].abr} kbps)` : "Best original quality" }];
    for (const s of sources)
        original.push({ value: `src:${s.id}`, label: `${s.codec} ${s.abr} kbps${size(s.size)}` });
    return [
        { group: "Original, no conversion (recommended)", items: original },
        {
            group: "Convert",
            items: [
                ...["320", "256", "192", "128"].map((b) => ({ value: `mp3:${b}`, label: `MP3 ${b} kbps` })),
                ...["256", "192", "128"].map((b) => ({ value: `m4a:${b}`, label: `M4A (AAC) ${b} kbps` })),
                { value: "flac", label: "FLAC (lossless file)" },
                { value: "wav", label: "WAV (uncompressed)" },
            ],
        },
    ];
}

/** The download choice the server expects. */
export function toChoice({ mode, quality, audio, subtitles }) {
    if (mode !== "audio")
        return { mode: "video", quality, subtitles: subtitles || null };
    if (audio.startsWith("src:"))
        return { mode, audio_format: "original", audio_source: audio.slice(4) };
    const [format, bitrate] = audio.split(":");
    return bitrate ? { mode, audio_format: format, audio_bitrate: bitrate } : { mode, audio_format: format };
}

/** A note when a conversion would be bigger without sounding better than the source. */
export function conversionNote(audio, preview) {
    const best = (preview?.options?.audio || [])[0];
    if (!best || audio === "original" || audio.startsWith("src:"))
        return "";
    const [format, bitrate] = audio.split(":");
    if (format === "flac" || format === "wav")
        return `A bigger file that sounds the same as the ${best.abr} kbps source: converting can't add quality.`;
    if (Number(bitrate) > best.abr + 8)
        return `The source is ${best.abr} kbps, so ${bitrate} kbps makes a bigger file without better sound.`;
    return "";
}
