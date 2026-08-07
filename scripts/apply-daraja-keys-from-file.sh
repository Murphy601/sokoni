#!/usr/bin/env bash
# Apply Daraja Key/Secret/Passkey from a file (portal Copy → paste).
#
# Accepted formats:
#   A) Exactly 3 lines — Key, Secret, Passkey (raw values only)
#   B) Labeled lines (portal paste), e.g.:
#        Consumer Key: Vqd6…
#        Consumer Secret: P2ht…
#        Passkey: ea9d…
#
# On the VM:
#   nano /tmp/daraja-keys.txt
#   bash scripts/apply-daraja-keys-from-file.sh /tmp/daraja-keys.txt
#   bash scripts/test-daraja-oauth.sh
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
FILE="${1:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: bash scripts/apply-daraja-keys-from-file.sh /tmp/daraja-keys.txt" >&2
  exit 1
fi

clean_val() {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# Strip common labels; return empty if the whole line was a label with no value.
strip_label() {
  local line="$1"
  line="$(clean_val "$line")"
  # Drop bare section headers
  case "$line" in
    [Cc]onsumer\ [Kk]ey:|[Cc]onsumer\ [Ss]ecret:|[Pp]ass[Kk]ey:|[Ss]hort\ [Cc]ode:|"")
      printf ''
      return
      ;;
  esac
  # "Consumer Key: VALUE" / "Passkey: VALUE"
  line="$(printf '%s' "$line" | sed -E \
    -e 's/^[Cc]onsumer[[:space:]]*[Kk]ey[[:space:]]*:[[:space:]]*//' \
    -e 's/^[Cc]onsumer[[:space:]]*[Ss]ecret[[:space:]]*:[[:space:]]*//' \
    -e 's/^[Pp]ass[Kk]ey[[:space:]]*:[[:space:]]*//' \
    -e 's/^[Ss]hort[[:space:]]*[Cc]ode[[:space:]]*:[[:space:]]*//')"
  clean_val "$line"
}

KEY="" SECRET="" PASSKEY=""
declare -a RAW=()

while IFS= read -r line || [ -n "$line" ]; do
  val="$(strip_label "$line")"
  [ -n "$val" ] || continue
  # Skip shortcode if pasted
  if [[ "$val" =~ ^[0-9]{5,8}$ ]]; then
    continue
  fi
  RAW+=("$val")
done < "$FILE"

if [ "${#RAW[@]}" -lt 3 ]; then
  echo "ERROR: need Key + Secret + Passkey in $FILE (got ${#RAW[@]} values)." >&2
  echo "  Paste either 3 raw lines, or labeled Consumer Key / Secret / Passkey lines." >&2
  exit 1
fi

KEY="${RAW[0]}"
SECRET="${RAW[1]}"
PASSKEY="${RAW[2]}"

echo "Read from $FILE:"
echo "  Key len=${#KEY}  Secret len=${#SECRET}  Passkey len=${#PASSKEY}"
echo "  Key head=${KEY:0:6}…  Secret head=${SECRET:0:6}…  Passkey head=${PASSKEY:0:6}…"
echo "  Key fingerprint (sha256…16): $(printf '%s' "$KEY" | sha256sum | cut -c1-16)"

if [ "${#KEY}" -lt 40 ] || [ "${#SECRET}" -lt 40 ] || [ "${#PASSKEY}" -lt 40 ]; then
  echo "ERROR: lengths too short — check the file has the real portal values." >&2
  exit 1
fi

# Known-bad OCR Consumer Key (l/I swapped) — Safaricom HTTP 400
if [ "$(printf '%s' "$KEY" | sha256sum | cut -c1-16)" = "24df15d590a14320" ]; then
  echo "ERROR: this Consumer Key is the OCR typo (l/I swapped)." >&2
  echo "  Correct shape starts Vqd6UhRdqIEa… and has …s2lHS9DvB (not …s2IHS9DvB)." >&2
  exit 1
fi

export MPESA_CONSUMER_KEY="$KEY"
export MPESA_CONSUMER_SECRET="$SECRET"
export MPESA_PASSKEY="$PASSKEY"
bash "$REPO/scripts/set-daraja-env.sh"
echo "==> Next: bash scripts/test-daraja-oauth.sh"
