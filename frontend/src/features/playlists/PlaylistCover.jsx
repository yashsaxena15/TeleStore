import { Heart, ListMusic } from "lucide-react";
import { cn } from "@/lib/utils";
import { Thumbnail } from "@/features/explorer/Thumbnail";

/** A playlist's picture: a heart for Liked music, else its first item, else a music note. */
export const PlaylistCover = ({ playlist, className = "w-12 h-12" }) => {
    if (playlist.isLiked) {
        return (<span className={cn("rounded-lg grid place-items-center shrink-0 bg-gradient-to-br from-indigo-600 to-pink-600", className)}>
        <Heart className="w-[45%] h-[45%] fill-white text-white"/>
      </span>);
    }
    if (playlist.cover) {
        return (<span className={cn("rounded-lg overflow-hidden shrink-0 bg-muted grid place-items-center", className)}>
        <Thumbnail item={playlist.cover} size="fill"/>
      </span>);
    }
    return (<span className={cn("rounded-lg grid place-items-center shrink-0 bg-secondary text-secondary-foreground", className)}>
      <ListMusic className="w-[45%] h-[45%]"/>
    </span>);
};
