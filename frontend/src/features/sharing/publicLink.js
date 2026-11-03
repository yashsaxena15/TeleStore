// Requests from the public link page (/s/:token). The page is for anyone, signed in or not, so
// these never send the TeleStore sign-in: no token, no cookies.
import { getApiBaseUrl } from "@/lib/api";
import { linkUrls, queryString } from "./shareHelpers";

/** An error from a link request, with the HTTP status and the server's message. */
export class LinkError extends Error {
    constructor(message, status, retryAfter) {
        super(message);
        this.name = "LinkError";
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

const base = () => getApiBaseUrl() || "";

async function getJson(path) {
    let res;
    try {
        res = await fetch(`${base()}${path}`, { credentials: "omit", headers: { Accept: "application/json" } });
    }
    catch {
        throw new LinkError("Couldn't reach TeleStore. Check your connection and try again.", 0);
    }
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = typeof body?.detail === "string" ? body.detail : "";
        throw new LinkError(detail || `Request failed (${res.status})`, res.status, Number(res.headers.get("Retry-After")) || undefined);
    }
    return res.json();
}

const root = (token) => `/share-links/${encodeURIComponent(token)}`;

export const linkApi = {
    info: (token) => getJson(`${root(token)}/info`),
    list: (token, path = "") => getJson(`${root(token)}/list${queryString({ path })}`),
    zipInfo: (token, path = "") => getJson(`${root(token)}/zip-info${queryString({ path })}`),
    urls: (token) => linkUrls(base(), token),
};
