/**
 * Configuration and helpers for TopBar navigation, sorting, and type filters.
 */

import {
  Layers,
  Folder,
  Film,
  FileText,
  Image,
  Music,
  Archive
} from "lucide-react";

export const getSortLabel = (field, order) => {
  if (field === "name") return order === "asc" ? "Name (A-Z)" : "Name (Z-A)";
  if (field === "date") return order === "desc" ? "Newest" : "Oldest";
  if (field === "size") return order === "desc" ? "Size (High)" : "Size (Low)";
  return "Sort";
};

export const getTypeChips = (isInboxMode = false) => [
  { id: "all", label: "All", icon: Layers },
  ...(!isInboxMode ? [{ id: "folder", label: "Folders", icon: Folder }] : []),
  { id: "video", label: "Videos", icon: Film },
  { id: "document", label: "Documents", icon: FileText },
  { id: "photo", label: "Photos", icon: Image },
  { id: "audio", label: "Audio", icon: Music },
  { id: "archive", label: "Archives", icon: Archive },
];
