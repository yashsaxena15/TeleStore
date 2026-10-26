package com.backendforge.telestore.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Keeps the video player alive outside its screen, so pulling the video down shrinks it to a mini
 * player above the tabs (as YouTube does) instead of ending it. [close] ends it.
 */
class VideoHost(private val container: AppContainer) {
    private val store = ViewModelStore()
    private val _player = MutableStateFlow<VideoViewModel?>(null)
    val player: StateFlow<VideoViewModel?> = _player.asStateFlow()

    /** Plays [queue] from [index]: in the open player, or a new one. */
    fun open(queue: List<FileItem>, index: Int) {
        container.playback.openVideos(queue, index)
        val current = _player.value
        if (current != null) {
            current.start(queue, index)
            return
        }
        _player.value = ViewModelProvider(store, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = VideoViewModel(container) as T
        })[VideoViewModel::class.java]
    }

    /** Stops the video and lets the player go. */
    fun close() {
        _player.value = null
        store.clear()
    }
}
