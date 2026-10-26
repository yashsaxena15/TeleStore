package com.backendforge.telestore.player

import android.content.Intent
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/** The session of the video playing now (made by [VideoViewModel], which owns the player). */
object VideoSessions {
    var current: MediaSession? = null
}

/**
 * Keeps a video's sound going when the app is left or the screen turns off ("Play in
 * background"), with the usual media notification and lock-screen controls. The player itself
 * belongs to the video screen; this service only hosts its session while it plays.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class VideoSessionService : MediaSessionService() {
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = VideoSessions.current

    /** Swiping the app away ends the video, as YouTube does. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        VideoSessions.current?.player?.pause()
        stopSelf()
    }
}
