// Shared, cached data for the app shell (sidebar, phone navigation, command palette).
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const CLOUD_ACCOUNTS_KEY = ["shell", "cloudAccounts"];

export function useCloudAccounts() {
    const queryClient = useQueryClient();
    useEffect(() => {
        // Other parts of the app announce account changes with this event
        const refresh = () => queryClient.invalidateQueries({ queryKey: CLOUD_ACCOUNTS_KEY });
        window.addEventListener("cloudAccountsChanged", refresh);
        return () => window.removeEventListener("cloudAccountsChanged", refresh);
    }, [queryClient]);
    const { data } = useQuery({
        queryKey: CLOUD_ACCOUNTS_KEY,
        queryFn: async () => (await api.fetchCloudAccounts()).accounts || [],
        staleTime: 60_000,
    });
    return data || [];
}

export function useIsOwner() {
    const { data } = useQuery({
        queryKey: ["shell", "isOwner"],
        queryFn: async () => Boolean((await api.isUserOwner()).is_owner),
        staleTime: 5 * 60_000,
    });
    return Boolean(data);
}

export function useUserProfile() {
    const { data } = useQuery({
        queryKey: ["shell", "userProfile"],
        queryFn: () => api.fetchUserProfile(),
        staleTime: 5 * 60_000,
    });
    return data || null;
}

export function displayName(profile) {
    if (!profile) return "Account";
    if (profile.telegram_first_name) return `${profile.telegram_first_name} ${profile.telegram_last_name || ""}`.trim();
    return profile.username || "Account";
}
