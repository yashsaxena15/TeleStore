package com.backendforge.telestore.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.PackageInfoCompat

/** The installed app's version name and build number (CI's run number). */
data class AppVersion(val name: String, val build: Long) {
    companion object {
        fun of(context: Context): AppVersion {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            return AppVersion(info.versionName ?: "?", PackageInfoCompat.getLongVersionCode(info))
        }
    }
}

/** Opens [url] in the browser (used for the new APK: Android then offers to install it). */
fun openInBrowser(context: Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
