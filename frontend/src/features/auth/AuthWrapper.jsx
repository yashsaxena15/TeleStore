import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
import { toast } from "sonner";
import logger from "@/lib/logger";
import authService from "./authService";
import { useError } from "@/contexts/ErrorHandlerContext";

// Generous: the browser may queue this behind streams and thumbnails (six connections per site)
const CHECK_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 1500;

const checkOnce = async () => {
    const response = await fetchWithTimeout(`${getApiBaseUrl() || ""}/auth/check`, { method: "GET", headers: { ...authService.getAuthHeaders() } }, CHECK_TIMEOUT_MS);
    if (!response.ok)
        return { status: response.status };
    return { status: response.status, data: await response.json() };
};

/**
 * Shows the app once the server confirms the sign-in. The check runs when the app opens (and
 * after signing in), not on every page change: moving between pages keeps the user signed in.
 * A request that later finds the session gone is handled where it is made.
 * A dropped connection is retried and never signs the user out; with no internet at all the
 * app opens anyway (for offline files).
 */
export const AuthWrapper = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(null);
    const navigate = useNavigate();
    const { showError } = useError();
    // Both change identity as pages change; refs keep the check from re-running with them
    const showErrorRef = useRef(showError);
    showErrorRef.current = showError;
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;

    const checkAuth = useCallback(async () => {
        let result = null;
        for (let attempt = 0; attempt < 2 && !result; attempt++) {
            try {
                result = await checkOnce();
            }
            catch (error) {
                logger.warn("Auth check could not reach the server", { attempt, message: error?.message });
                if (attempt === 0)
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
        if (!result) {
            // No internet (or the Offline page asked for): open the app anyway, so saved
            // offline files can be used; other pages show that the server can't be reached
            if ((typeof navigator !== "undefined" && navigator.onLine === false) || window.location.pathname === "/offline") {
                setIsAuthenticated(true);
                if (window.location.pathname !== "/offline")
                    toast.info("You're offline", { description: "Files you saved offline still open.", action: { label: "Offline files", onClick: () => navigateRef.current("/offline") } });
                return;
            }
            // The server didn't answer: keep the sign-in and offer to try again
            showErrorRef.current("Connection Error", "Couldn't reach TeleStore. Check your internet connection and try again.", "network", () => checkAuth());
            return;
        }
        if (result.data?.authenticated) {
            setIsAuthenticated(true);
            return;
        }
        if (result.status === 401 || result.data) {
            localStorage.removeItem("auth_token");
            setIsAuthenticated(false);
            navigateRef.current("/login");
            return;
        }
        showErrorRef.current("Server Error", `TeleStore answered with an error (${result.status}). Try again in a moment.`, "server", () => checkAuth());
    }, []);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    if (!isAuthenticated) {
        return (<div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
          <p className="mt-2 text-muted-foreground">Checking authentication...</p>
        </div>
      </div>);
    }
    return <>{children}</>;
};
