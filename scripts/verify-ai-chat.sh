#!/usr/bin/env bash
# Live check that Plug chat routes through Groq (not old llama / Gemini noise).
#
# Usage (on bot VM after restart):
#   bash scripts/verify-ai-chat.sh
#
# Flushes old pm2 buffer first so llama-3.1 / Gemini 400 lines from before
# the fix are not mistaken for a live failure.
set -euo pipefail

PORT="${PORT:-3001}"
BASE="${SOKONI_AGENT_BASE:-http://127.0.0.1:${PORT}}"

echo "==> Flushing sokoni-bot pm2 logs (clears pre-restart errors)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 flush sokoni-bot >/dev/null 2>&1 || pm2 flush >/dev/null 2>&1 || true
fi

echo "==> GET ${BASE}/api/agent/meta"
META="$(curl -fsS --max-time 8 "${BASE}/api/agent/meta")"
echo "$META" | head -c 900
echo
echo

GROQ_OK=0
GEMINI_ON=0
echo "$META" | grep -q '"name":"groq"' && GROQ_OK=1 || true
echo "$META" | grep -q 'openai/gpt-oss' && GROQ_OK=1 || true
echo "$META" | grep -q '"name":"gemini"' && GEMINI_ON=1 || true
echo "$META" | grep -q 'llama-3.1-8b-instant' && {
  echo "FAIL: meta still lists retired llama-3.1-8b-instant — pull main and restart"
  exit 1
}

echo "==> POST ${BASE}/api/agent/chat (escrow smoke)"
CHAT="$(curl -fsS --max-time 45 -X POST "${BASE}/api/agent/chat" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Is Sokoni prepaid escrow or COD?","sessionId":"verify-ai-chat"}')"
REPLY="$(printf '%s' "$CHAT" | sed -n 's/.*"reply":"\([^"]*\)".*/\1/p' | head -1)"
echo "reply: ${REPLY:-(empty)}"

echo
echo "==> Recent live logs (post-flush)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 logs sokoni-bot --lines 25 --nostream 2>/dev/null | grep -E 'Chat LLM|ai-agent|llm-router|groq' || true
fi

echo
if [ "$GROQ_OK" = "1" ] && [ "$GEMINI_ON" = "0" ]; then
  echo "OK: Groq in provider chain, Gemini chat off."
elif [ "$GROQ_OK" = "1" ]; then
  echo "OK: Groq present (Gemini also listed — set AI_CHAT_USE_GEMINI=false if unintended)."
else
  echo "WARN: Groq not visible in meta — check GROQ_API_KEY / pm2 --update-env"
  exit 1
fi

# Success = a reply came back (provider may be 20b or 120b)
if [ -n "$REPLY" ]; then
  echo "OK: agent returned a live reply."
  exit 0
fi
echo "FAIL: empty reply from /api/agent/chat"
exit 1
