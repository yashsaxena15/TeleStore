// Opening files that someone shared: pictures in the image viewer, documents in the reader, and
// video and audio in a plain player (the app's own player looks files up by the owner's name, so
// it isn't used here). Anything else downloads. Used by Shared with me and the public link page.
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extensionOf, previewKind } from "./shareHelpers";

const ImageViewer = lazy(() => import("@/features/viewers/ImageViewer").then((m) => ({ default: m.ImageViewer })));
const DocumentReaderModal = lazy(() => import("@/features/viewers/DocumentReaderModal").then((m) => ({ default: m.DocumentReaderModal })));

/** Starts a browser download of [url]. */
export function downloadUrl(url, name) {
    const a = document.createElement("a");
    a.href = url;
    if (name) a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
}

export const MediaDialog = ({ media, onClose }) => (<Dialog open={Boolean(media)} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-w-3xl p-3 sm:p-4">
      <DialogHeader>
        <DialogTitle className="truncate pr-6 text-sm">{media?.name}</DialogTitle>
        <DialogDescription className="sr-only">{media?.kind === "video" ? "Video player" : "Audio player"}</DialogDescription>
      </DialogHeader>
      {media?.kind === "video"
        ? <video src={media.url} controls autoPlay playsInline className="w-full max-h-[70dvh] rounded-md bg-black"/>
        : media && <audio src={media.url} controls autoPlay className="w-full"/>}
    </DialogContent>
  </Dialog>);

/**
 * fileUrl(item, inline) gives a file's address. onDownload(item) is called for files that can't
 * be shown here (undefined when downloads are off). Returns { open, viewers }: open(item, items)
 * shows a file; render `viewers` once.
 */
export function useSharedViewer({ fileUrl, onDownload }) {
    const [images, setImages] = useState(null);
    const [doc, setDoc] = useState(null);
    const [media, setMedia] = useState(null);
    const open = (item, items = [item]) => {
        const kind = previewKind(item);
        if (kind === "image") {
            const pics = items.filter((it) => previewKind(it) === "image");
            setImages({ list: pics.map((it) => ({ url: fileUrl(it, true), fileName: it.name })), index: Math.max(0, pics.findIndex((it) => it.id === item.id)) });
        }
        else if (kind === "video" || kind === "audio") {
            setMedia({ kind, url: fileUrl(item, true), name: item.name });
        }
        else if (kind === "pdf" || kind === "doc") {
            setDoc({ url: fileUrl(item, true), fileName: item.name, extension: extensionOf(item.name) });
        }
        else if (onDownload) {
            onDownload(item);
        }
        else {
            toast.info("This file can't be previewed, and downloads are off for this link.");
        }
    };
    const viewers = (<>
      {images && <Suspense fallback={null}><ImageViewer images={images.list} initialIndex={images.index} onClose={() => setImages(null)}/></Suspense>}
      {doc && <Suspense fallback={null}><DocumentReaderModal url={doc.url} fileName={doc.fileName} fileExtension={doc.extension} onClose={() => setDoc(null)}/></Suspense>}
      <MediaDialog media={media} onClose={() => setMedia(null)}/>
    </>);
    return { open, viewers };
}
