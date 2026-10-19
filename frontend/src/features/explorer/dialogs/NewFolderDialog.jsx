import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { FolderPlus, AlertCircle } from "lucide-react";
const MAX_FOLDER_NAME_LENGTH = 60;
const MAX_FOLDER_DEPTH = 100;
const FORBIDDEN_CHARS_REGEX = /[/\\:*?"<>|\x00-\x1f]/;
export const NewFolderDialog = ({ open, currentPath, onClose, onConfirm }) => {
    const [folderName, setFolderName] = useState("");
    const inputRef = useRef(null);
    const dialogRef = useRef(null);
    const previousActiveElement = useRef(null);
    // Calculate current subfolder depth relative to root (/Home)
    const segments = currentPath ? currentPath.split("/").filter((p) => p && p !== "Home") : [];
    const currentDepth = segments.length;
    const isMaxDepthReached = currentDepth >= MAX_FOLDER_DEPTH;

    useEffect(() => {
        if (open) {
            previousActiveElement.current = document.activeElement;
            const timer = setTimeout(() => {
                if (inputRef.current && !isMaxDepthReached) {
                    inputRef.current.focus();
                }
            }, 50);
            return () => {
                clearTimeout(timer);
                if (previousActiveElement.current && typeof previousActiveElement.current.focus === "function") {
                    previousActiveElement.current.focus();
                }
            };
        }
    }, [open, isMaxDepthReached]);

    const hasForbiddenChars = FORBIDDEN_CHARS_REGEX.test(folderName);
    const isNameEmpty = !folderName.trim();
    const isReservedName = folderName.trim() === "." || folderName.trim() === "..";
    const isValid = !isMaxDepthReached && !isNameEmpty && !hasForbiddenChars && !isReservedName && folderName.length <= MAX_FOLDER_NAME_LENGTH;
    const handleSubmit = (e) => {
        e.preventDefault();
        if (isMaxDepthReached) {
            toast.error(`Maximum folder depth limit (${MAX_FOLDER_DEPTH} levels) reached.`);
            return;
        }
        const trimmed = folderName.trim();
        if (!trimmed) {
            toast.error("Folder name cannot be empty");
            return;
        }
        if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
            toast.error(`Folder name cannot exceed ${MAX_FOLDER_NAME_LENGTH} characters`);
            return;
        }
        if (FORBIDDEN_CHARS_REGEX.test(trimmed)) {
            toast.error('Folder name cannot contain: / \\ : * ? " < > |');
            return;
        }
        if (trimmed === "." || trimmed === "..") {
            toast.error("Folder name cannot be '.' or '..'");
            return;
        }
        onConfirm(trimmed);
        setFolderName("");
    };
    const handleClose = () => {
        setFolderName("");
        onClose();
    };
    const handleKeyDown = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            handleClose();
            return;
        }
        if (e.key === "Tab") {
            if (!dialogRef.current) return;
            const focusables = dialogRef.current.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    };
    if (!open)
        return null;
    return (<div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-folder-dialog-title" className="bg-card border border-border text-card-foreground rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150" onKeyDown={handleKeyDown}>
        <div className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <FolderPlus className="w-5 h-5"/>
            </div>
            <div>
              <h2 id="new-folder-dialog-title" className="text-lg font-semibold text-foreground">Create New Folder</h2>
              <p className="text-xs text-muted-foreground">
                Depth: <span className="font-medium text-foreground">{currentDepth}</span> / {MAX_FOLDER_DEPTH} levels
              </p>
            </div>
          </div>

          {isMaxDepthReached ? (<div className="p-3 mb-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/>
              <span>
                Maximum folder depth limit of <strong>{MAX_FOLDER_DEPTH} levels</strong> reached. You cannot create subfolders inside this folder.
              </span>
            </div>) : null}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1.5">
                <label htmlFor="folderName" className="text-xs font-medium text-foreground">
                  Folder Name
                </label>
                <span className={`text-[11px] font-mono ${folderName.length > MAX_FOLDER_NAME_LENGTH - 10
            ? "text-warning font-semibold"
            : "text-muted-foreground"}`}>
                  {folderName.length}/{MAX_FOLDER_NAME_LENGTH}
                </span>
              </div>

              <input ref={inputRef} id="folderName" aria-label="Folder Name" type="text" disabled={isMaxDepthReached} maxLength={MAX_FOLDER_NAME_LENGTH} value={folderName} onChange={(e) => setFolderName(e.target.value)} className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none transition-colors ${hasForbiddenChars || isReservedName
            ? "border-destructive bg-destructive/5 text-foreground focus:ring-1 focus:ring-destructive"
            : "border-input bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent"} disabled:opacity-50 disabled:cursor-not-allowed`} placeholder="Enter folder name"/>

              {hasForbiddenChars && (<p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0"/>
                  Cannot contain: / \ : * ? &quot; &lt; &gt; |
                </p>)}

              {isReservedName && (<p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0"/>
                  Folder name cannot be &quot;.&quot; or &quot;..&quot;
                </p>)}
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button type="button" onClick={handleClose} className="px-3.5 py-1.5 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-secondary/80 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                Cancel
              </button>
              <button type="submit" disabled={!isValid} className="px-4 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                Create Folder
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>);
};
