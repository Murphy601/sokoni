#!/usr/bin/env bash
# Apply Daraja Key/Secret/Passkey from a 3-line file (portal Copy → paste).
#
# Why: typing or re-using chat/OCR strings often produces HTTP 400 even when
# lengths look right (48/64/64). The portal Copy buttons are the source of truth.
#
# On the VM:
#   1) Open developer.safaricom.co.ke → Apps → Prod-SOKONIMALL-… → Keys
#   2) Click Copy on Consumer Key, paste as line 1
#   3) Click Copy on Consumer Secret, paste as line 2
#   4) Click Copy on Passkey, paste as line 3
#
#   nano /tmp/daraja-keys.txt    # or: cat > /tmp/daraja-keys.txt
#   bash scripts/apply-daraja-keys-from-file.sh /tmp/daraja-keys.txt
#   bash scripts/test-daraja-oauth.sh
#   shred -u /tmp/daraja-keys.txt   # optional cleanup
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
FILE="${1:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: bash scripts/apply-daraja-keys-from-file.sh /tmp/daraja-keys.txt" >&2
  echo "File must be exactly 3 lines: Consumer Key, Consumer Secret, Passkey" >&2
  exit 1
fi

# Read first three non-empty lines; strip CR/space/quotes only.
mapfile -t LINES < <(grep -v '^[[:space:]]*$' "$FILE" | head -3)
if [ "${#LINES[@]}" -lt 3 ]; then
  echo "ERROR: need 3 non-empty lines (key, secret, passkey); got ${#LINES[@]}" >&2
  exit 1
fi

clean() {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//'
}

KEY="$(clean "${LINES[0]}")"
SECRET="$(clean "${LINES[1]}")"
PASSKEY="$(clean "${LINES[2]}")"

echo "Read from $FILE:"
echo "  Key len=${#KEY}  Secret len=${#SECRET}  Passkey len=${#PASSKEY}"
echo "  Key head=${KEY:0:6}…  Secret head=${SECRET:0:6}…  Passkey head=${PASSKEY:0:6}…"

if [ "${#KEY}" -lt 40 ] || [ "${#SECRET}" -lt 40 ] || [ "${#PASSKEY}" -lt 40 ]; then
  echo "ERROR: lengths too short — use portal Copy buttons, not instruction text." >&2
  exit 1
fi

case "$KEY" in
  paste-*|Vqd6…*|*"…"*) echo "ERROR: Key still looks like a placeholder." >&2; exit 1 ;;
esac

export MPESA_CONSUMER_KEY="$KEY"
export MPESA_CONSUMER_SECRET="$SECRET"
export MPESA_PASSKEY="$PASSKEY"
bash "$REPO/scripts/set-daraja-env.sh"
echo "==> Next: bash scripts/test-daraja-oauth.sh"
