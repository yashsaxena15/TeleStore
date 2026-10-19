import { useEffect, useState } from "react";
import { FolderDown, FolderOpen, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { homeDir } from "@tauri-apps/api/path";
import { Button } from "@/components/ui/button";
import authService from "@/features/auth/authService";
import { SettingsPanel, Field, ValueBox } from "../SettingsUi";

const STORAGE_KEY = "downloadFolder";

const readFolder = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) || "";
    }
    catch {
        return "";
    }
};

// Where the desktop app saves downloads. Browsers always use their own download folder.
export const DownloadsSection = () => {
    const isDesktop = authService.isTauri();
    const [folder, setFolder] = useState(readFolder);
    const [defaultFolder, setDefaultFolder] = useState("");
    useEffect(() => {
        if (!isDesktop) return;
        homeDir().then((home) => setDefaultFolder(`${home}Downloads\\fileServer`)).catch(() => { });
    }, [isDesktop]);
    const save = (value) => {
        try {
            if (value) localStorage.setItem(STORAGE_KEY, value);
            else localStorage.removeItem(STORAGE_KEY);
            setFolder(value);
            toast.success(value ? "Download folder saved" : "Using the default download folder");
        }
        catch {
            toast.error("Couldn't save the download folder");
        }
    };
    const browse = async () => {
        try {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({ directory: true, multiple: false, title: "Choose download folder" });
            if (selected) save(selected);
        }
        catch {
            toast.error("Couldn't open the folder picker");
        }
    };
    return (<SettingsPanel icon={FolderDown} title="Downloads" description={isDesktop ? "Where the desktop app saves files" : "Where downloaded files go"}>
      {isDesktop ? (<Field label="Save downloads to" hint={!folder && defaultFolder ? `Default: ${defaultFolder}` : undefined}>
          <div className="flex flex-wrap gap-2">
            <ValueBox mono className="flex-1 basis-64">{folder || defaultFolder || "Default download folder"}</ValueBox>
            <Button variant="outline" className="h-9" onClick={browse}><FolderOpen className="w-3.5 h-3.5 mr-1.5"/>Browse</Button>
            {folder && <Button variant="ghost" className="h-9" onClick={() => save("")}><RotateCcw className="w-3.5 h-3.5 mr-1.5"/>Use default</Button>}
          </div>
        </Field>) : (<p className="text-sm text-muted-foreground">
          In a browser, files are saved to your browser's download folder. Choosing a folder is available in the TeleStore desktop app.
        </p>)}
    </SettingsPanel>);
};
