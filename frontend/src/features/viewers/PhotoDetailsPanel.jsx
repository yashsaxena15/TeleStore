// Photo details in the image viewer: when it was taken, the camera and exposure, where (with an
// "Open in Maps" link, opened only on click) and the file. A side panel on desktop, a bottom sheet
// on phones. Data: GET /files/{id}/photo-info.
import { useQuery } from "@tanstack/react-query";
import { Aperture, Calendar, FileImage, Loader2, MapPin, X, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { cameraLabel, exposureLine, flashLabel, formatCoordinates, formatTakenAt, mapsUrl, megapixelsLabel } from "./photoInfo";

const Row = ({ icon: Icon, children }) => (<div className="flex gap-3 py-2.5">
    <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true"/>
    <div className="min-w-0 flex-1 text-sm">{children}</div>
  </div>);

// Stop the viewer from treating clicks, drags and scrolls in the panel as swipes or zooms
const stop = (e) => e.stopPropagation();

export const PhotoDetailsPanel = ({ fileId, isMobile, onClose }) => {
    const { data: info, isLoading, isError } = useQuery({
        queryKey: ["photo-info", fileId],
        queryFn: () => api.getPhotoInfo(fileId),
        enabled: Boolean(fileId),
        staleTime: 5 * 60_000,
        retry: false,
    });
    const camera = info ? cameraLabel(info.camera_make, info.camera_model) : "";
    const size = info ? megapixelsLabel(info) : "";
    const exposure = info ? exposureLine(info) : "";
    const flash = info ? flashLabel(info.flash) : "";
    const coords = info ? formatCoordinates(info.latitude, info.longitude) : "";
    const maps = info ? mapsUrl(info.latitude, info.longitude) : null;
    const taken = info ? formatTakenAt(info.taken_at) : "";
    const fileLine = info ? [info.file_size ? formatBytes(info.file_size) : "", info.format || ""].filter(Boolean).join(" · ") : "";
    const hasCamera = camera || info?.lens || size || exposure || flash;

    return (<aside role="complementary" aria-label="Photo details" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onWheel={stop} onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} className={cn("absolute z-[2] bg-background/95 text-foreground backdrop-blur-md border border-border shadow-2xl flex flex-col select-text", isMobile ? "inset-x-0 bottom-0 max-h-[65vh] rounded-t-2xl" : "top-16 right-3 bottom-3 w-80 rounded-xl")}>
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold">Details</h2>
        <button type="button" onClick={onClose} className="w-8 h-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="Close details">
          <X className="w-4 h-4"/>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-1 divide-y divide-border/60">
        {isLoading ? (<div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading details"/></div>)
            : isError || !info ? (<p className="py-6 text-sm text-muted-foreground">Couldn't read the details of this photo.</p>)
                : (<>
                  {taken && (<Row icon={Calendar}><p className="text-xs text-muted-foreground">Date taken</p><p>{taken}</p></Row>)}
                  {hasCamera && (<Row icon={Aperture}>
                      {camera && <p className="font-medium">{camera}</p>}
                      {info.lens && <p className="text-xs text-muted-foreground">{info.lens}</p>}
                      {size && <p className="text-xs text-muted-foreground font-mono mt-0.5">{size}</p>}
                      {exposure && <p className="text-xs text-muted-foreground font-mono">{exposure}</p>}
                    </Row>)}
                  {flash && (<Row icon={Zap}><p>{flash}</p></Row>)}
                  {coords && (<Row icon={MapPin}>
                      <p className="text-xs text-muted-foreground">Location</p>
                      <p className="font-mono text-[13px]">{coords}</p>
                      {maps && <a href={maps} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Open in Maps</a>}
                    </Row>)}
                  <Row icon={FileImage}>
                    <p className="break-all">{info.file_name}</p>
                    {fileLine && <p className="text-xs text-muted-foreground font-mono">{fileLine}</p>}
                    {info.folder && <p className="text-xs text-muted-foreground break-all">{info.folder}</p>}
                  </Row>
                </>)}
      </div>
    </aside>);
};
