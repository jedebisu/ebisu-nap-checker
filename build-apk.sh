#!/bin/bash
# Builds a release APK for the EBISU NAP Checker.
#
#   ./build-apk.sh                      # uses the production URL in src/services/api.js
#   API_URL=http://1.2.3.4:3002/api ./build-apk.sh   # override (LAN testing)
#
# Output: mobile/android/app/build/outputs/apk/release/app-release.apk
#         plus a copy in dist/ with a readable name.
#
# Notes:
# - Release builds sign with the generated debug keystore. That is fine for
#   sideloading and internal testing. A Play Store release needs its own keystore
#   (see https://reactnative.dev/docs/signed-apk-android).
# - EXPO_PUBLIC_API_URL is inlined at build time, so changing the server address
#   requires a rebuild, not just a reinstall.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/mobile"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "❌ JDK 17 not found at $JAVA_HOME"
  echo "   Install it with: brew install openjdk@17"
  exit 1
fi
if [ ! -d "$ANDROID_HOME" ]; then
  echo "❌ Android SDK not found at $ANDROID_HOME"
  exit 1
fi

# Keep the native project in sync with app.json (icons, name, permissions,
# google maps key). Safe to re-run; it regenerates android/ from the config.
if [ ! -d android ]; then
  echo "▶ Generating android/ from app.json..."
  npx expo prebuild -p android --no-install
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties
fi

# android/ is generated and gitignored, so a version bump in app.json does not
# reach the Gradle config on its own. Copy it across or two different APKs end
# up with the same versionCode and the phone cannot tell them apart.
VERSION_CODE="$(python3 -c "import json;d=json.load(open('app.json'))['expo']['android'];print(d.get('versionCode',1))")"
VERSION_NAME="$(python3 -c "import json;print(json.load(open('app.json'))['expo']['version'])")"
sed -i '' -E "s/versionCode [0-9]+/versionCode $VERSION_CODE/" android/app/build.gradle
sed -i '' -E "s/versionName \"[^\"]*\"/versionName \"$VERSION_NAME\"/" android/app/build.gradle
echo "▶ versionCode $VERSION_CODE (version $VERSION_NAME)"

# Gradle treats a changed JS bundle as up-to-date if only the env var moved,
# so drop the generated bundle to force a rebuild with the new API URL.
rm -rf android/app/build/generated/assets/createBundleReleaseJsAndAssets

# A React hook called at file top level (outside a component) crashes release
# builds on launch with a silent "Property 'x' doesn't exist" and no error on
# screen: React Native turns the uncaught JS error into a process abort. Catch
# it here instead of on the owner's phone.
HOOK_AT_MODULE_SCOPE="$(grep -rnE "^(const|let|var) [A-Za-z_$]+ = (useCallback|useMemo|useState|useEffect|useRef)\(" src/ App.js || true)"
if [ -n "$HOOK_AT_MODULE_SCOPE" ]; then
  echo "❌ React hook called at module scope — the app will crash on launch:"
  echo "$HOOK_AT_MODULE_SCOPE"
  exit 1
fi

echo "▶ Building release APK (API URL: ${API_URL:-from api.js})..."
( cd android && ./gradlew :app:assembleRelease )

APK="android/app/build/outputs/apk/release/app-release.apk"
VERSION="$(python3 -c "import json;d=json.load(open('app.json'))['expo'];print(d['version'])")"
CODE="$(python3 -c "import json;d=json.load(open('app.json'))['expo']['android'];print(d.get('versionCode',1))")"

mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/EBISU-NAP-Checker-v${VERSION}-${CODE}.apk"
cp "$APK" "$OUT"

echo ""
echo "✅ Built $OUT"
ls -lh "$OUT"
echo ""
echo "Install by serving it to the phone:"
echo "  cd \"$ROOT/dist\" && python3 -m http.server 3003 --bind 0.0.0.0"
echo "  phone: http://$(ipconfig getifaddr en0 2>/dev/null || echo '<mac-ip>'):3003/$(basename "$OUT")"
