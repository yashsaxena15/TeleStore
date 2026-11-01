// The photo editor's sums (the same as the app's PhotoEdits): crops are parts of the photo's width
// and height (0 to 1).

export const FULL = { left: 0, top: 0, right: 1, bottom: 1 };
export const ASPECTS = [
    { key: "free", label: "Free", ratio: null },
    { key: "square", label: "Square", ratio: 1 },
    { key: "4:3", label: "4:3", ratio: 4 / 3 },
    { key: "16:9", label: "16:9", ratio: 16 / 9 },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The biggest crop of [ratio] centred on a width × height photo (all of it for none). */
export function centredCrop(ratio, width, height) {
    if (!ratio) return { ...FULL };
    // A landscape shape on a portrait photo (and the other way) is turned to fit better
    const wanted = ratio !== 1 && (ratio > 1) !== (width > height) ? 1 / ratio : ratio;
    const photo = width / height;
    if (photo > wanted) {
        const w = wanted / photo;
        return { left: (1 - w) / 2, top: 0, right: (1 + w) / 2, bottom: 1 };
    }
    const h = photo / wanted;
    return { left: 0, top: (1 - h) / 2, right: 1, bottom: (1 + h) / 2 };
}

/** Moves one corner (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left), keeping a minimum size and the shape. */
export function dragCorner(rect, corner, dx, dy, ratio = null, photoAspect = 1, minSize = 0.08) {
    let { left: l, top: t, right: r, bottom: b } = rect;
    if (corner === 0) { l = clamp(l + dx, 0, r - minSize); t = clamp(t + dy, 0, b - minSize); }
    else if (corner === 1) { r = clamp(r + dx, l + minSize, 1); t = clamp(t + dy, 0, b - minSize); }
    else if (corner === 2) { r = clamp(r + dx, l + minSize, 1); b = clamp(b + dy, t + minSize, 1); }
    else { l = clamp(l + dx, 0, r - minSize); b = clamp(b + dy, t + minSize, 1); }
    if (ratio) {
        const h = Math.min(1, ((r - l) * photoAspect) / ratio);
        if (corner === 0 || corner === 1) t = Math.max(0, b - h); else b = Math.min(1, t + h);
        const w = ((b - t) * ratio) / photoAspect;
        if (corner === 0 || corner === 3) l = r - w; else r = l + w;
    }
    return { left: l, top: t, right: r, bottom: b };
}

/** Moves the whole crop, staying inside the photo. */
export function moveCrop(rect, dx, dy) {
    const x = clamp(dx, -rect.left, 1 - rect.right);
    const y = clamp(dy, -rect.top, 1 - rect.bottom);
    return { left: rect.left + x, top: rect.top + y, right: rect.right + x, bottom: rect.bottom + y };
}

/** The crop in pixels: [left, top, width, height] (at least 1 px). */
export function cropPixels(rect, width, height) {
    const left = clamp(Math.floor(rect.left * width), 0, width - 1);
    const top = clamp(Math.floor(rect.top * height), 0, height - 1);
    const w = Math.max(1, Math.min(width - left, Math.floor((rect.right - rect.left) * width)));
    const h = Math.max(1, Math.min(height - top, Math.floor((rect.bottom - rect.top) * height)));
    return [left, top, w, h];
}

/** CSS / canvas filter for the Adjust sliders (each -1 to 1; 0 changes nothing). */
export function adjustFilter({ brightness = 0, contrast = 0, saturation = 0 }) {
    const pct = (v, k) => `${Math.round((1 + v * k) * 100)}%`;
    return `brightness(${pct(brightness, 0.4)}) contrast(${pct(contrast, 0.6)}) saturate(${pct(saturation, 1)})`;
}

/** "IMG_1-edited-1730480000.jpg" */
export const editedName = (name, now = Date.now()) => `${name.replace(/\.[^.]+$/, "")}-edited-${Math.floor(now / 1000)}.jpg`;
