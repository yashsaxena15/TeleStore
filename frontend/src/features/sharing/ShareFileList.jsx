// A plain list of shared files and folders (Shared with me and the public link page): a
// thumbnail, the name, size and date, a Download button and an optional ⋯ menu.
import { useState } from "react";
import { Download, File, FileAudio, FileText, FileVideo, Image as ImageIcon, MoreVertical } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FolderIcon } from "@/features/explorer/items/FolderIcon";
import { formatShortDate } from "@/features/explorer/lib/explorerItems";
import { serverTime } from "@/features/explorer/fileTypes";
import { previewKind } from "./shareHelpers";

const KIND_ICON = { image: ImageIcon, video: FileVideo, audio: FileAudio, pdf: FileText, doc: FileText };

export const ShareThumb = ({ item, src, className }) => {
    const [failed, setFailed] = useState(false);
    if (item.type === "folder")
        return <FolderIcon className={cn("w-6 h-6", className)} strokeWidth={1.5}/>;
    if (src && item.has_thumb && !failed)
        return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover"/>;
    const Icon = KIND_ICON[previewKind(item)] || File;
    return <Icon className={cn("w-5 h-5 text-muted-foreground", className)} aria-hidden="true"/>;
};

/**
 * items: ShareItems. thumbUrl(item): its thumbnail address. onOpen(item). onDownload(item) or
 * undefined (no Download button). menu(item): [{ label, icon, onSelect, danger }] or [] (no menu).
 */
export const ShareFileList = ({ items, thumbUrl, onOpen, onDownload, menu, emptyText = "This folder is empty." }) => {
    if (!items.length)
        return <p className="py-16 text-center text-sm text-muted-foreground">{emptyText}</p>;
    return (<ul role="list" aria-label="Files" className="divide-y divide-border rounded-lg border border-border bg-card/40">
      {items.map((item) => {
            const entries = menu ? menu(item) : [];
            const meta = item.type === "folder" ? "Folder" : [item.size ? formatBytes(item.size) : null, formatShortDate(serverTime(item.modified_date))].filter(Boolean).join(" · ");
            return (<li key={item.id} className="group flex items-center gap-3 px-2.5 py-2 min-h-[52px] hover:bg-muted/40">
            <button type="button" onClick={() => onOpen(item)} className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Open ${item.name}`}>
              <span className="w-10 h-10 shrink-0 rounded-md border border-border bg-muted/40 overflow-hidden grid place-items-center">
                <ShareThumb item={item} src={item.type === "folder" ? null : thumbUrl?.(item)}/>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate" title={item.name}>{item.name}</span>
                <span className="block text-[11px] font-mono text-muted-foreground truncate">{meta}</span>
              </span>
            </button>
            {onDownload && item.type !== "folder" && (<button type="button" onClick={() => onDownload(item)} className="w-9 h-9 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Download ${item.name}`} title="Download">
                <Download className="w-4 h-4"/>
              </button>)}
            {entries.length > 0 && (<DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="w-9 h-9 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`More actions for ${item.name}`} title="More actions">
                    <MoreVertical className="w-4 h-4"/>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {entries.map((e, i) => e.separator ? <DropdownMenuSeparator key={`sep-${i}`}/> : (<DropdownMenuItem key={e.label} onSelect={e.onSelect} className={cn(e.danger && "text-destructive focus:text-destructive")}>
                      {e.icon && <e.icon className="w-4 h-4 mr-2"/>}{e.label}
                    </DropdownMenuItem>))}
                </DropdownMenuContent>
              </DropdownMenu>)}
          </li>);
        })}
    </ul>);
};

/** Breadcrumbs for a share: the shared folder, then each folder inside it. */
export const ShareCrumbs = ({ crumbs, onOpen, before }) => (<nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1 text-sm min-w-0">
    {before}
    {crumbs.map((c, i) => (<span key={c.path || "root"} className="flex items-center gap-1 min-w-0">
        {(i > 0 || before) && <span className="text-muted-foreground">/</span>}
        {i === crumbs.length - 1
            ? <span className="font-semibold truncate" aria-current="page">{c.name}</span>
            : <button type="button" onClick={() => onOpen(c.path)} className="text-muted-foreground hover:text-foreground hover:underline truncate">{c.name}</button>}
      </span>))}
  </nav>);
