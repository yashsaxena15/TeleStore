package com.backendforge.telestore.data

import android.net.Uri
import com.backendforge.telestore.core.FileItem

/**
 * One photo for the viewer: the copy in TeleStore, the copy on this phone, or both (then the
 * phone's is shown: faster, and it works offline).
 */
data class PhotoSource(
    val item: FileItem?,
    val localUri: Uri?,
    val name: String,
    /** When it was taken (epoch ms), for the viewer's "Nov 1" and "6:35 PM". */
    val takenAtMillis: Long? = null,
    /** Where (the day's places from Photos, or the owner's place), for the viewer's second line. */
    val place: String? = null,
    /** A video: the viewer plays it in place. */
    val video: Boolean = false,
    /** The phone copy is safely in TeleStore (so "Delete from device" may remove it). */
    val backedUp: Boolean = item != null,
) {
    constructor(item: FileItem) : this(
        item, null, item.name,
        takenAtMillis = com.backendforge.telestore.core.PhotoMerge.millisOf(item),
        place = item.place,
        video = item.kind == com.backendforge.telestore.core.FileKind.VIDEO,
    )
}

/**
 * What the video player and photo viewer open: the folder's videos (or photos) and where to
 * start. Set just before navigating to those screens.
 */
class PlaybackQueue {
    var videos: List<FileItem> = emptyList()
        private set
    var videoIndex: Int = 0
        private set
    var photos: List<PhotoSource> = emptyList()
        private set
    var photoIndex: Int = 0
        private set

    /** The document or archive being viewed. */
    var document: FileItem? = null

    fun openVideos(items: List<FileItem>, index: Int) {
        videos = items
        videoIndex = index
    }

    fun openPhotos(items: List<FileItem>, index: Int) = openPhotoSources(items.map { PhotoSource(it) }, index)

    /** The Photos timeline: photos on the phone mixed with backed-up ones. */
    fun openPhotoSources(sources: List<PhotoSource>, index: Int) {
        photos = sources
        photoIndex = index
    }
}
