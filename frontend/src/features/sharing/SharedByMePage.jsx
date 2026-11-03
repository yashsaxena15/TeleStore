// Shared by me: your files and folders that are shared with people or by link. Each opens the
// Share dialog.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Globe, Share2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { ShareThumb } from "./ShareFileList";
import { requestShare } from "./requestShare";
import { linkStatusLabel, peopleLabel } from "./shareHelpers";

const MINE_KEY = ["shares", "mine"];

export const SharedByMePage = () => {
    const queryClient = useQueryClient();
    const { data, isLoading, error, refetch } = useQuery({ queryKey: MINE_KEY, queryFn: api.sharedByMe });
    const shares = data?.shares || [];
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: MINE_KEY });
        queryClient.invalidateQueries({ queryKey: ["files"] });
    };
    return (<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <PageHeader icon={Share2} title="Shared by me" subtitle="Your files and folders that others can open"/>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 pb-24 md:pb-6">
        {isLoading ? <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
            : error ? (<div className="py-16 text-center text-sm"><p className="text-destructive">{error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => refetch()}>Try again</Button></div>)
                : shares.length === 0 ? (<div className="py-16 text-center text-muted-foreground"><Share2 className="w-8 h-8 mx-auto mb-3 opacity-60"/><p className="text-sm">You haven't shared anything yet.</p><p className="text-xs mt-1">Right-click a file or folder and pick Share.</p></div>)
                    : (<ul role="list" aria-label="Shared by me" className="divide-y divide-border rounded-lg border border-border bg-card/40">
          {shares.map((s) => {
                const people = peopleLabel(s.members);
                const link = linkStatusLabel(s.link);
                return (<li key={s.share_id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                <button type="button" onClick={() => requestShare({ id: s.item.id, name: s.item.name, type: s.item.type }, refresh)} className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Share ${s.item.name}`}>
                  <span className="w-10 h-10 shrink-0 rounded-md border border-border bg-muted/40 overflow-hidden grid place-items-center">
                    <ShareThumb item={s.item}/>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{s.item.name}{s.trashed && <span className="ml-2 text-xs font-normal text-muted-foreground">(in Trash)</span>}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {people && <span className="inline-flex items-center gap-1"><Users className="w-3 h-3"/>{people}</span>}
                      {link && <span className={`inline-flex items-center gap-1 ${s.link?.state === "active" ? "" : "text-warning"}`}><Globe className="w-3 h-3"/>{link}</span>}
                      {!people && !link && <span>Not shared</span>}
                    </span>
                  </span>
                </button>
                {s.location && !s.trashed && (<Button type="button" size="sm" variant="ghost" className="shrink-0" aria-label={`Show ${s.item.name} in its folder`} title="Show in folder" onClick={() => window.dispatchEvent(new CustomEvent("changeCategory", { detail: { folderPath: s.location } }))}>
                    <FolderOpen className="w-4 h-4"/><span className="hidden sm:inline ml-1.5">Show in folder</span>
                  </Button>)}
              </li>);
            })}
        </ul>)}
      </div>
    </div>);
};
