// Pure helpers for sharing (the Share dialog, Shared with me / by me and the public link page).
// No API or DOM here, so they are easy to test.

/** The public page of a link: {origin}/s/{token}. */
export function shareLinkUrl(token, origin = "") {
    return `${String(origin).replace(/\/+$/, "")}/s/${encodeURIComponent(token)}`;
}

const isVaultPath = (p) => typeof p === "string" && (p === "/Vault" || p.startsWith("/Vault/"));

/** Files and folders of your own can be shared; Vault, Drive, Trash and virtual items can't. */
export function canShare(item) {
    if (!item || !item.id) return false;
    if (item.is_vault || item.is_cloud || item.is_virtual || item.trashed || item.is_trashed) return false;
    if (isVaultPath(item.file_path)) return false;
    // The Vault folder itself sits in "/" as "Vault"
    if (item.type === "folder" && item.name === "Vault" && (item.file_path === "/" || !item.file_path)) return false;
    return true;
}

export const ROLES = [
    { value: "viewer", label: "Viewer" },
    { value: "editor", label: "Editor" },
];
export const roleLabel = (role) => (role === "editor" ? "Editor" : "Viewer");

/** What a member may do in a share: everyone views and downloads; editors also change things. */
export function shareAbilities(role) {
    const edit = role === "editor";
    return { view: true, download: true, upload: edit, newFolder: edit, rename: edit, move: edit, trash: edit };
}

/** Change actions for one item in a share (the shared folder itself can only be renamed). */
export function itemActions(role, { isRoot = false } = {}) {
    const a = shareAbilities(role);
    return { rename: a.rename, move: a.move && !isRoot, trash: a.trash && !isRoot };
}

export const EXPIRY_OPTIONS = [
    { value: "never", label: "Never" },
    { value: "1d", label: "1 day" },
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "custom", label: "Pick a date" },
];
const DAYS = { "1d": 1, "7d": 7, "30d": 30 };

/**
 * The expiry to send for an option: null for Never, an ISO time otherwise. A custom date
 * ("YYYY-MM-DD") ends at the end of that day in local time. Returns undefined when the custom
 * date is missing or not valid.
 */
