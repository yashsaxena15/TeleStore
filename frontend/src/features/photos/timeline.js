// The Photos timeline, laid out like Google Photos: the phone backup's photos and videos grouped
// by the day they were taken, month titles, memories, places, video lengths, the Comfortable / Day /
// Month layouts and stacks of similar photos. Mirrors the Android app (android/core/.../Timeline.kt,
// PhotoHeadings.kt, PhotosView.kt) so both read the same.

/** Where the phone backup puts photos and videos; Photos shows only this folder tree. */
export const PHOTOS_FOLDER = "/Home/Phone Backup";

const fmt = (options) => new Intl.DateTimeFormat("en-US", options);
const SAME_YEAR = fmt({ weekday: "short", month: "short", day: "numeric" });
const OTHER_YEAR = fmt({ weekday: "short", month: "short", day: "numeric", year: "numeric" });
const MONTH = fmt({ month: "long" });
const MONTH_YEAR = fmt({ month: "long", year: "numeric" });
const VIEWER_DAY = fmt({ month: "short", day: "numeric" });
const VIEWER_DAY_YEAR = fmt({ month: "short", day: "numeric", year: "numeric" });
const VIEWER_TIME = fmt({ hour: "numeric", minute: "2-digit" });
const DETAILS = fmt({ weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** Local "YYYY-MM-DD" for a date, or null. */
function dayKey(date) {
    if (!date || Number.isNaN(date.getTime())) return null;
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${d}`;
}

const valid = (date) => date && !Number.isNaN(date.getTime());

/** When it was taken, else when it was uploaded. */
export function timelineDate(item) {
    const value = item?.takenAt || item?.modified;
    return value ? new Date(value) : null;
}

/** "Today", "Yesterday", "Thu, Oct 29", or "Thu, Jan 2, 2025" another year (as Google Photos). */
export function dayLabel(date, today = new Date()) {
    if (!valid(date)) return "Undated";
    const key = dayKey(date);
    if (key === dayKey(today)) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (key === dayKey(yesterday)) return "Yesterday";
    return (date.getFullYear() === today.getFullYear() ? SAME_YEAR : OTHER_YEAR).format(date);
}

/** Days in the order the items come (newest first from the server); items keep their order. */
export function groupByDay(items, today = new Date()) {
    const groups = new Map();
    for (const item of items) {
        const date = timelineDate(item);
        const key = dayKey(date) || "undated";
        if (!groups.has(key)) groups.set(key, { key, date: valid(date) ? date : null, label: dayLabel(date, today), items: [] });
        groups.get(key).items.push(item);
    }
    return [...groups.values()];
}

const sameMonth = (a, b) => Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth());

/** The big month title ("October", "March 2025") above the first day of each month but the current one. */
export function monthTitle(previous, date, today = new Date()) {
    if (!valid(date) || sameMonth(date, today) || sameMonth(previous, date)) return null;
    return (date.getFullYear() === today.getFullYear() ? MONTH : MONTH_YEAR).format(date);
}

/** Month view's titles: "November", "March 2025", "Undated". */
export function monthLabel(date, today = new Date()) {
    if (!valid(date)) return "Undated";
    return (date.getFullYear() === today.getFullYear() ? MONTH : MONTH_YEAR).format(date);
}

/** Days grouped by month (Month view), in order. */
export function groupByMonth(days) {
    const months = [];
    for (const day of days) {
        const last = months[months.length - 1];
        if (last && (sameMonth(last.date, day.date) || (!last.date && !day.date))) last.items.push(...day.items);
        else months.push({ key: `m-${day.key}`, date: day.date, items: [...day.items] });
    }
    return months;
}

/** "Gandhinagar, Indroda Nature Park, Ahmedabad": each place once, in the order seen. */
export function places(names) {
    const seen = new Set();
    const out = [];
    for (const raw of names || []) {
        const name = (raw || "").trim();
        if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            out.push(name);
        }
    }
    return out.join(", ");
}

/** "On this day" (earlier years) and "Recent highlights" (last 7 days, 4 or more), as in the app. */
export function memories(items, today = new Date()) {
    const dated = items.map((i) => [timelineDate(i), i]).filter(([d]) => valid(d));
    const byYear = new Map();
    for (const [d, i] of dated) {
        if (d.getFullYear() < today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
            if (!byYear.has(d.getFullYear())) byYear.set(d.getFullYear(), []);
            byYear.get(d.getFullYear()).push(i);
        }
    }
    const result = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => {
        const years = today.getFullYear() - year;
        return { title: years === 1 ? "1 year ago" : `${years} years ago`, items: list };
    });
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const recent = dated.filter(([d]) => d >= start && d <= today).map(([, i]) => i);
    if (recent.length >= 4) result.push({ title: "Recent highlights", items: recent.slice(0, 30) });
    return result;
}

/** A video tile's length: "0:07", "02:47", "1:02:03" (null when unknown). */
export function videoLength(seconds) {
    if (!seconds || seconds <= 0) return null;
    const s = Math.round(seconds);
    const two = (n) => String(n).padStart(2, "0");
    if (s >= 3600) return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
    if (s >= 60) return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
    return `0:${two(s)}`;
}

/** The viewer's title: "Nov 1" this year, "Nov 1, 2025" before; null when undated. */
export function viewerDay(date, today = new Date()) {
    if (!valid(date)) return null;
    return (date.getFullYear() === today.getFullYear() ? VIEWER_DAY : VIEWER_DAY_YEAR).format(date);
}

/** The viewer's second line: "6:35 PM • Gandhinagar, Gujarat" (either part alone). */
export function viewerLine(date, place) {
    return [valid(date) ? VIEWER_TIME.format(date) : null, (place || "").trim() || null].filter(Boolean).join(" • ");
}

/** The details panel's heading: "Sun, Nov 1, 2026 • 6:01 PM". */
export function detailsDate(date) {
    return valid(date) ? `${DETAILS.format(date)} • ${VIEWER_TIME.format(date)}` : "Date unknown";
}

const trim = (n, places) => String(Number(n.toFixed(places)));

/** The details' exposure row: "ƒ/1.5", "1/105s", "4.95 mm", "ISO80" (the ones known). */
export function exposureCells(info = {}) {
    const out = [];
    if (info.aperture > 0) out.push(`ƒ/${trim(info.aperture, 1)}`);
    if (info.exposure > 0) out.push(info.exposure >= 1 ? `${trim(info.exposure, 1)}s` : `1/${Math.round(1 / info.exposure)}s`);
    if (info.focal_length > 0) out.push(`${trim(info.focal_length, 2)} mm`);
    if (info.iso > 0) out.push(`ISO${info.iso}`);
    return out;
}

/** The chips under the file name: "9.4 MP", "4096 x 2304". */
export function fileChips(info = {}) {
    const w = info.width > 0 ? info.width : null;
    const h = info.height > 0 ? info.height : null;
    const mp = info.megapixels > 0 ? info.megapixels : w && h ? (w * h) / 1e6 : null;
    return [mp ? `${trim(mp, 1)} MP` : null, w && h ? `${w} x ${h}` : null].filter(Boolean);
}

/** Google Photos' three layouts; pinching (ctrl + wheel) moves between them. */
export const LAYOUTS = ["comfortable", "day", "month"];
export const bigger = (layout) => (layout === "month" ? "day" : "comfortable");
export const smaller = (layout) => (layout === "comfortable" ? "day" : "month");

/** Photos taken within [gapMs] of each other (videos and undated ones alone) as stacks. */
export function stacks(items, gapMs = 2000) {
    const out = [];
    let last = null;
    for (const item of items) {
        const time = timelineDate(item)?.getTime();
        const current = out[out.length - 1];
        const joins = current && Number.isFinite(time) && Number.isFinite(last) && item.fileType !== "video" && current[current.length - 1].fileType !== "video"
            && Math.abs(last - time) <= gapMs;
        if (joins) current.push(item); else out.push([item]);
        last = time;
    }
    return out;
}

/** Even rows of [columns] (Day: 3, Month: 5). */
export const gridRows = (tiles, columns) => {
    const rows = [];
    for (let i = 0; i < tiles.length; i += columns) rows.push({ kind: "row", items: tiles.slice(i, i + columns), columns });
    return rows;
};

/**
 * Comfortable: rows of 3, a big tile beside two small ones, a wide photo, in turn. One photo is
 * shown wide, two side by side. Same order as the app's PhotoTiles.comfortable.
 */
export function comfortableRows(tiles) {
    const out = [];
    let i = 0;
    let step = 0;
    while (i < tiles.length) {
        const left = tiles.length - i;
        if (left === 1) { out.push({ kind: "hero", item: tiles[i] }); i += 1; continue; }
        if (left === 2) { out.push({ kind: "row", items: tiles.slice(i, i + 2), columns: 2 }); i += 2; continue; }
        const s = step % 6;
        if (s === 1 || s === 5) { out.push({ kind: "feature", big: tiles[i], small: tiles.slice(i + 1, i + 3), bigOnLeft: s === 5 }); i += 3; }
        else if (s === 3 && left >= 4) { out.push({ kind: "hero", item: tiles[i] }); i += 1; }
        else { out.push({ kind: "row", items: tiles.slice(i, i + 3), columns: 3 }); i += 3; }
        step++;
    }
    return out;
}

/** The folder whose photos show for a view: all of the backup, or one album (a folder in it). */
export function photosUnder(view) {
    return view?.kind === "album" ? `${PHOTOS_FOLDER}/${view.name}` : PHOTOS_FOLDER;
}

/** Album names (the backup's folders, one per phone album), A to Z. */
export function albumNames(files) {
    return (files || [])
        .filter((f) => (f.file_type || f.type) === "folder")
        .map((f) => f.file_name || f.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

/** "Camera · 12 items", "Starred · 3 items", "120 items from your phone backup". */
export function photosSubtitle(view, count) {
    const items = `${count} ${count === 1 ? "item" : "items"}`;
    if (view?.kind === "album") return `${view.name} · ${items}`;
    if (view?.kind === "starred") return `Starred · ${items}`;
    return `${items} from your phone backup`;
}
