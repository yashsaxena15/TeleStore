import { useState, useRef, useEffect } from "react";
import { Plus, FolderPlus, FileUp, FolderUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export const FloatingUploadButton = ({ onUploadFiles, onUploadFolder, onCreateFolder, className, }) => {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;

        // Focus first focusable item in menu on open
        const timer = setTimeout(() => {
            const firstButton = menuRef.current?.querySelector("button");
            firstButton?.focus();
        }, 50);

        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen(false);
                triggerRef.current?.focus();
                return;
            }
            if (e.key === "Tab") {
                if (!menuRef.current) return;
                const buttons = Array.from(menuRef.current.querySelectorAll("button"));
                if (buttons.length === 0) return;
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
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

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen]);

    const handleFileUpload = () => {
        if (onUploadFiles) {
            onUploadFiles();
        }
        else {
            const fileGridElement = document.querySelector('[data-drag-container]');
            if (fileGridElement) {
                const fileInput = fileGridElement.querySelector('input[type="file"]:not([webkitdirectory])');
                fileInput?.click();
            }
        }
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    const handleFolderUpload = () => {
        if (onUploadFolder) {
            onUploadFolder();
        }
        else {
            const fileGridElement = document.querySelector('[data-drag-container]');
            if (fileGridElement) {
                const directoryInput = fileGridElement.querySelector('input[type="file"][webkitdirectory]');
                directoryInput?.click();
            }
        }
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    const handleNewFolder = () => {
        if (onCreateFolder) {
            onCreateFolder();
        }
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    return (<>
      {isOpen && (<div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => {
            setIsOpen(false);
            triggerRef.current?.focus();
        }}/>)}
      <div className={`fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-40 ${className || ''}`}>
        {/* Options when open */}
        {isOpen && (<div ref={menuRef} role="menu" aria-label="Upload options" className="absolute bottom-16 right-0 flex flex-col gap-2 mb-2 min-w-44 animate-in slide-in-from-bottom-3 duration-200">
            {onCreateFolder && (<Button role="menuitem" onClick={handleNewFolder} aria-label="Create new folder" className="flex items-center justify-start gap-2.5 bg-card/95 backdrop-blur-md border border-border text-card-foreground hover:bg-muted shadow-xl min-h-[44px] px-4 text-sm rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1" variant="outline">
                <FolderPlus className="w-4 h-4 text-primary"/>
                <span className="font-medium">New folder</span>
              </Button>)}
            <Button role="menuitem" onClick={handleFileUpload} aria-label="Upload file" className="flex items-center justify-start gap-2.5 bg-card/95 backdrop-blur-md border border-border text-card-foreground hover:bg-muted shadow-xl min-h-[44px] px-4 text-sm rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1" variant="outline">
              <FileUp className="w-4 h-4 text-success"/>
              <span className="font-medium">Upload file</span>
            </Button>
            <Button role="menuitem" onClick={handleFolderUpload} aria-label="Upload folder" className="flex items-center justify-start gap-2.5 bg-card/95 backdrop-blur-md border border-border text-card-foreground hover:bg-muted shadow-xl min-h-[44px] px-4 text-sm rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1" variant="outline">
              <FolderUp className="w-4 h-4 text-warning"/>
              <span className="font-medium">Upload folder</span>
            </Button>
          </div>)}

        {/* Main '+' floating button */}
        <Button ref={triggerRef} onClick={() => setIsOpen(!isOpen)} aria-label={isOpen ? "Close upload menu" : "Upload or create folder"} aria-haspopup="menu" aria-expanded={isOpen} className={`rounded-2xl w-14 h-14 shadow-2xl transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${isOpen
            ? "bg-muted text-muted-foreground hover:bg-muted/80 rotate-45"
            : "bg-primary hover:bg-primary/90 text-primary-foreground hover:scale-105"}`} size="icon" title="New (Upload or folder)">
          <Plus className="w-7 h-7 stroke-[2.5]"/>
        </Button>
      </div>
    </>);
};
