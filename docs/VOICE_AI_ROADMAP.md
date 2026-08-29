# Sokoni Voice AI Roadmap

Interactive spoken help on WhatsApp + the storefront — phased so we never ship fake WebRTC.

## Already live

| Surface | Capability |
|---------|------------|
| WhatsApp voice notes | Whisper STT via OpenRouter (`commerce-ops` / webhook) → same AI + Boss interceptor path |
| `ask.html` + `/api/agent/chat` | Text Ask Plug (web) |
| LLM router | Groq → OpenRouter (+ optional Gemini / NVIDIA for MAS / vision) |

## Phase 1 — shipped: floating Ask FAB

- Sitewide `Ask AI` panel (`website/assets/js/ask-voice-fab.js`)
- Reuses `POST /api/agent/chat` (no bot rewrite)
- Optional **browser** `SpeechRecognition` mic + `speechSynthesis` reply (Chrome/Edge; hidden if unsupported)
- Fail-soft: API down → WhatsApp / Full Ask links
- Storefront styling follows `DESIGN.md` (cream + WhatsApp green) — not admin Depop red

## Phase 2 — NVIDIA NIM (server keys only)

Requires `NVIDIA_API_KEY` in bot env (never in the browser).

| Role | Suggested NIM | Notes |
|------|----------------|-------|
| Fast chat | `meta/llama-3.1-8b-instruct` | Add to `llm-router` chain as optional failover |
| Boss / heavy tools | `meta/llama-3.3-70b-instruct` | Admin mutations stay **code interceptor first** |
| WA noisy ASR | `nvidia/parakeet-tdt-1.1b` / Canary | Optional alternate to Whisper for boda traffic noise |
| Vision disputes | existing NVIDIA vision path | Listing / dispute photos |

Wire through OpenAI-compatible `https://integrate.api.nvidia.com/v1` in `llm-router.js` / STT helper — same pattern as Groq.

## Phase 3 — true realtime voice (Vapi / Retell / OpenAI Realtime)

Only after Phase 1 usage proves demand:

1. Server issues short-lived session token (public key never alone).
2. Widget swaps browser STT for WebRTC to Vapi/Retell **or** a Sokoni WS that pipes NVIDIA ASR → LLM → TTS.
3. Keep escrow / FORCE RELEASE mutations on the **code interceptor** — voice never invents DB writes.

Env (future): `VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`, or `RETELL_*`, plus `NVIDIA_API_KEY`.

## Non-goals

- Putting `NVIDIA_API_KEY` or master secrets in static HTML
- Replacing WhatsApp checkout with voice-only checkout
- Letting the LLM mutate escrow without the Boss interceptor
