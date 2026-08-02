# Media studio — cloud cleanup + product clips

**Status:** Self-hosted rembg/ffmpeg was removed (too heavy for the 1GB bot VM).  
**Path:** remote APIs only — **0 MB** PyTorch/ONNX/ffmpeg on the bot.

## What each provider can do

| Provider | Clean PNG | Short product clip (MP4) |
|----------|-----------|---------------------------|
| **Cloudinary** | Yes — `e_background_removal` | Yes — `e_zoompan` image→MP4 (~5s) |
| **Hugging Face** | Yes — RMBG / Inference | No |
| **Photoroom** | Yes — Segment API | No |
| **Remote** | Yes — POST→PNG | No (unless your microservice returns video separately) |

**Cloudinary is the single best tool** for Sokoni: one upload → cleaned cover + Ken Burns clip, no disk on the VM.

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
# CLOUDINARY_CLIP_TRANS=e_background_removal/b_rgb:FFF8F0/e_zoompan:mode_ztc;maxzoom_1.25;du_5;fps_25
# CLOUDINARY_DELETE_AFTER=true
```

## Seller flow

1. Seller adds cover photo → **Preview clean + product clip** (when Cloudinary is configured).
2. Bot uploads once to Cloudinary, fetches:
   - cleaned PNG (`e_background_removal`)
   - ~5s MP4 (`e_zoompan` with cream fill)
3. Seller toggles **Use cleaned cover** / **Use generated clip as listing video**.
4. Publish sends cleaned cover + clip as `videoBase64` when selected.

Hugging Face / Photoroom only fill the clean-cover path.

## API

- `POST /api/seller/listings/studio` → `{ studioApplied, cleanImageBase64?, clipApplied, clipVideoBase64?, provider?, message }`
- `GET /api/seller/listings/meta` → `studioEnabled`, `studioClipEnabled`, `studioProvider`, `studioProviders[]`

## Code

| Path | Role |
|------|------|
| `whatsapp-bot/src/services/listing-studio.js` | Provider chain + Cloudinary clip |
| `website/assets/js/seller-listing.js` | Cover + clip toggles |
| `website/suppliers/list.html` | Studio controls |

Failures keep the original cover. Clip failure is soft — clean image still returns. Bot boots without studio keys.

## Why not rembg/ffmpeg on the VM?

Those pull **2–4GB+** disk/RAM. Cloudinary (or HF for images only) keeps the bot lightweight.
