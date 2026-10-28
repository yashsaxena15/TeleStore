package com.backendforge.telestore.ui.photos

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.backendforge.telestore.backup.PhoneMedia

/**
 * Asks Android for the photos and videos permission (Photos and Backup both use it). Call the
 * returned function to show the system dialog; [onResult] then gets whether TeleStore can read them.
 */
@Composable
fun rememberPhotoAccessRequest(onResult: (Boolean) -> Unit): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        onResult(PhoneMedia.canRead(context))
    }
    return { launcher.launch(PhoneMedia.permissions()) }
}
