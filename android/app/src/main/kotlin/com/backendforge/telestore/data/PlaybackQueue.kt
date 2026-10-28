package com.backendforge.telestore.data

import android.net.Uri
import com.backendforge.telestore.core.FileItem

/**
 * One photo for the viewer: the copy in TeleStore, the copy on this phone, or both (then the
 * phone's is shown: faster, and it works offline).
 */
data class PhotoSource(val item: FileItem?, val localUri: Uri?, val name: String) {
    constructor(item: FileItem) : this(item, null, item.name)
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
