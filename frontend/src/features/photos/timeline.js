// The Photos timeline: the phone backup's photos and videos, grouped by the day they were taken.
// Mirrors the Android app's Timeline (android/core/.../Timeline.kt) so both read the same.

/** Where the phone backup puts photos and videos; Photos shows only this folder tree. */
export const PHOTOS_FOLDER = "/Home/Phone Backup";

const SAME_YEAR = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" });
const OTHER_YEAR = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Local "YYYY-MM-DD" for a date, or null. */
function dayKey(date) {
    if (!date || Number.isNaN(date.getTime())) return null;
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${d}`;
}

/** When it was taken, else when it was uploaded. */
export function timelineDate(item) {
    const value = item?.takenAt || item?.modified;
    return value ? new Date(value) : null;
}

/** "Today", "Yesterday", "Tue, 14 Oct", or with the year when it isn't this year. */
export function dayLabel(date, today = new Date()) {
    if (!date || Number.isNaN(date.getTime())) return "Undated";
    const key = dayKey(date);
    if (key === dayKey(today)) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (key === dayKey(yesterday)) return "Yesterday";
    const parts = (date.getFullYear() === today.getFullYear() ? SAME_YEAR : OTHER_YEAR).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const label = `${get("weekday")}, ${get("day")} ${get("month")}`;
    return date.getFullYear() === today.getFullYear() ? label : `${label} ${get("year")}`;
}

/** Days in the order the items come (newest first from the server); items keep their order. */
export function groupByDay(items, today = new Date()) {
    const groups = new Map();
    for (const item of items) {
        const date = timelineDate(item);
        const key = dayKey(date) || "undated";
        if (!groups.has(key)) groups.set(key, { key, label: dayLabel(date, today), items: [] });
        groups.get(key).items.push(item);
    }
    return [...groups.values()];
}
