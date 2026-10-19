// The Settings sub-menu and how a URL maps to one of its tabs.
export const SETTINGS_TABS = [
    { id: "account", label: "Account" },
    { id: "appearance", label: "Appearance" },
    { id: "connection", label: "Connection" },
    { id: "downloads", label: "Downloads" },
    { id: "integrations", label: "Integrations" },
    { id: "vault", label: "Vault" },
    { id: "users", label: "Users", ownerOnly: true },
];

const IDS = new Set(SETTINGS_TABS.map((t) => t.id));

/** /profile → account, /users → users, /settings?tab=x → x (unknown or missing → account). */
export function settingsTabFromLocation(pathname, search = "") {
    if (pathname === "/profile") return "account";
    if (pathname === "/users") return "users";
    const tab = new URLSearchParams(search).get("tab");
    return IDS.has(tab) ? tab : "account";
}

/** Old page names (profile, users) and settings tabs → the URL to open. */
export function settingsUrl(tab) {
    const id = tab === "profile" ? "account" : tab;
    return IDS.has(id) ? `/settings?tab=${id}` : "/settings";
}
