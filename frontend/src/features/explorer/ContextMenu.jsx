import { useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { FOLDER_COLORS } from "./lib/folderColors";
import { useFeatures } from "@/features/settings/useFeatures";
import { CloudOff, HardDriveDownload, ListPlus, Shield, ShieldOff, Ban, FolderOpen, Pencil, Trash2, Copy, Scissors, Clipboard, Info, Download, Share2, Eye, Star, RefreshCw, Upload, RotateCcw, Archive, Link, ShieldCheck, } from "lucide-react";
// Folder colour: Default plus the palette, as a row of swatches (like Google Drive)
const ColorSwatches = ({ current, onPick, className }) => (<div role="group" aria-label="Folder colour" className={className}>
    <p className="text-xs text-muted-foreground mb-1.5">Folder colour</p>
    <div className="flex flex-wrap gap-1.5">
      <button type="button" role="menuitemradio" aria-checked={!current} aria-label="Default colour" title="Default" onClick={() => onPick(null)} className={cn("w-6 h-6 rounded-full border border-border grid place-items-center text-muted-foreground hover:scale-110 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", !current && "ring-2 ring-primary ring-offset-1 ring-offset-background")}>
        <Ban className="w-3.5 h-3.5"/>
      </button>
      {FOLDER_COLORS.map((c) => (<button key={c.id} type="button" role="menuitemradio" aria-checked={current === c.id} aria-label={c.label} title={c.label} onClick={() => onPick(c.id)} className={cn("w-6 h-6 rounded-full hover:scale-110 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", current === c.id && "ring-2 ring-primary ring-offset-1 ring-offset-background")} style={{ backgroundColor: c.hex }}/>))}
    </div>
  </div>);

export const ContextMenu = ({ x, y, onClose, onRefresh, itemType, itemName, onOpen, onCopy, onCut, onPaste, onDelete, onRename, onNewFolder, onDownload, onUploadFiles, // Destructure the new prop
onUploadFolder, // Destructure the new prop
isClipboardPasted, // Destructure the new prop
hasClipboard, // Destructure the new prop
disableDelete = false, // Destructure the new prop with default value
onProperties, onInspectArchive, onExtractArchive, onCompress, isArchive = false, isVideo = false, onCopyStreamUrl, selectedCount = 1, isStarred = false, onToggleStar, isTrashMode = false, onRestore, isVaultMode = false, onMoveToVault, onMoveToHome, isCloudMode = false, isVirtualFolder = false, isRestrictedEmptyArea = false, onAddToPlaylist, onMakeOffline, onRemoveOffline, onProtect, onUnprotect, folderColor, onSetFolderColor, hideDelete = false, protectionNote, }) => {
    const menuRef = useRef(null);
    const isMobile = useIsMobile();
    // Compress, extract and look inside: the owner can turn them off
    const { archives: canArchive } = useFeatures();

    useEffect(() => {
        const timer = setTimeout(() => {
            const firstItem = menuRef.current?.querySelector('button[role="menuitem"]:not([disabled])');
            firstItem?.focus();
        }, 50);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };
        const handleScroll = () => {
            onClose();
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!menuRef.current) return;
                const items = Array.from(
                    menuRef.current.querySelectorAll('button[role="menuitem"]:not([disabled])')
                );
                if (items.length === 0) return;
                const currentIndex = items.indexOf(document.activeElement);
                let nextIndex = 0;
                if (event.key === "ArrowDown") {
                    nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                } else {
                    nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                }
                items[nextIndex]?.focus();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("wheel", handleScroll);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("wheel", handleScroll);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);
    const handleAction = async (action) => {
        switch (action) {
            case "refresh":
                onRefresh?.();
                onClose();
                break;
            case "open":
                onOpen?.();
                onClose();
                break;
            case "copy_stream_url":
                onCopyStreamUrl?.();
                onClose();
                break;
            case "toggle_star":
                onToggleStar?.();
                onClose();
                break;
            case "add_to_playlist":
                onAddToPlaylist?.();
                onClose();
                break;
            case "make_offline":
                onMakeOffline?.();
                onClose();
                break;
            case "remove_offline":
                onRemoveOffline?.();
                onClose();
                break;
            case "protect":
                onProtect?.();
                onClose();
                break;
            case "unprotect":
                onUnprotect?.();
                onClose();
                break;
            case "restore":
                onRestore?.();
                onClose();
                break;
            case "rename":
                onRename();
                onClose();
                break;
            case "copy":
                onCopy();
                onClose();
                break;
            case "cut":
                onCut();
                onClose();
                break;
            case "paste":
                onPaste?.();
                onClose();
                break;
            case "delete":
                onDelete();
                onClose();
                break;
            case "new_folder":
                onNewFolder?.();
                onClose();
                break;
            case "download":
                await onDownload?.();
                onClose();
                break;
            case "upload_files":
                onUploadFiles?.();
                onClose();
                break;
            case "upload_folder":
                onUploadFolder?.();
                onClose();
                break;
            case "properties":
                onProperties?.();
                onClose();
                break;
            case "inspect_archive":
                onInspectArchive?.();
                onClose();
                break;
            case "extract_archive":
                onExtractArchive?.();
                onClose();
                break;
            case "compress":
                onCompress?.();
                onClose();
                break;
            case "move_to_vault":
                onMoveToVault?.();
                onClose();
                break;
            case "move_to_home":
                onMoveToHome?.();
                onClose();
                break;
            default:
                onClose();
        }
    };
    // Protected items can't be deleted: no delete entry, a disabled line saying why instead
    const deleteOr = (entry) => (hideDelete
        ? (protectionNote ? [{ icon: ShieldCheck, label: protectionNote, action: "protection_note", disabled: true }] : [])
        : [entry]);
    const menuItems = isTrashMode
        ? (itemType === "empty"
            ? [
                {
                    icon: RefreshCw,
                    label: "Refresh",
                    action: "refresh",
                    disabled: !onRefresh,
                },
            ]
            : [
                {
                    icon: RotateCcw,
                    label: "Restore",
                    action: "restore",
                },
                { divider: true, label: "", action: "" },
                ...deleteOr({
                    icon: Trash2,
                    label: "Delete Forever",
                    action: "delete",
                    danger: true,
                }),
                { divider: true, label: "", action: "" },
                {
                    icon: Info,
                    label: "Details",
                    action: "properties",
                    shortcut: "Alt+Enter",
                },
            ])
        : (itemType === "empty"
            ? (isRestrictedEmptyArea
                ? [
                    {
                        icon: RefreshCw,
                        label: "Refresh",
                        action: "refresh",
                        disabled: !onRefresh,
                    },
                ]
                : [
                    // Empty area context menu
                    {
                        icon: FolderOpen,
                        label: "New Folder",
                        action: "new_folder",
                    },
                    ...(onUploadFiles ? [{
                            icon: Upload,
                            label: "Upload Files",
                            action: "upload_files",
                        }] : []),
                    ...(onUploadFolder ? [{
                            icon: Upload,
                            label: "Upload Folder",
                            action: "upload_folder",
                        }] : []),
                    { divider: true, label: "", action: "" },
                    {
                        icon: Clipboard,
                        label: "Paste",
                        action: "paste",
                        shortcut: "Ctrl+V",
                    },
                    { divider: true, label: "", action: "" },
                    {
                        icon: RefreshCw,
                        label: "Refresh",
                        action: "refresh",
                        disabled: !onRefresh,
                    },
                ])
            : isVirtualFolder
                ? [
                    {
                        icon: Eye,
                        label: "Open",
                        action: "open",
                        shortcut: "Enter",
                    },
                    { divider: true, label: "", action: "" },
                    {
                        icon: Info,
                        label: "Details",
                        action: "properties",
                        shortcut: "Alt+Enter",
                    },
                ]
                : isCloudMode
                    ? [
                        // Cloud file/folder context menu
                        {
                            icon: Eye,
                            label: "Open",
                            action: "open",
                            shortcut: "Enter",
                        },
                        ...(isVideo && onCopyStreamUrl
                            ? [
                                {
                                    icon: Link,
                                    label: "Copy Stream URL",
                                    action: "copy_stream_url",
                                },
                            ]
                            : []),
                        ...(!isTrashMode
                            ? [
                                {
                                    icon: Star,
                                    label: isStarred ? "Remove from Starred" : "Add to Starred",
                                    action: "toggle_star",
                                },
                            ]
                            : []),
                        ...(onAddToPlaylist
                            ? [{ icon: ListPlus, label: "Add to playlist", action: "add_to_playlist" }]
                            : []),
                        ...(itemType !== "folder"
                            ? [
                                {
                                    icon: Download,
                                    label: "Download",
                                    action: "download",
                                },
                            ]
                            : []),
                        { divider: true, label: "", action: "" },
                        {
                            icon: Copy,
                            label: selectedCount > 1 ? `Copy (${selectedCount})` : "Copy",
                            action: "copy",
                            shortcut: "Ctrl+C",
                        },
                        {
                            icon: Scissors,
                            label: selectedCount > 1 ? `Cut (${selectedCount})` : "Cut",
                            action: "cut",
                            shortcut: "Ctrl+X",
                        },
                        {
                            icon: Clipboard,
                            label: "Paste",
                            action: "paste",
                            shortcut: "Ctrl+V",
                        },
                        { divider: true, label: "", action: "" },
                        ...(!isTrashMode
                            ? [
                                {
                                    icon: Pencil,
                                    label: "Rename",
                                    action: "rename",
                                    shortcut: "F2",
                                },
                            ]
                            : []),
                        ...(isTrashMode
                            ? [
                                {
                                    icon: RotateCcw,
                                    label: selectedCount > 1 ? `Restore (${selectedCount})` : "Restore",
                                    action: "restore",
                                },
                            ]
                            : []),
                        { divider: true, label: "", action: "" },
                        {
                            icon: Trash2,
                            label: isTrashMode
                                ? (selectedCount > 1 ? `Delete Forever (${selectedCount})` : "Delete Forever from Drive")
                                : (selectedCount > 1 ? `Move to Drive Trash (${selectedCount})` : "Move to Drive Trash"),
                            action: "delete",
                            shortcut: "Del",
                            danger: true,
                            disabled: disableDelete,
                        },
                        { divider: true, label: "", action: "" },
                        {
                            icon: Info,
                            label: "Details",
                            action: "properties",
                            shortcut: "Alt+Enter",
                        },
                    ]
                    : [
                        // Local File/Folder context menu
                        {
                            icon: Eye,
                            label: "Open",
                            action: "open",
                            shortcut: "Enter",
                        },
                        ...(isVideo && onCopyStreamUrl
                            ? [
                                {
                                    icon: Link,
                                    label: "Copy Stream URL",
                                    action: "copy_stream_url",
                                },
                            ]
                            : []),
                        {
                            icon: Star,
                            label: isStarred ? "Remove from Starred" : "Add to Starred",
                            action: "toggle_star",
                        },
                        ...(onAddToPlaylist
                            ? [{ icon: ListPlus, label: "Add to playlist", action: "add_to_playlist" }]
                            : []),
                        {
                            icon: Download,
                            label: "Download",
                            action: "download",
                        },
                        ...(onMakeOffline
                            ? [{ icon: HardDriveDownload, label: "Make available offline", action: "make_offline" }]
                            : []),
                        ...(onRemoveOffline
                            ? [{ icon: CloudOff, label: "Remove offline copy", action: "remove_offline" }]
                            : []),
                        ...(onProtect
                            ? [{ icon: Shield, label: "Protect from deletion", action: "protect" }]
                            : []),
                        ...(onUnprotect
                            ? [{ icon: ShieldOff, label: "Remove protection", action: "unprotect" }]
                            : []),
                        ...(onSetFolderColor
                            ? [{ swatches: true, label: "Folder colour", action: "folder_color" }]
                            : []),
                        ...(isArchive && canArchive
                            ? [
                                { divider: true, label: "", action: "" },
                                {
                                    icon: Eye,
                                    label: "View Archive",
                                    action: "inspect_archive",
                                },
                                {
                                    icon: Archive,
                                    label: "Extract to Cloud",
                                    action: "extract_archive",
                                },
                            ]
                            : []),
                        ...(canArchive
                            ? [
                                { divider: true, label: "", action: "" },
                                {
                                    icon: Archive,
                                    label: selectedCount > 1 ? `Compress to ZIP (${selectedCount})` : "Compress to ZIP",
                                    action: "compress",
                                },
                            ]
                            : []),
                        { divider: true, label: "", action: "" },
                        {
                            icon: Copy,
                            label: selectedCount > 1 ? `Copy (${selectedCount})` : "Copy",
                            action: "copy",
                            shortcut: "Ctrl+C",
                        },
                        {
                            icon: Scissors,
                            label: selectedCount > 1 ? `Cut (${selectedCount})` : "Cut",
                            action: "cut",
                            shortcut: "Ctrl+X",
                        },
                        {
                            icon: Clipboard,
                            label: "Paste",
                            action: "paste",
                            shortcut: "Ctrl+V",
                        },
                        { divider: true, label: "", action: "" },
                        {
                            icon: Pencil,
                            label: "Rename",
                            action: "rename",
                            shortcut: "F2",
                        },
                        {
                            icon: Share2,
                            label: "Share",
                            action: "share",
                            disabled: true,
                        },
                        ...(isVaultMode
                            ? [
                                {
                                    icon: FolderOpen,
                                    label: selectedCount > 1 ? `Move to Home (${selectedCount})` : "Move to Home",
                                    action: "move_to_home",
                                },
                            ]
                            : [
                                {
                                    icon: ShieldCheck,
                                    label: selectedCount > 1 ? `Move to Vault (${selectedCount})` : "Move to Vault",
                                    action: "move_to_vault",
                                },
                            ]),
                        { divider: true, label: "", action: "" },
                        ...deleteOr({
                            icon: Trash2,
                            label: selectedCount > 1 ? `Move to Trash (${selectedCount})` : "Move to Trash",
                            action: "delete",
                            shortcut: "Del",
                            danger: true,
                            disabled: disableDelete,
                        }),
                        { divider: true, label: "", action: "" },
                        {
                            icon: Info,
                            label: "Details",
                            action: "properties",
                            shortcut: "Alt+Enter",
                        },
                    ]);
    if (isMobile) {
        return (<>
        {/* Backdrop for mobile */}
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity" onClick={onClose}/>

        {/* Bottom Sheet Card */}
        <div ref={menuRef} role="menu" aria-label={itemName ? `Actions for ${itemName}` : "Folder actions"} className="fixed inset-x-0 bottom-0 z-50 bg-background border-t border-border rounded-t-2xl shadow-2xl overflow-hidden pb-6 pt-3 px-4 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200" onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}>
          {/* Top handle pill */}
          <div className="w-12 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-3"/>

          {/* Item Name header if file or folder */}
          {itemName && (<div className="text-center pb-3 border-b border-border/60 mb-2">
              <p className="text-sm font-semibold truncate text-foreground px-2">{itemName}</p>
              <p className="text-xs text-muted-foreground capitalize">{itemType}</p>
            </div>)}

          <div className="space-y-1">
            {menuItems.map((item, index) => {
                if (item.divider) {
                    return (<div key={`divider-${index}`} className="h-px bg-border/50 my-1 mx-1"/>);
                }
                if (item.swatches) {
                    return <ColorSwatches key="folder_color" className="px-4 py-2.5" current={folderColor} onPick={(c) => { onSetFolderColor?.(c); onClose(); }}/>;
                }
                const Icon = item.icon;
                const isDisabled = item.disabled || (item.action === "paste" && (!hasClipboard || !hasClipboard()));
                return (<button key={item.action} role="menuitem" tabIndex={isDisabled ? -1 : 0} onClick={() => !isDisabled && handleAction(item.action)} disabled={isDisabled} className={`w-full flex items-center justify-between px-4 py-3 min-h-[44px] rounded-xl text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${isDisabled
                        ? "text-muted-foreground/40 cursor-not-allowed"
                        : item.danger
                            ? "text-destructive hover:bg-destructive/10 active:bg-destructive/20"
                            : "text-foreground hover:bg-accent active:bg-accent/80"}`}>
                  <div className="flex items-center gap-3">
                    {Icon && (<Icon className={`w-5 h-5 flex-shrink-0 ${isDisabled ? "opacity-40" : ""}`}/>)}
                    <span className="font-medium text-sm">{item.label}</span>
                  </div>
                </button>);
            })}
          </div>

          <button onClick={onClose} className="w-full mt-3 py-2.5 min-h-[44px] rounded-xl border border-border text-center text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Cancel
          </button>
        </div>
      </>);
    }
    // Adjust position to keep menu on screen
    const menuWidth = 280;
    const menuHeight = menuItems.filter((item) => !item.divider).length * 36 + menuItems.filter((item) => item.divider).length * 9 + (onSetFolderColor ? 24 : 0);
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10);
    const adjustedY = Math.max(10, Math.min(y, window.innerHeight - menuHeight - 10));
    return (<>
      {/* Backdrop for better visibility */}
      <div className="fixed inset-0 z-40" style={{ background: "transparent" }} onClick={onClose}/>

      <div ref={menuRef} role="menu" aria-label={itemName ? `Actions for ${itemName}` : "Folder actions"} className="fixed z-50 bg-background/80 backdrop-blur-md border border-border/50 rounded-xl shadow-2xl overflow-x-hidden overflow-y-auto" style={{
            maxHeight: "calc(100vh - 20px)",
            left: `${adjustedX}px`,
            top: `${adjustedY}px`,
            width: `${menuWidth}px`,
            animation: "context-menu-in 0.1s ease-out",
        }}>
        <div className="py-1">
          {menuItems.map((item, index) => {
            if (item.divider) {
                return (<div key={`divider-${index}`} className="h-px bg-border/50 my-1 mx-1"/>);
            }
            if (item.swatches) {
                return <ColorSwatches key="folder_color" className="px-3 py-1.5" current={folderColor} onPick={(c) => { onSetFolderColor?.(c); onClose(); }}/>;
            }
            const Icon = item.icon;
            const isDisabled = item.disabled || (item.action === "paste" && (!hasClipboard || !hasClipboard()));
            return (<button key={item.action} role="menuitem" tabIndex={isDisabled ? -1 : 0} onClick={() => !isDisabled && handleAction(item.action)} disabled={isDisabled} className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${isDisabled
                    ? "text-muted-foreground/50 cursor-not-allowed"
                    : item.danger
                        ? "text-foreground hover:bg-destructive hover:text-destructive-foreground"
                        : "text-foreground hover:bg-accent hover:text-accent-foreground"}`}>
                <div className="flex items-center gap-3">
                  {Icon && (<Icon className={`w-4 h-4 flex-shrink-0 ${isDisabled ? "opacity-40" : ""}`}/>)}
                  <span className="font-normal">{item.label}</span>
                </div>
                {item.shortcut && (<span className={`text-xs font-mono ${isDisabled
                        ? "text-muted-foreground/30"
                        : "text-muted-foreground group-hover:text-accent-foreground/70"}`}>
                    {item.shortcut}
                  </span>)}
              </button>);
        })}
        </div>
      </div>

      <style>{`
        @keyframes context-menu-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>);
};
