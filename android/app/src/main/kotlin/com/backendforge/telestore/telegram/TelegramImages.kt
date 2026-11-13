package com.backendforge.telestore.telegram

import coil3.ImageLoader
import coil3.Uri
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.request.Options
import okio.Buffer

/**
 * Your own photos at full size straight from Telegram (the photo viewer, anything that shows a whole
 * file), so they don't use the TeleStore server's bandwidth. Small thumbnails and previews still come
 * from the server. A Private Vault photo comes through TeleStore (the server keeps it behind the PIN);
 * a Telegram problem shows as an error and the next try uses Telegram again.
 */
class TelegramImageFetcher(
    private val files: TelegramFiles,
    private val fileId: String,
    private val url: String,
    private val options: Options,
    private val http: () -> okhttp3.OkHttpClient,
) : Fetcher {
    override suspend fun fetch(): FetchResult {
        val bytes = try {
            files.awaitTelegram()
            val loc = files.locate(fileId)
            files.read(loc, 0, loc.size)
        } catch (e: com.backendforge.telestore.core.ApiException) {
            if (e.status != 403) throw e
            files.markVault(fileId)
            fromServer()
        }
        return SourceFetchResult(
            source = ImageSource(source = Buffer().write(bytes), fileSystem = options.fileSystem),
            mimeType = null,
            dataSource = DataSource.NETWORK,
        )
    }

    /** A Private Vault photo: from TeleStore, as before. */
    private fun fromServer(): ByteArray {
        val request = okhttp3.Request.Builder().url(url).build()
        http().newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw java.io.IOException("TeleStore answered ${resp.code}")
            return resp.body?.bytes() ?: ByteArray(0)
        }
    }

    class Factory(private val files: TelegramFiles, private val http: () -> okhttp3.OkHttpClient) : Fetcher.Factory<Uri> {
        override fun create(data: Uri, options: Options, imageLoader: ImageLoader): Fetcher? {
            val url = data.toString()
            val id = files.fileIdIn(android.net.Uri.parse(url)) ?: return null
            return TelegramImageFetcher(files, id, url, options, http)
        }
    }
}
