# Sokoni Multi-Agent System (MAS) — fallback gateway

Additive **strangler-fig** layer. Primaries stay:

| Capability | Primary (unchanged) |
|------------|---------------------|
| Product clips | **Cloudinary** Ken Burns/zoompan → **HeyGen HyperFrames** → **Remotion** |
| Chat | Groq → OpenRouter (optional Gemini) |
| Listing vision | OpenRouter VLMs → NVIDIA NIM → Gemini |
| Photo search | Free OpenRouter/NVIDIA → Gemini |

MAS registers **all** operational division agents (security, logistics stubs, OCR, RAG, media, voice, reasoning, multimodal). Execution is **shadow by default**.

## Phases

1. **Shadow** — parallel read-only agents (jailbreak/topic/safety heuristics, vision metadata, dispute video stubs). Logs `[mas-shadow]`.
2. **Media assist** — `MAS_ENABLE_MEDIA_FALLBACK=true` runs `VIDEO_CLIP_LAST_RESORT` **only after** Cloudinary + HeyGen + Remotion fail in `attachVideoFromCleanImageUrls`.
3. **Assistive messaging** — `MAS_ENABLE_VOICE_ASSIST` / `CHAT_FAILOVER` / `MODERATION_LIVE` after primary failure or as optional gate.
4. **Transactional shadow** — `MAS_ENABLE_TX_SHADOW` enables dispute/logistics advisors that **never** auto-release escrow or pin riders.

## Code

- `whatsapp-bot/src/services/mas/` — registry, routes, circuit breaker, providers, shadow, assist
- Health: `GET /health` → `mas` object (`flags`, `catalog.totalAgents`, `primaryUntouched`)

## Ops flags

```bash
# defaults (safe)
MAS_ENABLED=true
MAS_SHADOW=true
MAS_ENABLE_MEDIA_FALLBACK=false
MAS_ENABLE_VOICE_ASSIST=false
MAS_ENABLE_CHAT_FAILOVER=false
MAS_ENABLE_MODERATION_LIVE=false
MAS_ENABLE_TX_SHADOW=false
```

Hot-swap routes without code: `MAS_ROUTE_<TASK>=provider:model,...`
