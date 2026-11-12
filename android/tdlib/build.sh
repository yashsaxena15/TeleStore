#!/usr/bin/env bash
# Builds TDLib (Telegram's official client library) for Android from Telegram's own source, at the
# commit in VERSION, for arm64-v8a only, with the Java interface. Output (git-ignored):
#   out/tdlib.jar                        org.drinkless.tdlib.Client and TdApi, compiled
#   out/jniLibs/arm64-v8a/libtdjni.so    the native library
# CI runs it once per VERSION and caches out/ (see .github/workflows/android.yml). It takes about
# 30-60 minutes. Needs: Android SDK (ANDROID_HOME), JDK 17, gperf, php, perl, git.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd)
COMMIT=$(cat VERSION)
NDK=${TDLIB_NDK:-27.2.12479018}
SDK=${ANDROID_HOME:?ANDROID_HOME must point to the Android SDK}
ABI=arm64-v8a
API=26  # the app's minSdk

echo "== SDK parts: NDK $NDK, CMake 3.22.1, android-34"
SDKMANAGER=$(ls "$SDK"/cmdline-tools/*/bin/sdkmanager | head -1)
yes | "$SDKMANAGER" --licenses >/dev/null || true
"$SDKMANAGER" --install "ndk;$NDK" "cmake;3.22.1" "platforms;android-34" >/dev/null

echo "== TDLib source at $COMMIT"
rm -rf td
git init -q td
git -C td fetch -q --depth 1 https://github.com/tdlib/td.git "$COMMIT"
git -C td checkout -q FETCH_HEAD
cd td/example/android

# arm64 only (the scripts build four kinds of processor by default), and 16 KB memory pages (Android 15)
sed -i 's/for ABI in arm64-v8a armeabi-v7a x86_64 x86 ;/for ABI in arm64-v8a ;/' build-openssl.sh
sed -i 's/-DTD_ENABLE_PCH:BOOL=ON/-DTD_ENABLE_PCH:BOOL=ON -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON/' build-tdlib.sh
grep -q "for ABI in arm64-v8a ;" build-openssl.sh

echo "== OpenSSL"
./build-openssl.sh "$SDK" "$NDK" third-party/openssl
echo "== TDLib"
./build-tdlib.sh "$SDK" "$NDK" third-party/openssl c++_static Java "$API" "$ABI"

echo "== Packing"
rm -rf "$HERE/out" && mkdir -p "$HERE/out/jniLibs/$ABI" "$HERE/out/classes"
cp tdlib/libs/$ABI/libtdjni.so "$HERE/out/jniLibs/$ABI/"
curl -sfL -o annotation.jar https://maven.google.com/androidx/annotation/annotation/1.4.0/annotation-1.4.0.jar
javac --release 11 -nowarn -encoding UTF-8 -cp "$SDK/platforms/android-34/android.jar:annotation.jar" \
  -d "$HERE/out/classes" tdlib/java/org/drinkless/tdlib/*.java
jar cf "$HERE/out/tdlib.jar" -C "$HERE/out/classes" .
rm -rf "$HERE/out/classes"
echo "$COMMIT" > "$HERE/out/VERSION"
ls -la "$HERE/out" "$HERE/out/jniLibs/$ABI"
echo "== Done"
