package com.backendforge.telestore.photos

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import com.backendforge.telestore.backup.PhoneMedia
import com.backendforge.telestore.core.PhotoHeadings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * The places under a day's heading ("Gandhinagar, Ahmedabad"): a few of the day's phone photos
 * are read for where they were taken, and the phone's geocoder names those spots. Names are kept
 * in a small file by rounded position (about 1 km), so each spot is looked up once, ever.
 */
class DayPlaces(private val context: Context) {
    private val file = File(context.filesDir, "photos/places.json")
    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Mutex()
    private var names: MutableMap<String, String>? = null

    /** The day's places, or "" when none of the photos tried says where it was taken. */
    suspend fun forDay(photoUris: List<String>): String = withContext(Dispatchers.IO) {
        if (photoUris.isEmpty() || !PhoneMedia.canReadLocation(context)) return@withContext ""
        // Up to 6 photos spread over the day, in timeline order
        val step = (photoUris.size / 6).coerceAtLeast(1)
        val sample = photoUris.filterIndexed { i, _ -> i % step == 0 }.take(6)
        val spots = sample.mapNotNull { latLong(Uri.parse(it)) }.map { (lat, lon) -> key(lat, lon) to (lat to lon) }.distinctBy { it.first }
        PhotoHeadings.places(spots.map { (key, at) -> name(key, at.first, at.second) })
    }

    private fun latLong(uri: Uri): Pair<Double, Double>? = runCatching {
        PhoneMedia.openPhoto(context, uri)?.use { ExifInterface(it).latLong }
    }.getOrNull()?.takeIf { it.size == 2 && !(it[0] == 0.0 && it[1] == 0.0) }?.let { it[0] to it[1] }

    private fun key(lat: Double, lon: Double) = String.format(Locale.US, "%.2f,%.2f", lat, lon)

    private suspend fun name(key: String, lat: Double, lon: Double): String? {
        lock.withLock { known()[key] }?.let { return it.ifEmpty { null } }
        if (!Geocoder.isPresent()) return null
        // No answer (offline) isn't remembered, so it's asked again later
        val address = geocode(lat, lon) ?: return null
        val found = address.locality ?: address.subAdminArea ?: address.adminArea ?: ""
        lock.withLock {
            known()[key] = found
            runCatching {
                file.parentFile?.mkdirs()
                file.writeText(json.encodeToString(names!!.toMap()))
            }
        }
        return found.ifEmpty { null }
    }

    private fun known(): MutableMap<String, String> = names ?: runCatching {
        json.decodeFromString<Map<String, String>>(file.readText()).toMutableMap()
    }.getOrElse { mutableMapOf() }.also { names = it }

    @Suppress("DEPRECATION")
    private suspend fun geocode(lat: Double, lon: Double): Address? {
        val geocoder = Geocoder(context, Locale.getDefault())
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            suspendCancellableCoroutine { cont ->
                geocoder.getFromLocation(lat, lon, 1, object : Geocoder.GeocodeListener {
                    override fun onGeocode(addresses: MutableList<Address>) { if (cont.isActive) cont.resume(addresses.firstOrNull()) }
                    override fun onError(errorMessage: String?) { if (cont.isActive) cont.resume(null) }
                })
            }
        } else {
            runCatching { geocoder.getFromLocation(lat, lon, 1)?.firstOrNull() }.getOrNull()
        }
    }
}
