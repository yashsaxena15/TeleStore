# Releasing the Android app

## Two channels
- **Beta:** every merge to `main` replaces the `android-latest` pre-release on GitHub with a new
  build (`TeleStore-1.0.<run>.apk`).
- **Stable:** pushing a tag `android-vX.Y.Z` builds a signed release that isn't a pre-release, named
  "TeleStore for Android X.Y.Z", with release notes.

The app's update check (More → About → Updates) follows **Stable** by default. **Beta** also offers
every new build.

## Before tagging a stable release
On a real phone, with the build from `android-latest`:

1. **Sign-in:** sign out, sign in with password, and with Google if it's set up.
2. **Files:**
   - browse, open a photo, PDF and text file, rename, move, star;
   - trash and restore;
   - upload a large file;
   - download a file.
3. **Photos:**
   - scroll the timeline;
   - open a photo and a video, then swipe between photos and videos for a while (the old memory
     crash);
   - check that the video plays with sound and seeks.
4. **Backup:** turn the phone backup on, take a photo, and check it's uploaded.
5. **Music:** play an album, use lock-screen controls, and Like a song.
6. **Video player:** play a long video, use quality, seek and background play.
7. **Sharing:**
   - share a folder with a second account and open it there;
   - turn on a link and open it in a browser.
8. **Private Vault:** unlock it, add a file and lock it.
9. **Offline:** keep a file and a folder offline, turn on airplane mode, and open them.
10. **Notifications:** an upload finishing and a sharing notification.
11. **About:** Check for updates, on both Stable and Beta.

Also check for new crash reports in the server log:
```
docker compose exec -T app sh -c 'grep -h "APP_CRASH" /app/cache/logs/*'
```

## Tagging
```
git switch main && git pull
git tag android-v1.1.0 && git push origin android-v1.1.0
```
The Android workflow builds and publishes the release. Phones on Stable see it at their next daily
check, or straight away with "Check for updates".
