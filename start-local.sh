#!/bin/bash
# Starts the EBISU NAP Checker locally: backend (port 3002) + Expo dev server (port 8081).
# Run from anywhere:  ./start-local.sh
# Stop everything with: ./stop-local.sh

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"

# The phone can't reach "localhost" — it needs this Mac's Wi-Fi address.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
if [ -z "${LAN_IP:-}" ]; then
  echo "⚠️  Could not detect a Wi-Fi IP. Is Wi-Fi on?"
  LAN_IP="127.0.0.1"
fi

echo "════════════════════════════════════════════════════════"
echo "  EBISU NAP Checker"
echo "  This Mac's Wi-Fi address: $LAN_IP"
echo "════════════════════════════════════════════════════════"

# ── 1. Postgres ────────────────────────────────────────────
if ! pg_isready -q 2>/dev/null; then
  echo "▶ Starting Postgres..."
  brew services start postgresql@16 >/dev/null 2>&1 \
    || brew services start postgresql >/dev/null 2>&1 \
    || echo "  (start Postgres yourself — brew services start postgresql)"
  for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 1; done
fi
pg_isready -q 2>/dev/null && echo "✅ Postgres is up" || echo "❌ Postgres is NOT running"

# ── 2. Backend (.env is created once, then reused) ─────────
if [ ! -f "$ROOT/server/.env" ]; then
  echo "▶ Creating server/.env for the first time..."
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  cat > "$ROOT/server/.env" <<EOF
PORT=3002
DATABASE_URL=
DB_USER=${USER}
DB_HOST=localhost
DB_NAME=napcheck
DB_PASSWORD=
DB_PORT=5432
TEST_DATABASE_URL=
JWT_SECRET=$SECRET
RENDER_API_URL=https://selfie-api-sqgh.onrender.com
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
ADMIN_PASSWORD=ebisu-admin
EOF
  echo "  created. Admin page password: ebisu-admin"
fi

# ── 3. Backend process ─────────────────────────────────────
pkill -f "node src/server.js" 2>/dev/null; sleep 1
echo "▶ Starting backend on port 3002..."
( cd "$ROOT/server" && nohup npm start > /tmp/napserver.log 2>&1 & )
for _ in $(seq 1 25); do
  curl -s --max-time 2 http://localhost:3002/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl -s --max-time 3 http://localhost:3002/api/health | grep -q '"ok"' \
  && echo "✅ Backend: http://localhost:3002/api/health" \
  || { echo "❌ Backend failed — see /tmp/napserver.log"; tail -5 /tmp/napserver.log; }

# ── 4. Expo dev server ─────────────────────────────────────
pkill -f "expo start" 2>/dev/null; sleep 1
echo "▶ Starting Expo (Metro) on port 8081..."
( cd "$ROOT/mobile" \
  && nohup env EXPO_PUBLIC_API_URL="http://$LAN_IP:3002/api" BROWSER=none npx expo start \
     > /tmp/expo-start.log 2>&1 < /dev/null & )
for _ in $(seq 1 60); do
  grep -q "Waiting on http://localhost:8081" /tmp/expo-start.log 2>/dev/null && break
  sleep 1
done
curl -s -o /dev/null --max-time 10 http://localhost:8081 \
  && echo "✅ Expo:    http://localhost:8081" \
  || { echo "❌ Expo failed — see /tmp/expo-start.log"; tail -5 /tmp/expo-start.log; }

# ── 5. Instructions ────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────
  HOW TO OPEN THE APP
────────────────────────────────────────────────────────

  On your PHONE (this is the real app):
    1. Install "Expo Go" from the App Store / Play Store
    2. Same Wi-Fi as this Mac
    3. In Expo Go, tap "Enter URL manually" and type:

         exp://$LAN_IP:8081

  On this MAC (browser):
    http://localhost:8081     -> Expo developer page
    http://localhost:3002/admin -> generate invite codes (password: ebisu-admin)
    http://localhost:3002/api/health -> should say {"status":"ok"}

  To stop everything: ./stop-local.sh
EOF
