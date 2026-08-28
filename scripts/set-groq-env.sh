#!/usr/bin/env bash
# Write GROQ_API_KEY into whatsapp-bot/.env on the bot VM (never commits secrets).
#
# Usage (on GCP VM after SSH):
#   export GROQ_API_KEY='gsk_…'   # from console.groq.com
#   bash scripts/set-groq-env.sh
#
# Or during deploy:
#   export SOKONI_GROQ_API_KEY='gsk_…'
#   bash scripts/deploy-bot.sh
#
# OpenRouter (OPENAI_*) stays as free fallback — already on the VM.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

clean_cred() {
  printf '%s' "$1" | tr -d '[:space:]' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

env_get() {
  local key="$1"
  local line=""
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
  printf '%s' "$line" | sed -E "s/^[[:space:]]*(export[[:space:]]+)?${key}=//" | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

set_env_kv() {
  local key="$1" val="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i -E "s|^[[:space:]]*(export[[:space:]]+)?${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

FROM_EXPORT="$(clean_cred "${GROQ_API_KEY:-${SOKONI_GROQ_API_KEY:-}}")"
FROM_FILE="$(clean_cred "$(env_get GROQ_API_KEY)")"

PICKED=""
if [ -n "$FROM_EXPORT" ] && [ "${#FROM_EXPORT}" -ge 20 ]; then
  PICKED="$FROM_EXPORT"
elif [ -n "$FROM_FILE" ] && [ "${#FROM_FILE}" -ge 20 ]; then
  PICKED="$FROM_FILE"
  echo "==> Keeping existing GROQ_API_KEY (${#PICKED} chars)"
else
  echo "ERROR: GROQ_API_KEY missing." >&2
  echo "  export GROQ_API_KEY='gsk_…'   # from https://console.groq.com" >&2
  echo "  bash scripts/set-groq-env.sh" >&2
  exit 1
fi

if [[ ! "$PICKED" =~ ^gsk_ ]]; then
  echo "WARN: Groq keys usually start with gsk_ — continuing anyway (len=${#PICKED})"
fi

# llama-3.1-8b-instant retired Aug 2026 — migrate stale pin to gpt-oss-20b
DEFAULT_GROQ_MODEL="openai/gpt-oss-20b"
CURRENT_MODEL="$(clean_cred "$(env_get GROQ_MODEL)")"
if [ -n "${GROQ_MODEL:-}" ]; then
  PICKED_MODEL="$(clean_cred "$GROQ_MODEL")"
elif [ -z "$CURRENT_MODEL" ] || [ "$CURRENT_MODEL" = "llama-3.1-8b-instant" ] || [ "$CURRENT_MODEL" = "llama-3.3-70b-versatile" ]; then
  PICKED_MODEL="$DEFAULT_GROQ_MODEL"
else
  PICKED_MODEL="$CURRENT_MODEL"
fi

set_env_kv "GROQ_API_KEY" "$PICKED"
set_env_kv "GROQ_MODEL" "$PICKED_MODEL"
set_env_kv "AI_CHAT_PROVIDER" "${AI_CHAT_PROVIDER:-auto}"
set_env_kv "AI_CHAT_TEMPERATURE" "${AI_CHAT_TEMPERATURE:-0.15}"
# Vision GEMINI_API_KEY must not drive chat failover (400 noise) unless opted in
if [ -n "${AI_CHAT_USE_GEMINI:-}" ]; then
  set_env_kv "AI_CHAT_USE_GEMINI" "$(clean_cred "$AI_CHAT_USE_GEMINI")"
else
  set_env_kv "AI_CHAT_USE_GEMINI" "false"
fi

# OpenRouter free fallback — migrate flaky gemma-4-26b a4b pin (429 under load)
CURRENT_OR_FB="$(clean_cred "$(env_get OPENAI_MODEL_FALLBACKS)")"
if [ -z "$CURRENT_OR_FB" ] || echo "$CURRENT_OR_FB" | grep -qE 'gemma-4-26b-a4b-it:free|llama-3\.3-70b-instruct:free'; then
  set_env_kv "OPENAI_MODEL_FALLBACKS" "${OPENAI_MODEL_FALLBACKS:-google/gemma-4-31b-it:free}"
fi
CURRENT_OR_MODEL="$(clean_cred "$(env_get OPENAI_MODEL)")"
if [ -z "$CURRENT_OR_MODEL" ] || [ "$CURRENT_OR_MODEL" = "llama-3.1-8b-instant" ]; then
  set_env_kv "OPENAI_MODEL" "${OPENAI_MODEL:-openrouter/free}"
fi

echo "==> Wrote GROQ_API_KEY (${#PICKED} chars) + GROQ_MODEL=$PICKED_MODEL + AI_CHAT_* to $ENV_FILE"
echo "==> Chat route: Groq → OpenRouter (Gemini chat only if AI_CHAT_USE_GEMINI=true)"
echo "==> tool_choice=none on Groq (lookups are server-side — do not use tool_choice=auto)"

if [ "${SKIP_RESTART:-}" = "1" ]; then
  echo "==> SKIP_RESTART=1 — not restarting pm2"
  exit 0
fi

if command -v pm2 >/dev/null 2>&1 && pm2 describe sokoni-bot >/dev/null 2>&1; then
  # Clear shell overrides so pm2 loads from .env
  unset GROQ_API_KEY SOKONI_GROQ_API_KEY 2>/dev/null || true
  echo "==> Restarting sokoni-bot --update-env"
  pm2 restart sokoni-bot --update-env
  pm2 save 2>/dev/null || true
  # Old llama/Gemini lines in the buffer look like a live fail — flush them.
  pm2 flush sokoni-bot >/dev/null 2>&1 || pm2 flush >/dev/null 2>&1 || true
  echo "==> Flushed pm2 logs (ignore any llama-3.1 / Gemini lines from before restart)"
  sleep 2
  if [ -x "$REPO/scripts/verify-ai-chat.sh" ] || [ -f "$REPO/scripts/verify-ai-chat.sh" ]; then
    echo "==> Live verify (meta + escrow chat)"
    bash "$REPO/scripts/verify-ai-chat.sh" || echo "WARN: verify-ai-chat.sh reported issues — check pm2 logs"
  else
    echo "==> Quick meta check:"
    curl -fsS --max-time 8 "http://127.0.0.1:3001/api/agent/meta" 2>/dev/null | head -c 600 || true
    echo
  fi
else
  echo "==> pm2 / sokoni-bot not found — restart manually after deploy"
fi
