// TeleStore's service worker: keeps the website itself (the page and its built /assets/ files)
// so it opens without internet, for files saved offline. It never touches API calls, downloads
// or streams: only same-origin page loads (network first, the kept page when offline) and the
// hashed /assets/ files (kept on first use; their names change with every build).
const CACHE = "telestore-shell-v1";
const PAGE = "/index.html";
// Server addresses that are never the website, even when the browser opens them as a page
const SERVER = /^\/(api|auth|user|files|folders|dl|stream|thumbnail|transfers|media|cloud|vault|webdav|archive|health|docs|openapi\.json)(\/|$)/;

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(PAGE, { cache: "reload" }))).catch(() => { }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith("telestore-shell-") && k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// The page lists the /assets/ files it already loaded (before this worker took over) to keep them
self.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type !== "keep-assets" || !Array.isArray(data.urls)) return;
    event.waitUntil(caches.open(CACHE).then(async (cache) => {
        for (const raw of data.urls) {
            try {
                const url = new URL(raw, self.location.origin);
                if (url.origin !== self.location.origin || !url.pathname.startsWith("/assets/")) continue;
                if (!(await cache.match(url.pathname))) await cache.add(url.pathname);
            }
            catch {
                // one missing file doesn't stop the rest
            }
        }
    }));
});

const isHtml = (response) => (response.headers.get("content-type") || "").includes("text/html");

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Hashed build files: from the cache when kept, else fetched and kept
    if (url.pathname.startsWith("/assets/")) {
        event.respondWith(caches.open(CACHE).then(async (cache) => {
            const kept = await cache.match(url.pathname);
            if (kept) return kept;
            const response = await fetch(request);
            if (response.ok) cache.put(url.pathname, response.clone());
            return response;
        }));
        return;
    }

    // Page loads: the network first (always the newest site), the kept page when offline
    if (request.mode === "navigate" && !SERVER.test(url.pathname)) {
        event.respondWith(fetch(request).then((response) => {
            if (response.ok && isHtml(response)) {
                const copy = response.clone();
                caches.open(CACHE).then((cache) => cache.put(PAGE, copy));
            }
            return response;
        }).catch(async () => (await caches.match(PAGE)) || Response.error()));
    }
    // Everything else (API calls, downloads, streams) goes straight to the network
});
