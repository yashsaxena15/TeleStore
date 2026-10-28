// A folder's icon, in its colour when it has one (see lib/folderColors.js).
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { folderColorHex, folderIconStyle } from "../lib/folderColors";

export const FolderIcon = ({ color, className, ...props }) => (<Folder data-folder-color={folderColorHex(color) ? color : undefined} className={cn(!folderColorHex(color) && "text-primary", className)} style={folderIconStyle(color)} {...props}/>);
