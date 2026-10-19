// Pure checks for a backend server address (no browser APIs, so they are easy to test).
export const isValidBackendUrl = (url) => {
    if (!url) return false;
    if (url === "/") return true;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch {
        return false;
    }
};

export const healthUrl = (url) => {
    const base = url.replace(/\/+$/, "");
    return base.endsWith("/api") ? `${base}/health` : `${base}/api/health`;
};
