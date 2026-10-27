// The heart in the music players: adds the song to Liked music or takes it out (the same
// playlist as the heart in the Android app). Shows the change at once and undoes it on failure.
import { useState } from "react";
import { Heart } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PLAYLISTS_KEY, canAddToPlaylist, useLikedIds } from "./playlists";

const withLiked = (lists, fileId, liked) => lists?.map((p) => (p.isLiked
    ? { ...p, fileIds: liked ? [fileId, ...p.fileIds.filter((id) => id !== fileId)] : p.fileIds.filter((id) => id !== fileId), count: p.count + (liked ? 1 : -1) }
    : p));

export const LikeButton = ({ item, className, iconClassName = "w-4 h-4" }) => {
    const queryClient = useQueryClient();
    const likedIds = useLikedIds();
    const [pop, setPop] = useState(0);
    if (!canAddToPlaylist(item)) return null;
    const liked = likedIds.has(item.id);
    const toggle = async () => {
        const before = queryClient.getQueryData(PLAYLISTS_KEY);
        queryClient.setQueryData(PLAYLISTS_KEY, withLiked(before, item.id, !liked));
        if (!liked) setPop((n) => n + 1);
        try {
            await api.setLiked(item.id, !liked);
        }
        catch (e) {
            queryClient.setQueryData(PLAYLISTS_KEY, before);
            toast.error(e.message);
        }
        queryClient.invalidateQueries({ queryKey: PLAYLISTS_KEY });
    };
    return (<button type="button" onClick={toggle} className={className} aria-pressed={liked} aria-label={liked ? "Remove from Liked music" : "Add to Liked music"} title={liked ? "Remove from Liked music" : "Add to Liked music"}>
      <Heart key={pop} className={cn(iconClassName, liked && "fill-pink-500 text-pink-500 motion-safe:animate-select-pop")}/>
    </button>);
};
