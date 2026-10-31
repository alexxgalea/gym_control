#!/usr/bin/env bash
# PROTOTIP (ramura prototype/ecran-usa-si-meniu): pornește aplicația cu o bază de test și date demo, ca să vezi
# variantele în browser. Cere uv și Node 22+. Pe telefon, din aceeași rețea Wi-Fi:
#   HOST=0.0.0.0 SUBNET=192.168.0.0/24 scripts/prototip.sh
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
SUBNET="${SUBNET:-}" # gol = doar de pe laptop (127.0.0.0/8)
DB="${TMPDIR:-/tmp}/gymctrl-prototip.db"
rm -f "$DB"

echo "→ build frontend"
(cd frontend && npm ci --no-audit --no-fund && npm run build)

echo "→ pornesc serverul pe http://$HOST:$PORT"
GYM_DATABASE="$DB" GYM_SCHEDULER=0 GYM_ADMIN_USER=admin GYM_ADMIN_PASSWORD=parola-de-test \
  GYM_FRONTEND_DIST=frontend/dist GYM_HALL_SUBNET=127.0.0.0/8 GYM_OPENING_TIME=00:00 GYM_CLOSING_TIME=23:59 \
  uv run uvicorn gym_control.app:app_from_env --factory --host "$HOST" --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/status" && break
  sleep 1
done

echo "→ date de test"
SEED_OUT="$(uv run python docs/prototype/ecran-usa-si-meniu/seed.py "$DB" "${TMPDIR:-/tmp}/gymctrl-prototip-cookies.json" "$SUBNET")"
echo "$SEED_OUT" | grep -v '^LINK_USA='
DOOR_LINK="$(echo "$SEED_OUT" | sed -n 's/^LINK_USA=//p' | sed "s#^http://[^/]*#http://localhost:$PORT#")"

cat <<MSG

Gata. Cont Admin: admin / parola-de-test
  Admin:  http://localhost:$PORT/admin/?variant=A     (variante: A, B, C; 0 = actual)
  Ușa:    1) deschide o singură dată linkul de Activare și apasă butonul de confirmare:
             $DOOR_LINK
          2) apoi http://localhost:$PORT/door?variant=A
          (alt link: Admin → Mai mult → Ecranul de la ușă → Activează → Copiază linkul)
Schimbi varianta din bara roz sau cu săgețile ← → de pe tastatură. Ctrl+C oprește serverul.
MSG
wait $SERVER
