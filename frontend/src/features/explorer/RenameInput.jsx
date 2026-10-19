import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
const FORBIDDEN_CHARS_REGEX = /[/\\:*?"<>|\x00-\x1f]/;
export const RenameInput = ({ initialName, onSave, onCancel }) => {
    const [value, setValue] = useState(initialName);
    const inputRef = useRef(null);
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            // Select filename without extension
            const lastDotIndex = initialName.lastIndexOf(".");
            if (lastDotIndex > 0) {
                inputRef.current.setSelectionRange(0, lastDotIndex);
            }
            else {
                inputRef.current.select();
            }
        }
    }, [initialName]);
    const handleSubmit = () => {
        const trimmed = value.trim();
        if (!trimmed || trimmed === initialName) {
            onCancel();
            return;
        }
        if (trimmed.length > 60) {
            toast.error("Name cannot exceed 60 characters");
            onCancel();
            return;
        }
        if (FORBIDDEN_CHARS_REGEX.test(trimmed)) {
            toast.error('Name cannot contain: / \\ : * ? " < > |');
            onCancel();
            return;
        }
        if (trimmed === "." || trimmed === "..") {
            toast.error("Name cannot be '.' or '..'");
            onCancel();
            return;
        }
        onSave(trimmed);
    };
    const handleKeyDown = (e) => {
        if (e.key === "Enter") {
            handleSubmit();
        }
        else if (e.key === "Escape") {
            onCancel();
        }
    };
    return (<Input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} onBlur={handleSubmit} onKeyDown={handleKeyDown} aria-label="Rename item" className="h-7 text-xs bg-background" onClick={(e) => e.stopPropagation()}/>);
};
