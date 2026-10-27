package com.backendforge.telestore.data

import com.backendforge.telestore.core.FileItem

/**
 * What the video player and photo viewer open: the folder's videos (or photos) and where to
 * start. Set just before navigating to those screens.
 */
class PlaybackQueue {
    var videos: List<FileItem> = emptyList()
        private set
    var videoIndex: Int = 0
        private set
    var photos: List<FileItem> = emptyList()
        private set
    var photoIndex: Int = 0
        private set

    /** The document or archive being viewed. */
    var document: FileItem? = null

    fun openVideos(items: List<FileItem>, index: Int) {
        videos = items
        videoIndex = index
    }

    fun openPhotos(items: List<FileItem>, index: Int) {
        photos = items
        photoIndex = index
    }
}
