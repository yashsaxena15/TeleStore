// Folder colours (like Google Drive). The server keeps one of these ids per folder, or null.
// One fixed shade each, chosen to read on both the light and the dark theme.
export const FOLDER_COLORS = [
    { id: "red", label: "Red", hex: "#ef4444" },
    { id: "orange", label: "Orange", hex: "#f97316" },
    { id: "yellow", label: "Yellow", hex: "#eab308" },
    { id: "green", label: "Green", hex: "#22c55e" },
    { id: "teal", label: "Teal", hex: "#14b8a6" },
    { id: "blue", label: "Blue", hex: "#3b82f6" },
    { id: "purple", label: "Purple", hex: "#a855f7" },
    { id: "grey", label: "Grey", hex: "#6b7280" },
];

const BY_ID = Object.fromEntries(FOLDER_COLORS.map((c) => [c.id, c]));

/** The shade for a colour id, or null for the default (and unknown ids). */
export const folderColorHex = (color) => (color && BY_ID[color] ? BY_ID[color].hex : null);

/** Inline style that tints a lucide Folder icon: the outline in the colour, a light fill. */
export const folderIconStyle = (color) => {
    const hex = folderColorHex(color);
    return hex ? { color: hex, fill: `${hex}33` } : undefined;
};
