// Which page an address shows, and how a Files location maps to and from an address.
// The address is the only source of truth for the page; folder moves are history entries.

const SETTINGS_PATHS = new Set(["/settings", "/profile", "/users"]);
const VAULT_ROOTS = new Set(["Private Vault", "Vault"]);

/** "files" | "settings" | "storage" | "transfers" | "photos" | "playlists" | "offline" for a pathname. */
export function viewFromPathname(pathname = "/") {
    if (SETTINGS_PATHS.has(pathname)) return "settings";
    if (pathname === "/photos") return "photos";
    if (pathname === "/playlists" || pathname.startsWith("/playlists/")) return "playlists";
    if (pathname === "/storage") return "storage";
    if (pathname === "/offline") return "offline";
    if (pathname === "/transfers" || pathname === "/downloads") return "transfers";
    return "files";
}

/** Folder segments → address. Home is "/", Home/Movies is "/Movies", the vault keeps its root. */
export function explorerUrl(path = ["Home"]) {
    const [root, ...rest] = path.length ? path : ["Home"];
    const segments = root === "Home" ? rest : [VAULT_ROOTS.has(root) ? "Private Vault" : root, ...rest];
    return segments.length ? `/${segments.map(encodeURIComponent).join("/")}` : "/";
}

/** Address → folder segments (the reverse of explorerUrl). Page addresses give Home. */
export function pathFromUrl(pathname = "/") {
    if (viewFromPathname(pathname) !== "files") return ["Home"];
    const segments = pathname.split("/").filter(Boolean).map((s) => {
        try {
            return decodeURIComponent(s);
        }
        catch {
            return s;
        }
    });
    if (!segments.length) return ["Home"];
    if (VAULT_ROOTS.has(segments[0])) return ["Private Vault", ...segments.slice(1)];
    return segments[0] === "Home" ? segments : ["Home", ...segments];
}

/** True when two saved Files locations are the same place. */
export function sameLocation(a, b) {
    if (!a || !b) return false;
    return a.filter === b.filter && JSON.stringify(a.path) === JSON.stringify(b.path) && JSON.stringify(a.crumbs || null) === JSON.stringify(b.crumbs || null);
}

/** A file's folder as stored by the server ("/Home/Movies", "/Vault/Tax") → folder segments. */
export function segmentsFromFilePath(filePath = "/Home") {
    const parts = String(filePath || "/Home").split("/").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return ["Home"];
    if (VAULT_ROOTS.has(parts[0])) return ["Private Vault", ...parts.slice(1)];
    return parts[0] === "Home" ? parts : ["Home", ...parts];
}
