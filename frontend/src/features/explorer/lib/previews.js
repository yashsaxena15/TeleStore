// Which picture a file shows: its Telegram thumbnail, else a preview the server makes from the
// original (HEIC, big photos, videos sent as documents), else its type icon.

/** True when the server can make a preview for this item (a photo or video in TeleStore). */
export const canPreview = (item) => Boolean(item && item.type !== "folder" && item.id && !item.is_cloud &&
    (item.fileType === "photo" || item.fileType === "video"));
/** Which picture to try first: the Telegram thumbnail, else a server preview, else an icon. */
export const firstStage = (item) => (item?.thumbnail ? "thumb" : canPreview(item) ? "preview" : "none");
