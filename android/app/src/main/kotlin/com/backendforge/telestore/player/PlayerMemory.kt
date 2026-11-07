package com.backendforge.telestore.player

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl

/**
 * How much of a video or song a player keeps in memory ahead of where it plays.
 *
 * The player's own default for video is about 130 MB per player, read into the app's memory.
 * Phone videos are large (4K, high bitrate), and Android gives the app 256 MB on many phones: one or
 * two players buffering at once ran it out of memory and the app crashed (seen in Photos, Nov 2026).
 * A cap in bytes, which wins over the time targets, keeps each player to a few tens of MB; playback
 * stays smooth, it just reads less far ahead.
 */
@OptIn(UnstableApi::class)
object PlayerMemory {
    const val VIDEO_BYTES = 32 * 1024 * 1024
    const val MUSIC_BYTES = 8 * 1024 * 1024

    fun video(): LoadControl = control(VIDEO_BYTES)

    fun music(): LoadControl = control(MUSIC_BYTES)

    private fun control(bytes: Int): LoadControl = DefaultLoadControl.Builder()
        // min, max ahead; how much to start playing; how much after running dry (ms)
        .setBufferDurationsMs(15_000, 50_000, 1_000, 2_000)
        .setTargetBufferBytes(bytes)
        .setPrioritizeTimeOverSizeThresholds(false)
        .build()
}
