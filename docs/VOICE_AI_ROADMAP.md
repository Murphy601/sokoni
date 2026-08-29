# Sokoni Voice AI Roadmap

Interactive spoken help on WhatsApp + the storefront — phased so we never ship fake WebRTC.

## Already live

| Surface | Capability |
|---------|------------|
| WhatsApp voice notes | Whisper STT via OpenRouter (`commerce-ops` / webhook) → same AI + Boss interceptor path |
| `ask.html` + `/api/agent/chat` | Text Ask Plug (web) |
| Ask FAB + `/api/agent/speak` | Floating Ask panel; neural TTS when keys set, else better browser voices |
| LLM router | Groq → OpenRouter (+ optional Gemini / NVIDIA for MAS / vision) |

## Phase 1 — shipped: floating Ask FAB

- Sitewide `Ask AI` panel (`website/assets/js/ask-voice-fab.js`)
- Reuses `POST /api/agent/chat` (no bot rewrite)
- Optional **browser** `SpeechRecognition` mic (Chrome/Edge; hidden if unsupported)
- Spoken replies: `POST /api/agent/speak` → neural audio, else `speechSynthesis` with preferred female/en-GB voice
- Speak/Mute toggle (persisted); honors `prefers-reduced-motion`
- Fail-soft: API down → WhatsApp / Full Ask links
- Storefront styling follows `DESIGN.md` (cream + WhatsApp green) — not admin Depop red

## Phase 1.5 — shipped: neural "Zara" TTS (server keys only)

`whatsapp-bot/src/services/neural-tts.js` + `POST /api/agent/speak`

| Priority | Provider | Env |
|----------|----------|-----|
| 1 | ElevenLabs (`eleven_turbo_v2`) | `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID` (default Rachel) |
| 2 | Cartesia Sonic | `CARTESIA_API_KEY`, optional `CARTESIA_VOICE_ID` |
| 3 | Hugging Face / Kokoro proxy | `NEURAL_TTS_HF_URL` and/or `HUGGINGFACE_API_KEY` + `NEURAL_TTS_HF_MODEL` |
| — | Browser fallback | No key required |

- `NEURAL_TTS_PROVIDER=auto|elevenlabs|cartesia|huggingface`
- Keys never in static HTML; client only receives audio bytes or `{ fallback: "browser" }`

**Cheap/free stack (documented target):** NVIDIA Parakeet/Canary (ASR) + Llama NIM (brain) + Kokoro-82M / StyleTTS 2 (voice) via HF Space or self-host. Wire ASR NIM in Phase 2; TTS free path is ready via `NEURAL_TTS_HF_URL`.

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
2. Widget swaps browser STT for WebRTC to Vapi/Retell **or** a Sokoni WS that pipes NVIDIA ASR → LLM → neural TTS.
3. Keep escrow / FORCE RELEASE mutations on the **code interceptor** — voice never invents DB writes.

Env (future): `VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`, or `RETELL_*`, plus `NVIDIA_API_KEY`.

## Non-goals

- Putting `NVIDIA_API_KEY` / `ELEVENLABS_API_KEY` or master secrets in static HTML
- Replacing WhatsApp checkout with voice-only checkout
- Letting the LLM mutate escrow without the Boss interceptor
