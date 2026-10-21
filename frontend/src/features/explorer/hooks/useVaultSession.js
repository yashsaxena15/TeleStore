import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * Whether the Private Vault is unlocked, and its auto-lock time.
 * Reloads when Settings › Vault announces a change, and while unlocked checks every 45s so an
 * auto-lock on the server is noticed; `onAutoLocked` runs then (e.g. to leave the vault view).
 */
export function useVaultSession({ isVaultMode, onAutoLocked }) {
    const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);
    const [autoLockMinutes, setAutoLockMinutes] = useState(15);
    const onAutoLockedRef = useRef(onAutoLocked);
    onAutoLockedRef.current = onAutoLocked;

    useEffect(() => {
        const load = () => api.getVaultStatus().then((st) => {
            setIsVaultUnlocked(st.is_unlocked);
            if (st.auto_lock_minutes)
                setAutoLockMinutes(st.auto_lock_minutes);
        }).catch(() => { });
        load();
        window.addEventListener("vaultStateChanged", load);
        return () => window.removeEventListener("vaultStateChanged", load);
    }, []);

    useEffect(() => {
        if (!isVaultUnlocked)
            return;
        const interval = setInterval(() => {
            api.getVaultStatus().then((st) => {
                if (!st.is_unlocked) {
                    setIsVaultUnlocked(false);
                    if (isVaultMode) {
                        onAutoLockedRef.current?.();
                        toast.info(`Vault locked after ${autoLockMinutes} minutes without activity.`);
                    }
                }
            }).catch(() => { });
        }, 45000);
        return () => clearInterval(interval);
    }, [isVaultUnlocked, isVaultMode, autoLockMinutes]);

    return { isVaultUnlocked, setIsVaultUnlocked, autoLockMinutes };
}
