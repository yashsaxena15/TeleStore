package com.backendforge.telestore.telegram

/** TDLib numbers a chat's messages as the server's message id × 2^20; TeleStore keeps the server's. */
object TgIds {
    fun toTdlib(serverId: Long): Long = serverId shl 20
    fun toServer(tdlibId: Long): Long = tdlibId shr 20
}
