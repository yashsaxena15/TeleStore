// Actions offered by the New menu, the phone + button and the command palette.
// Each id is handled by FileExplorer's runShellAction().
import { Upload, FolderUp, FolderPlus, Magnet, Cloud, Home, Inbox, Star, ShieldCheck, Trash2, Instagram } from "lucide-react";

// Library places shown in the sidebar and the command palette (filter ids used by FileExplorer)
export const LIBRARY = [
    { name: "Home", icon: Home, filter: "all" },
    { name: "Telegram Inbox", icon: Inbox, filter: "inbox" },
    { name: "Starred", icon: Star, filter: "starred" },
    { name: "Private Vault", icon: ShieldCheck, filter: "vault" },
    { name: "Trash", icon: Trash2, filter: "trash" },
];

export const NEW_ITEM_GROUPS = [
    {
        label: "Add here",
        items: [
            { id: "upload-files", label: "Upload files", icon: Upload },
            { id: "upload-folder", label: "Upload folder", icon: FolderUp },
            { id: "new-folder", label: "New folder", icon: FolderPlus },
        ],
    },
    {
        label: "From elsewhere",
        items: [
            { id: "remote-leech", label: "Remote leech (link, magnet, torrent)", icon: Magnet },
            { id: "instagram-import", label: "Import from Instagram", icon: Instagram },
            { id: "connect-drive", label: "Connect cloud drive", icon: Cloud },
        ],
    },
];
