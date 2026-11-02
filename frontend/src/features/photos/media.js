// Addresses for a photo or video in Photos: the copy saved offline in this browser when there is
// one, else the server's stream (the same rule as the explorer's openItem).
import { getApiBaseUrl } from "@/lib/api";
import { offlineUrlSync } from "@/features/offline/offlineStore";

export function mediaUrl(item, { download = false } = {}) {
    const local = !download && offlineUrlSync(item.id);
    if (local) return local;
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (!download) params.set("inline", "1");
    if (item.id) params.set("file_id", item.id);
    if (item.file_path) params.set("path", item.file_path);
    return `${getApiBaseUrl() || ""}/dl/${encodeURIComponent(item.name)}?${params}`;
}

/** Downloads [item] through the browser (one file). */
export function downloadItem(item) {
    const a = document.createElement("a");
    a.href = mediaUrl(item, { download: true });
    a.download = item.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
}
