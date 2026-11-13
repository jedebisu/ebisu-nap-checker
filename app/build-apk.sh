#!/bin/bash

# Build a signed, versioned G-MAPS release APK.
# Usage: ./build-apk.sh v1.0
# - syncs app version + Android versionCode in app.json
#   (versionCode is only bumped when the version changes, so rebuilding the
#   same release keeps its versionCode)
# - regenerates the native android/ project (expo prebuild)
# - injects the release signing config (idempotently) into
#   android/app/build.gradle using the credentials from keystore/.env
# - builds the release APK
# - archives it as apk/G-MAPS-<version>.apk and apk/G-MAPS-latest.apk
#
# One-time setup: see keystore/README.md (keystore + keystore/.env, gitignored).

set -e

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    echo "Usage: ./build-apk.sh v1.0"
    exit 1
fi

VERSION_NAME="${VERSION/v/}"      # v1.0 -> 1.0
VERSION_FULL="${VERSION_NAME}.0"  # 1.0  -> 1.0.0

echo "Building $VERSION (app version $VERSION_FULL)"

export ANDROID_HOME=~/Library/Android/sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

cd "$(dirname "$0")"

# --- Load keystore credentials (gitignored) -------------------------------
if [ ! -f keystore/.env ]; then
    echo "ERROR: keystore/.env not found. See keystore/README.md."
    exit 1
fi
set -a
. keystore/.env
set +a
: "${KEYSTORE_PASSWORD:?missing KEYSTORE_PASSWORD in keystore/.env}"
: "${KEY_PASSWORD:?missing KEY_PASSWORD in keystore/.env}"
: "${KEY_ALIAS:?missing KEY_ALIAS in keystore/.env}"
KEYSTORE_PATH="$(pwd)/keystore/gmaps-release.keystore"
if [ ! -f "$KEYSTORE_PATH" ]; then
    echo "ERROR: $KEYSTORE_PATH not found. See keystore/README.md."
    exit 1
fi
export KEYSTORE_PATH KEYSTORE_PASSWORD KEY_ALIAS KEY_PASSWORD

# --- Sync version in app.json ---------------------------------------------
node -e "
const fs = require('fs');
const p = 'app.json';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
cfg.expo.android = cfg.expo.android || {};
const currentCode = cfg.expo.android.versionCode || 1;
if (cfg.expo.version === '$VERSION_FULL') {
  console.log('Version unchanged (' + cfg.expo.version + ', versionCode ' + currentCode + ')');
} else {
  cfg.expo.version = '$VERSION_FULL';
  cfg.expo.android.versionCode = currentCode + 1;
  console.log('Bumped to version ' + cfg.expo.version + ' (versionCode ' + cfg.expo.android.versionCode + ')');
}
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
"

# --- Regenerate native project so versionName/versionCode take effect -----
npx expo prebuild -p android

# --- Inject release signing config (idempotent) ---------------------------
# expo prebuild owns android/app/build.gradle, so the signing block is
# (re)applied after every prebuild instead of relying on manual edits.
node -e "
const fs = require('fs');
const p = 'android/app/build.gradle';
let s = fs.readFileSync(p, 'utf8');

// Drop any previous injection first so this is re-runnable.
s = s.replace(/\n?[ \t]*\/\/ GMAPS_RELEASE_SIGNING_START[\s\S]*?\/\/ GMAPS_RELEASE_SIGNING_END\n?/g, '\n');

const releaseCfg = [
  '        // GMAPS_RELEASE_SIGNING_START',
  '        release {',
  '            storeFile file(\"' + process.env.KEYSTORE_PATH + '\")',
  '            storePassword System.getenv(\"KEYSTORE_PASSWORD\")',
  '            keyAlias System.getenv(\"KEY_ALIAS\")',
  '            keyPassword System.getenv(\"KEY_PASSWORD\")',
  '        }',
  '        // GMAPS_RELEASE_SIGNING_END',
].join('\n');

if (/signingConfigs\s*\{/.test(s)) {
  s = s.replace(/signingConfigs\s*\{/, 'signingConfigs {\n' + releaseCfg);
} else if (s.indexOf('android {') !== -1) {
  const i = s.indexOf('android {') + 'android {'.length;
  s = s.slice(0, i) + '\n    signingConfigs {\n' + releaseCfg + '\n    }' + s.slice(i);
} else {
  console.error('ERROR: could not locate android { or signingConfigs { in ' + p);
  process.exit(1);
}

// Point the release buildType at the release signing config.
const bt = s.indexOf('buildTypes');
const rel = s.indexOf('release', bt === -1 ? 0 : bt);
if (rel === -1) {
  console.error('ERROR: could not locate release buildType in ' + p);
  process.exit(1);
}
const open = s.indexOf('{', rel);
const close = s.indexOf('}', open);
let body = s.slice(open + 1, close);
if (/signingConfig\s+signingConfigs\.\w+/.test(body)) {
  body = body.replace(/signingConfig\s+signingConfigs\.\w+/, 'signingConfig signingConfigs.release');
} else {
  body = '\n            signingConfig signingConfigs.release' + body;
}
s = s.slice(0, open + 1) + body + s.slice(close);

fs.writeFileSync(p, s);
console.log('Release signing config applied to ' + p);
"

# --- Build ------------------------------------------------------------------
cd android
./gradlew assembleRelease
cd ..

# --- Archive -----------------------------------------------------------------
APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
mkdir -p apk
cp "$APK_PATH" "apk/G-MAPS-$VERSION.apk"
cp "$APK_PATH" "apk/G-MAPS-latest.apk"

echo ""
echo "Build complete:"
echo "  apk/G-MAPS-$VERSION.apk"
echo "  apk/G-MAPS-latest.apk"
