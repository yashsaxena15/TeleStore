package com.backendforge.telestore.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.FileCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Share a file to another app, or open it in one: fetches it first, showing progress. */
class OpenElsewhere internal constructor(
    private val container: AppContainer,
    private val context: Context,
    private val scope: CoroutineScope,
) {
    internal var fetching by mutableStateOf<FileItem?>(null)
    internal var progress by mutableFloatStateOf(0f)
    internal var error by mutableStateOf<String?>(null)
    private var job: Job? = null

    fun share(item: FileItem) = fetchThen(item) { FileCache.shareIntent(it, "Share ${item.name}") }
    fun openWith(item: FileItem) = fetchThen(item) { FileCache.viewIntent(it, "Open ${item.name} with") }

    /**
     * Shares several photos at once: [phone] are sent as they are, [server] are fetched first (with
     * the same progress dialog, one by one). [mime] is the shared type: images, videos, or anything.
     */
    fun shareMany(phone: List<android.net.Uri>, server: List<FileItem>, mime: String) {
        job?.cancel()
        error = null
        job = scope.launch {
            val uris = ArrayList<android.net.Uri>(phone)
            try {
                for (item in server) {
                    fetching = item
                    progress = 0f
                    uris += container.files.fetch(item) { progress = it }.uri
                }
                fetching = null
                if (uris.isEmpty()) return@launch
                val send = if (uris.size == 1) {
                    android.content.Intent(android.content.Intent.ACTION_SEND).putExtra(android.content.Intent.EXTRA_STREAM, uris[0])
                } else {
                    android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, uris)
                }
                send.setType(mime).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try {
                    context.startActivity(android.content.Intent.createChooser(send, if (uris.size == 1) "Share" else "Share ${uris.size} items"))
                } catch (e: ActivityNotFoundException) {
                    error = "No app on this phone can share these."
                }
            } catch (e: CancellationException) {
                fetching = null
                throw e
            } catch (e: Exception) {
                fetching = null
                error = (e as? ApiException)?.message ?: "Couldn't get the photos to share."
            }
        }
    }

    private fun fetchThen(item: FileItem, intent: (com.backendforge.telestore.data.LocalFile) -> android.content.Intent) {
        job?.cancel()
        fetching = item
        progress = 0f
        error = null
        job = scope.launch {
            try {
                val file = container.files.fetch(item) { progress = it }
                fetching = null
                try {
                    context.startActivity(intent(file))
                } catch (e: ActivityNotFoundException) {
                    error = "No app on this phone can open ${item.name}."
                }
            } catch (e: CancellationException) {
                fetching = null
                throw e
            } catch (e: Exception) {
                fetching = null
                error = (e as? ApiException)?.message ?: "Couldn't get ${item.name}."
            }
        }
    }

    internal fun cancel() {
        job?.cancel()
        fetching = null
    }
}

@Composable
fun rememberOpenElsewhere(container: AppContainer): OpenElsewhere {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val opener = remember(container) { OpenElsewhere(container, context, scope) }
    OpenElsewhereDialogs(opener)
    return opener
}

@Composable
private fun OpenElsewhereDialogs(opener: OpenElsewhere) {
    opener.fetching?.let { item ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Getting the file") },
            text = {
                Column {
                    Text(
                        "${item.name}${item.size?.let { " · ${formatBytes(it)}" } ?: ""}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    ProgressBar(progress = { opener.progress }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = opener::cancel) { Text("Cancel") } },
        )
    }
    opener.error?.let { message ->
        AlertDialog(
            onDismissRequest = { opener.error = null },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { opener.error = null }) { Text("OK") } },
        )
    }
}
