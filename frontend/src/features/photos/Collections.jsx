// Collections, as in Google Photos (and the app): Favourites, Archive and Trash, then the albums
// (folders in the phone backup) with their newest photo as the cover.
import { useQuery } from "@tanstack/react-query";
import { Archive, ArrowLeft, Images, Loader2, Star, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { apiFileToFileItem } from "@/features/explorer/fileTypes";
import { Thumbnail } from "@/features/explorer/Thumbnail";
import { albumNames, PHOTOS_FOLDER } from "./timeline";

const Shortcut = ({ icon: Icon, label, onClick }) => (<button type="button" onClick={onClick} className="grid justify-items-center gap-2 rounded-2xl bg-card py-4 hover:bg-muted transition-colors">
    <Icon className="w-6 h-6"/>
    <span className="text-sm">{label}</span>
  </button>);

const AlbumCard = ({ name, onOpen }) => {
    const cover = useQuery({
        queryKey: ["photos", "cover", name],
        queryFn: async () => {
            const res = await api.fetchMedia(`${PHOTOS_FOLDER}/${name}`, 1, 1);
            return res.files?.[0] ? apiFileToFileItem(res.files[0]) : null;
        },
        staleTime: 5 * 60_000,
    });
    return (<button type="button" onClick={onOpen} className="text-left group">
      <div className="aspect-square rounded-2xl overflow-hidden bg-muted grid place-items-center">
        {cover.data ? <Thumbnail item={cover.data} size="fill"/> : <Images className="w-9 h-9 text-primary"/>}
      </div>
      <p className="mt-1.5 px-0.5 truncate group-hover:underline">{name}</p>
    </button>);
};

export const Collections = ({ onBack, onOpen }) => {
    const albums = useQuery({
        queryKey: ["photos", "albums", PHOTOS_FOLDER],
        queryFn: async () => albumNames((await api.fetchFiles(PHOTOS_FOLDER, 1, 500)).files),
        staleTime: 60_000,
    });
    const openTrash = () => window.dispatchEvent(new CustomEvent("changeCategory", { detail: { filter: "trash" } }));
    return (<div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="flex items-center gap-2 px-2 sm:px-4 h-16">
        <button type="button" onClick={onBack} className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" aria-label="Back to Photos"><ArrowLeft className="w-5 h-5"/></button>
        <h1 className="text-xl">Collections</h1>
      </div>
      <div className="px-4 sm:px-6 pb-8 max-w-5xl">
        <div className="grid grid-cols-3 gap-3">
          <Shortcut icon={Star} label="Favourites" onClick={() => onOpen({ kind: "starred" })}/>
          <Shortcut icon={Archive} label="Archive" onClick={() => onOpen({ kind: "archive" })}/>
          <Shortcut icon={Trash2} label="Trash" onClick={openTrash}/>
        </div>
        <h2 className="text-xl mt-8 mb-3">Albums</h2>
        {albums.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/>}
        {albums.data?.length === 0 && <p className="text-sm text-muted-foreground">Each phone album you back up gets its own album here. Make your own with + on Photos.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {albums.data?.map((name) => <AlbumCard key={name} name={name} onOpen={() => onOpen({ kind: "album", name })}/>)}
        </div>
      </div>
    </div>);
};
