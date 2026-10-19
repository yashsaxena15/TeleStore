// Backend URL helpers for Settings › Connection.
import authService from "@/features/auth/authService";
import { fetchWithTimeout } from "@/lib/api";
import { healthUrl } from "./backendUrl";

export { isValidBackendUrl, healthUrl } from "./backendUrl";

const STORAGE_KEY = "serverUrl";

// The URL used when none is saved: the desktop app talks to a local server, the web app to its own origin
export const defaultBackendUrl = () => (authService.isTauri() ? "http://localhost:8148" : window.location.origin);

export const savedBackendUrl = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) || "";
    }
    catch {
        return "";
    }
};

/** Calls the server's health check. Resolves to { ok, message }. */
export async function testBackendUrl(url) {
    try {
        const response = await fetchWithTimeout(healthUrl(url), { method: "GET" }, 5000);
        return response.ok ? { ok: true, message: "Connected" } : { ok: false, message: `Server answered ${response.status}` };
    }
    catch (error) {
        const timedOut = error?.name === "AbortError" || /timeout/i.test(error?.message || "");
        return { ok: false, message: timedOut ? "No answer within 5 seconds" : "Couldn't reach the server" };
    }
}
