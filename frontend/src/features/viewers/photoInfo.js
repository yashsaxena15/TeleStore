// Formatting for the photo details panel in the image viewer (server: GET /files/{id}/photo-info).
// Every field may be missing; each helper returns "" (or null) when there's nothing to show.

const present = (v) => v !== null && v !== undefined && v !== "";
const trimNumber = (n, digits = 1) => String(Number(Number(n).toFixed(digits)));

/** "Apple iPhone 13 Pro" — without repeating the make when the model already starts with it. */
export function cameraLabel(make, model) {
    const m = (make || "").trim();
    const mo = (model || "").trim();
    if (!mo) return m;
    if (!m || mo.toLowerCase().startsWith(m.toLowerCase())) return mo;
    return `${m} ${mo}`;
}

/** "12.2 MP · 4032 × 3024" (megapixels worked out from the size when not given). */
export function megapixelsLabel({ megapixels, width, height } = {}) {
    const hasSize = Number(width) > 0 && Number(height) > 0;
    const mp = present(megapixels) && Number(megapixels) > 0 ? Number(megapixels) : hasSize ? (width * height) / 1e6 : null;
    return [mp ? `${trimNumber(mp)} MP` : "", hasSize ? `${width} × ${height}` : ""].filter(Boolean).join(" · ");
}

/** Shutter time: 0.008333 → "1/120 s", 2 → "2 s", "1/120" → "1/120 s". */
export function formatExposure(value) {
    if (!present(value)) return "";
    if (typeof value === "string") {
        const s = value.trim();
        if (!s) return "";
        if (/s$/i.test(s)) return s;
        const n = Number(s);
        if (!Number.isNaN(n)) return formatExposure(n);
        return `${s} s`;
    }
    const n = Number(value);
    if (!(n > 0)) return "";
    if (n >= 1) return `${trimNumber(n)} s`;
    return `1/${Math.round(1 / n)} s`;
}

export function formatAperture(value) {
    if (!present(value)) return "";
    const s = String(value).trim();
    if (/^f\//i.test(s)) return `f/${s.slice(2)}`;
    const n = Number(s);
    return Number.isNaN(n) || n <= 0 ? "" : `f/${trimNumber(n)}`;
}

export function formatFocalLength(value) {
    if (!present(value)) return "";
    const s = String(value).trim();
    if (/mm$/i.test(s)) return s;
    const n = Number(s);
    return Number.isNaN(n) || n <= 0 ? "" : `${trimNumber(n)} mm`;
}

/** "f/1.8 · 1/120 s · ISO 100 · 4.2 mm" */
export function exposureLine({ aperture, exposure, iso, focal_length: focal } = {}) {
    return [formatAperture(aperture), formatExposure(exposure), present(iso) ? `ISO ${iso}` : "", formatFocalLength(focal)].filter(Boolean).join(" · ");
}

/** Flash as words: true → "Flash fired", false → "No flash", text as given. */
export function flashLabel(flash) {
    if (flash === true) return "Flash fired";
    if (flash === false) return "No flash";
    return present(flash) ? String(flash) : "";
}

const hasCoords = (lat, lng) => present(lat) && present(lng) && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

/** "15.5527° N, 73.7517° E" */
export function formatCoordinates(lat, lng) {
    if (!hasCoords(lat, lng)) return "";
    const a = Number(lat), b = Number(lng);
    return `${Math.abs(a).toFixed(4)}° ${a < 0 ? "S" : "N"}, ${Math.abs(b).toFixed(4)}° ${b < 0 ? "W" : "E"}`;
}

/** Google Maps at the place the photo was taken (opened only when the user clicks it). */
export function mapsUrl(lat, lng) {
    return hasCoords(lat, lng) ? `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}` : null;
}

/** When it was taken, in the viewer's own locale and time zone. */
export function formatTakenAt(value) {
    if (!present(value)) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
}
