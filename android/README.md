# TeleStore for Android

A native Kotlin app for TeleStore. Same server, accounts and files as the website.

## Modules
- `core/`: plain Kotlin. The API client (`TeleStoreApi`), models, media links and file kinds.
  Builds and tests anywhere with JDK 17+: `./gradlew :core:test`.
- `app/`: the Android app (Jetpack Compose). Needs the Android SDK, so it is built by
  GitHub Actions (`.github/workflows/android.yml`); it is left out of the build when no SDK is found.

## Builds and releases
- Every push that changes `android/` runs the `:core` tests, lint and a release build. The APK is
  attached to the run.
- Merging to `main` replaces the `android-latest` pre-release with the new APK.
- A tag like `android-v1.0.0` makes a versioned release.

## Signing
Release APKs are signed with the key from four repository secrets: `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the build is
signed with a debug key, which can't update a properly signed install. Keep a backup of the key:
if it is lost, installed apps can't be updated.

## Server
The app sends `"device": "android"` when signing in, which gives a 90-day token. Files are found
by id (`file_id`) for playback, info and downloads, so only the signed-in user's files are served.
