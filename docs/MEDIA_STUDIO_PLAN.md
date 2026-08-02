# Media studio — cloud cleanup + product clips

**Status:** Self-hosted rembg/ffmpeg was removed (too heavy for the 1GB bot VM).  
**Path:** remote APIs only — **0 MB** PyTorch/ONNX/ffmpeg on the bot.

## What each provider can do

| Provider | Clean PNG | Short product clip (MP4) |
|----------|-----------|---------------------------|
| **Cloudinary** | Yes — `e_background_removal` | Yes — second pass on the **cleaned cutout** (`c_pad` + `e_shadow` + `e_zoompan` → MP4) |
| **Hugging Face** | Yes — RMBG / Inference | Via Cloudinary when configured (clip from HF PNG) |
| **Photoroom** | Yes — Segment API | Via Cloudinary when configured (clip from Photoroom PNG) |
| **Remote** | Yes — POST→PNG microservice | Via Cloudinary when configured |

**Clip always starts from the cleaned photo**, not the raw phone shot — same idea as Photoroom product videos (studio pad, soft shadow, motion).

API responses prefer a **CDN `clipVideoUrl`** (no multi‑MB base64 through the bot). The sell page caches the clip in the browser for publish. That keeps the 1GB VM from OOM / “Can’t reach Sokoni” after studio.

## Enable

```env
STUDIO_PROVIDER=auto
STUDIO_CLIP_ENABLED=true

CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Optional image-only fallback if Cloudinary BG fails
HUGGINGFACE_API_KEY=hf_...
# PHOTOROOM_API_KEY=...
```

Pin + fallback:

```env
STUDIO_PROVIDER=cloudinary
STUDIO_FALLBACK=huggingface
```

Disable clips (cleanup only):

```env
STUDIO_CLIP_ENABLED=false
```

Optional Cloudinary tweaks:

```env
# CLOUDINARY_FOLDER=sokoni-studio
# CLOUDINARY_BG_EFFECT=e_background_removal
# Clip runs on the cleaned cutout only (do not include e_background_removal):
# CLOUDINARY_CLIP_TRANS=c_pad,w_1080,h_1080,b_rgb:FFF8F0/e_shadow:45/e_zoompan:du_5;fps_30;mode_ofl;maxzoom_1.4/w_720,q_auto:eco,vc_h264
# CLOUDINARY_DELETE_AFTER=true
# CLOUDINARY_DELETE_MS=180000
# STUDIO_CLIP_INLINE=true   # embed data:video in JSON (heavy — tests only)
```

## Seller flow

1. Seller adds cover photo → **Preview clean + product clip** (when Cloudinary is configured for clips).
2. Bot cleans the cover (Cloudinary / HF / Photoroom), then uploads the **cleaned PNG** to Cloudinary and builds a ~5s MP4 (pad + shadow + zoompan).
3. Response includes `clipVideoUrl` (CDN). The browser previews it and caches bytes for publish.
4. Seller toggles **Use cleaned cover** / **Use generated clip as listing video**.
5. Publish sends cleaned cover + clip as `videoBase64` (from the browser cache).

## API

- `POST /api/seller/listings/studio` → `{ studioApplied, cleanImageBase64?, clipApplied, clipVideoUrl?, clipVideoBase64?, provider?, message }`
- `GET /api/seller/listings/meta` → `studioEnabled`, `studioClipEnabled`, `studioProvider`, `studioProviders[]`

## Code

| Path | Role |
|------|------|
| `whatsapp-bot/src/services/listing-studio.js` | Provider chain + clip-from-clean |
| `website/assets/js/seller-listing.js` | Cover + clip toggles; CDN → browser cache |
| `website/suppliers/list.html` | Studio controls |

Failures keep the original cover. Clip failure is soft — clean image still returns. Bot boots without studio keys.

**Cloudinary note:** first `e_background_removal` / zoompan request can return **423** while the derived file builds. The bot retries automatically (and prefers eager transforms on upload).

**Credentials check** (on the VM):

```bash
cd ~/sokoni/whatsapp-bot && npm run verify:cloudinary
```

If you see `api_secret mismatch`, re-copy the API secret from Cloudinary Console → Settings → API Keys (reveal), update `CLOUDINARY_API_SECRET` in `.env`, redeploy.

## Why not rembg/ffmpeg on the VM?

Those pull **2–4GB+** disk/RAM. Cloudinary (or HF for images only) keeps the bot lightweight.
