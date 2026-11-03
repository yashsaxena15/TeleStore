// The public page of an "Anyone with the link" share: /s/:token. Works signed out, sends no
// sign-in, and is view only. A file shows a preview and a Download button; a folder is a
// browsable list (?path= inside it) with "Download all". Downloads are hidden when the owner
// turned them off.
import { lazy, Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Download, FileQuestion, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { linkApi } from "@/features/sharing/publicLink";
import { ShareCrumbs, ShareFileList, ShareThumb } from "@/features/sharing/ShareFileList";
import { downloadUrl, useSharedViewer } from "@/features/sharing/SharedViewer";
import { crumbsFor, expiryText, joinRel, previewKind } from "@/features/sharing/shareHelpers";

const FolderDownloadDialog = lazy(() => import("@/features/explorer/dialogs/FolderDownloadDialog").then((m) => ({ default: m.FolderDownloadDialog })));

// Keeps search engines away from shared links while this page is open
const useNoIndex = (title) => {
    useEffect(() => {
        const meta = document.createElement("meta");
        meta.name = "robots";
        meta.content = "noindex";
        document.head.appendChild(meta);
        return () => meta.remove();
    }, []);
    useEffect(() => {
        if (!title) return undefined;
        const before = document.title;
        document.title = `${title} · TeleStore`;
        return () => { document.title = before; };
    }, [title]);
};

const Shell = ({ children, owner }) => (<div className="flex-1 min-h-0 w-full overflow-y-auto bg-background text-foreground select-text">
    <header className="flex items-center gap-2.5 h-14 px-4 sm:px-6 border-b border-border">
      <img src="/logo-symbol.svg" alt="" className="w-7 h-7"/>
      <span className="font-semibold tracking-tight">TeleStore</span>
      {owner && <span className="ml-auto text-xs sm:text-sm text-muted-foreground truncate">Shared by {owner}</span>}
    </header>
    <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-5 pb-12">{children}</main>
  </div>);

const Message = ({ icon: Icon, title, body }) => (<Shell>
    <div role="alert" className="py-20 flex flex-col items-center text-center gap-3">
      <span className="w-12 h-12 rounded-full bg-muted grid place-items-center text-muted-foreground"><Icon className="w-6 h-6"/></span>
      <h1 className="text-lg font-semibold">{title}</h1>
      {body && <p className="text-sm text-muted-foreground max-w-sm">{body}</p>}
    </div>
  </Shell>);

const ErrorPage = ({ error }) => {
    if (error.status === 404)
        return <Message icon={FileQuestion} title="This link doesn't exist" body="Check that you have the whole link, or ask the person who sent it for a new one."/>;
    if (error.status === 410)
        return <Message icon={Link2Off} title="This link doesn't work anymore" body={error.message}/>;
    if (error.status === 429)
        return <Message icon={Clock} title="Too many requests" body={`Wait ${error.retryAfter ? `${error.retryAfter} seconds` : "a minute"} and try again.`}/>;
    return <Message icon={AlertTriangle} title="Couldn't open this link" body={error.message}/>;
};

const FilePreview = ({ item, url }) => {
    const kind = previewKind(item);
    if (kind === "image") return <img src={url} alt={item.name} className="max-h-[70dvh] max-w-full mx-auto rounded-lg border border-border object-contain bg-muted/30"/>;
    if (kind === "video") return <video src={url} controls playsInline className="w-full max-h-[70dvh] rounded-lg bg-black"/>;
    if (kind === "audio") return <audio src={url} controls className="w-full"/>;
    if (kind === "pdf") return <iframe src={url} title={item.name} className="w-full h-[70dvh] rounded-lg border border-border bg-white"/>;
    return null;
};

const useZip = (token, urls) => {
    const [zip, setZip] = useState(null);
    const start = async (path) => {
        try {
            const info = await linkApi.zipInfo(token, path);
            if (!info.parts?.length) return toast.info("This folder is empty.");
            if (info.parts.length === 1) {
                downloadUrl(urls.part(info.parts[0].download_url), info.parts[0].name);
                toast.success(`Downloading ${info.parts[0].name}`);
            }
            else setZip(info);
        }
        catch (err) {
            toast.error(err.message);
        }
    };
    const dialog = zip && (<Suspense fallback={null}><FolderDownloadDialog open info={zip} onClose={() => setZip(null)} onDownloadPart={(part) => downloadUrl(urls.part(part.download_url), part.name)} onDownloadAll={(parts) => parts.forEach((part, i) => setTimeout(() => downloadUrl(urls.part(part.download_url), part.name), i * 400))}/></Suspense>);
    return { start, dialog };
};

const FolderView = ({ token, info, urls }) => {
    const [params, setParams] = useSearchParams();
    const path = params.get("path") || "";
    const canDownload = info.allow_download !== false;
    const { data, isLoading, error } = useQuery({ queryKey: ["share-link", token, "list", path], queryFn: () => linkApi.list(token, path), retry: false });
    const download = canDownload ? (it) => downloadUrl(urls.file(it.id), it.name) : undefined;
    const viewer = useSharedViewer({ fileUrl: (it, inline) => urls.file(it.id, inline), onDownload: download });
    const zip = useZip(token, urls);
    const goTo = (p) => setParams(p ? { path: p } : {});
    const items = data?.items || [];
    return (<>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <ShareCrumbs crumbs={crumbsFor(info.item.name, path)} onOpen={goTo}/>
        {canDownload && <Button size="sm" className="ml-auto" onClick={() => zip.start(path)}><Download className="w-4 h-4 mr-1.5"/>Download all</Button>}
      </div>
      {isLoading ? <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
            : error ? <p role="alert" className="py-16 text-center text-sm text-destructive">{error.message}</p>
                : <ShareFileList items={items} thumbUrl={(it) => urls.thumb(it.id)} onOpen={(it) => (it.type === "folder" ? goTo(joinRel(it.path ?? path, it.name)) : viewer.open(it, items))} onDownload={download}/>}
      {viewer.viewers}
      {zip.dialog}
    </>);
};

const FileView = ({ info, urls }) => {
    const item = info.item;
    const canDownload = info.allow_download !== false;
    const kind = previewKind(item);
    const download = canDownload ? (it) => downloadUrl(urls.file(it.id), it.name) : undefined;
    const viewer = useSharedViewer({ fileUrl: (it, inline) => urls.file(it.id, inline), onDownload: download });
    const inline = urls.file(item.id, true);
    return (<div className="grid gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-10 h-10 shrink-0 rounded-md border border-border bg-muted/40 overflow-hidden grid place-items-center"><ShareThumb item={item} src={urls.thumb(item.id)}/></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-semibold break-words">{item.name}</h1>
          <p className="text-xs font-mono text-muted-foreground">{formatBytes(item.size || 0)}</p>
        </div>
        {canDownload && <Button onClick={() => download(item)} className="shrink-0"><Download className="w-4 h-4 mr-1.5"/>Download</Button>}
      </div>
      {["image", "video", "audio", "pdf"].includes(kind) ? <FilePreview item={item} url={inline}/>
            : kind === "doc" ? <Button variant="outline" className="justify-self-start" onClick={() => viewer.open(item)}>Open preview</Button>
                : <p className="text-sm text-muted-foreground">There's no preview for this kind of file.</p>}
      {viewer.viewers}
    </div>);
};

const SharedLink = () => {
    const { token } = useParams();
    const { data: info, isLoading, error } = useQuery({ queryKey: ["share-link", token, "info"], queryFn: () => linkApi.info(token), retry: false, refetchOnWindowFocus: false });
    useNoIndex(info?.item?.name);
    if (isLoading)
        return (<Shell><div className="py-20 flex justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin"/></div></Shell>);
    if (error)
        return <ErrorPage error={error}/>;
    const urls = linkApi.urls(token);
    const expiry = expiryText(info.expires_at);
    return (<Shell owner={info.owner_name}>
      {info.item.type === "folder" ? <FolderView token={token} info={info} urls={urls}/> : <FileView info={info} urls={urls}/>}
      <p className="mt-6 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>View only</span>
        {info.allow_download === false && <span>Downloads are off</span>}
        {expiry && <span>{expiry}</span>}
        {typeof info.downloads_left === "number" && <span>{info.downloads_left} {info.downloads_left === 1 ? "download" : "downloads"} left</span>}
      </p>
    </Shell>);
};

export default SharedLink;
