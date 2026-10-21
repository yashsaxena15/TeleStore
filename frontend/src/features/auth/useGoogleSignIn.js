import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";

const GSI_SRC = "https://accounts.google.com/gsi/client";

const loadScript = () => new Promise((resolve, reject) => {
    if (window.google?.accounts?.id)
        return resolve();
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    const script = existing || Object.assign(document.createElement("script"), { src: GSI_SRC, async: true, defer: true });
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Google sign-in couldn't load")), { once: true });
    if (!existing)
        document.head.appendChild(script);
});

/**
 * "Sign in with Google": asks the server for its Google client ID and draws Google's own button
 * into `buttonRef`. `available` is false when the server has no client ID (the button is hidden).
 * `onCredential` receives the ID token to send to /auth/google.
 */
export function useGoogleSignIn(onCredential) {
    const buttonRef = useRef(null);
    const [available, setAvailable] = useState(false);
    const callbackRef = useRef(onCredential);
    callbackRef.current = onCredential;
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { client_id: clientId } = await request("/auth/google/config", { timeout: 5000 });
                if (!clientId || cancelled)
                    return;
                setAvailable(true);
                await loadScript();
                if (cancelled || !buttonRef.current)
                    return;
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: (response) => callbackRef.current?.(response.credential),
                });
                window.google.accounts.id.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "signin_with", width: 300 });
            }
            catch {
                if (!cancelled)
                    setAvailable(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);
    return { available, buttonRef };
}
