# G-MAPS Release Keystore

`gmaps-release.keystore` signs the G-MAPS Android release APK (`com.gmaps.demo`).
Alias: `gmaps` (RSA 2048, validity 10000 days).

## ⚠️ BACK THIS FILE UP ⚠️

**Back this file up somewhere safe (password manager, offline drive, etc.).**
Losing it **forfeits update-in-place for `com.gmaps.demo`** — Android will refuse
to install any future build signed with a different key over an existing install,
and users would have to uninstall and lose app data to update.

The same goes for the passwords in `.env` (gitignored): without them the keystore
is unusable.

## What lives here

| File | Committed? | Purpose |
|------|-----------|---------|
| `gmaps-release.keystore` | NO (gitignored) | Release signing key |
| `.env` | NO (gitignored) | `KEYSTORE_PASSWORD` / `KEY_PASSWORD` / `KEY_ALIAS` used by `build-apk.sh` |
| `README.md` | YES | This file |

## Notes

- Created once (one-time). Regenerating a keystore means shipping a new signing
  identity and breaking update-in-place.
- Passwords are generated randomly (`openssl rand -base64 24`). Do not commit,
  paste into chat, or share the `.env` contents.