export function expiryToIso(option, now = new Date(), customDate = "") {
    if (option === "never") return null;
    if (DAYS[option]) return new Date(now.getTime() + DAYS[option] * 86_400_000).toISOString();
    if (option === "custom") {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(customDate || "");
        if (!m) return undefined;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    return undefined;
}

/** The body for PUT …/link that sets the expiry from an option. */
export function expiryBody(option, now, customDate) {
    const iso = expiryToIso(option, now, customDate);
    if (iso === undefined) return null;
    return iso === null ? { clear_expiry: true } : { expires_at: iso };
}

/** "YYYY-MM-DD" (local) for a date input. */
export function dateInputValue(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Server times without a zone are UTC. */
const parseTime = (value) => {
    if (!value) return null;
    const s = String(value);
    const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
    return isNaN(d.getTime()) ? null : d;
};

/** "Expires Nov 12, 2026" / "Expired Nov 2, 2026" / "" when there's no expiry. */
export function expiryText(expiresAt, now = new Date()) {
    const d = parseTime(expiresAt);
    if (!d) return "";
    const text = d.toLocaleDateString(undefined, { dateStyle: "medium" });
    return d.getTime() <= now.getTime() ? `Expired ${text}` : `Expires ${text}`;
}

/** A short line about a link that doesn't work right now, or "" when it does. */
export function linkStateMessage(state) {
    switch (state) {
        case "expired": return "This link has expired. Pick a new expiry to turn it back on.";
        case "used_up": return "This link reached its download limit. Raise or turn off the limit to turn it back on.";
        case "off": return "The link is off.";
        default: return "";
    }
}

/** A short status for lists: "Anyone with the link", "Link expired"… or "" without a link. */
export function linkStatusLabel(link) {
    if (!link || !link.enabled) return "";
    switch (link.state) {
        case "expired": return "Link expired";
        case "used_up": return "Link used up";
        case "off": return "";
        default: return "Anyone with the link";
    }
}

/** "3 people" / "1 person" / "" */
export const peopleLabel = (n) => (!n ? "" : `${n} ${n === 1 ? "person" : "people"}`);

/** A download limit typed in the dialog: a whole number from 1, else null. */
export function parseLimit(value) {
    const n = Number(String(value ?? "").trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Joins a share-relative folder path and a name: ("", "Day 1") → "/Day 1". */
export function joinRel(path, name) {
    const base = String(path || "").replace(/\/+$/, "");
    return `${base}/${name}`;
}

/** The parent of a share-relative path: "/A/B" → "/A", "/A" → "". */
export function parentRel(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    parts.pop();
    return parts.length ? `/${parts.join("/")}` : "";
}

/** Breadcrumbs for a share-relative path: [{name: root, path: ""}, {name: "Day 1", path: "/Day 1"}, …]. */
export function crumbsFor(rootName, path) {
    const parts = String(path || "").split("/").filter(Boolean);
    return [{ name: rootName, path: "" }, ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join("/")}` }))];
}

const EXT = {
    image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "heic"],
    video: ["mp4", "m4v", "webm", "mov", "mkv", "avi", "3gp", "ts"],
    audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
    pdf: ["pdf"],
    doc: ["epub", "docx", "md", "markdown", "txt", "log", "json", "csv", "tsv", "xlsx", "xls", "ods", "pptx", "ppt", "html", "xml", "yml", "yaml", "py", "js", "css", "sh", "sql", "ini", "conf"],
};

/** How to show a ShareItem: "folder" | "image" | "video" | "audio" | "pdf" | "doc" | "other". */
export function previewKind(item) {
    if (!item) return "other";
    if (item.type === "folder") return "folder";
    const ext = String(item.name || "").split(".").pop().toLowerCase();
    for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind;
    if (item.type === "photo") return "image";
    if (item.type === "video") return "video";
    if (item.type === "audio" || item.type === "voice") return "audio";
    return "other";
}

/** The extension of a file name ("Report.PDF" → "pdf"). */
export const extensionOf = (name) => {
    const parts = String(name || "").split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
};

/** Folders first, then by name. */
export const sortShareItems = (items) => [...(items || [])].sort((a, b) => (a.type === "folder") === (b.type === "folder")
    ? String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" })
    : a.type === "folder" ? -1 : 1);

/** A query string from an object, skipping empty values ("" path stays out). */
export function queryString(params) {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "" && v !== false) q.append(k, v === true ? "1" : String(v));
    });
    const s = q.toString();
    return s ? `?${s}` : "";
}

/** Addresses of a member's shared files (signed in with ?token=). */
export function memberUrls(base, shareId, token) {
    const root = `${base || ""}/shares/${encodeURIComponent(shareId)}`;
    return {
        file: (fileId, inline = false) => `${root}/dl/${encodeURIComponent(fileId)}${queryString({ inline, token })}`,
        thumb: (fileId) => `${root}/thumb/${encodeURIComponent(fileId)}${queryString({ token })}`,
        part: (downloadUrl) => withQuery(`${base || ""}${downloadUrl}`, { token }),
    };
}

/** Addresses of a public link's files (no sign-in). */
export function linkUrls(base, token) {
    const root = `${base || ""}/share-links/${encodeURIComponent(token)}`;
    return {
        file: (fileId, inline = false) => `${root}/dl/${encodeURIComponent(fileId)}${queryString({ inline })}`,
        thumb: (fileId) => `${root}/thumb/${encodeURIComponent(fileId)}`,
        part: (downloadUrl) => `${base || ""}${downloadUrl}`,
    };
}

/** Adds params to a URL that may already have a query. */
export function withQuery(url, params) {
    const qs = queryString(params);
    if (!qs) return url;
    return url.includes("?") ? `${url}&${qs.slice(1)}` : `${url}${qs}`;
}
