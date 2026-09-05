# Sokoni Voice AI Roadmap

Interactive spoken help on WhatsApp + the storefront — phased so we never ship fake WebRTC.

## Already live

| Surface | Capability |
|---------|------------|
| WhatsApp voice notes | Whisper STT via OpenRouter (`commerce-ops` / webhook) → same AI + Boss interceptor path |
| ElevenLabs TTS (text-first) | Voice note in, or explicit “send voice” / “tuma sauti” → `eleven_flash_v2_5` MP3 with local `data/audio-cache/` |
| `ask.html` + `/api/agent/chat` | Text Ask Plug (web full page) |
| LLM router | Groq → OpenRouter (+ optional Gemini / NVIDIA for MAS / vision) |

### ElevenLabs (WhatsApp out) — keys on the VM only

Text is the default. Incoming **text** never spends ElevenLabs characters. Incoming **voice notes** (after Whisper) get a spoken reply once `ELEVENLABS_API_KEY` is set. Shoppers can also type *send voice* / *tuma sauti*.

On the bot VM (`whatsapp-bot/.env`):

```bash
ELEVENLABS_API_KEY="…"
ELEVENLABS_VOICE_ID="21m00Tcm4TlvDq8ikWAM"   # Voice Library (Rachel default)
# ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

Then:

```bash
cd whatsapp-bot
npm run tts:precache    # greetings / support lines → data/audio-cache/
bash ../scripts/deploy-bot.sh
```

WAHA `convert: true` turns the MP3 into a WhatsApp PTT. ffmpeg on the bot VM is **not** required. `GET /health` → `elevenlabs.configured`.

Set `ELEVENLABS_TTS=false` to keep STT but disable spoken replies.

## Removed — floating Ask FAB / browser mic / neural TTS widget

The sitewide floating Ask AI panel (`ask-voice-fab.js`), browser Mic, Speak toggle, and `POST /api/agent/speak` neural TTS chain were **removed**. They were unreliable on real devices (mic / TTS / weak track replies). Shoppers use **WhatsApp** or **Full Ask** (`ask.html`) instead.

## Phase 2 — NVIDIA NIM (server keys only) — future

Requires `NVIDIA_API_KEY` in bot env (never in the browser).

| Role | Suggested NIM | Notes |
|------|----------------|-------|
| Fast chat | `meta/llama-3.1-8b-instruct` | Add to `llm-router` chain as optional failover |
| Boss / heavy tools | `meta/llama-3.3-70b-instruct` | Admin mutations stay **code interceptor first** |
| WA noisy ASR | `nvidia/parakeet-tdt-1.1b` / Canary | Optional alternate to Whisper for boda traffic noise |
| Vision disputes | existing NVIDIA vision path | Listing / dispute photos |

Wire through OpenAI-compatible `https://integrate.api.nvidia.com/v1` in `llm-router.js` / STT helper — same pattern as Groq.

## Phase 3 — true realtime voice (Vapi / Retell / OpenAI Realtime) — future

Only if product demand returns:

1. Server issues short-lived session token (public key never alone).
2. Dedicated WebRTC widget (not browser `SpeechRecognition` + `speechSynthesis`).
3. Keep escrow / FORCE RELEASE mutations on the **code interceptor** — voice never invents DB writes.

Env (future): `VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`, or `RETELL_*`, plus `NVIDIA_API_KEY`.

## Non-goals

- Putting `NVIDIA_API_KEY` or master secrets in static HTML
- Replacing WhatsApp checkout with voice-only checkout
- Letting the LLM mutate escrow without the Boss interceptor
- Reintroducing a half-working browser mic FAB without a real realtime stack
