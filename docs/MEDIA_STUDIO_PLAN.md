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

**Clip always starts from the cleaned cutout**, never zoompan on the raw phone shot.

**Transform once, serve static CDN URLs** — never request Cloudinary bg-removal / zoompan on every page view. Final `cleanImageUrl` + `videoUrl` are saved in the catalog.

Cloudinary flow (memory-safe on the 1GB bot — one PNG at a time):
1. Upload `cutout_*` with eager `e_background_removal/f_png` and **`eager_async=false`**
2. Poll until the cleaned PNG has a real **alpha channel**
3. **Download that PNG and overwrite** `cutout_*` with the clean bytes (base asset is now transparent)
4. **1 photo:** zoompan MP4 on the baked asset (video transforms **cannot** apply `e_background_removal`)
5. **2–8 photos (on publish):** Cloudinary **multi** from baked clean URLs → one showcase MP4 (~2s/slide)
6. Persist those CDN URLs on the product

Do **not** put `e_background_removal` in an MP4 URL — Cloudinary ignores it for video. Do **not** re-upload a transformed URL without downloading bytes first (fetch often returns the original).

Studio API returns **`cleanImageUrl` + `clipVideoUrl`** (CDN). No multi‑MB base64. The sell page caches both in the browser. PM2 uses `--max-memory-restart 450M` so a spike restarts the bot instead of taking Sokoni down.

Storefront playback rules (hover/tap, never autoplay the whole grid) live in [PRODUCT_VIDEO.md](./PRODUCT_VIDEO.md).

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
# Only temp listing_* uploads are deleted; cutout_/reel_ stay for CDN:
# CLOUDINARY_DELETE_AFTER=true
# CLOUDINARY_DELETE_MS=180000
# Multi-photo showcase reel (publish):
# CLOUDINARY_REEL_DELAY_MS=2000
# CLOUDINARY_REEL_TRANS=dl_2000/w_720,h_720,c_pad,b_rgb:FFF8F0/q_auto:eco,vc_h264
# STUDIO_CLIP_INLINE=true   # embed data:video in JSON (heavy — tests only)
```

## Seller flow

1. Seller adds cover photo → **Preview clean + product clip** (when Cloudinary is configured for clips).
2. Bot cleans the cover with **eager_async=false**, stores a durable cutout, builds a ~4s zoompan MP4.
3. Response includes `cleanImageUrl` + `clipVideoUrl` (CDN). Browser caches those URLs.
4. Seller toggles **Use cleaned cover** / **Use generated clip as listing video**.
5. Publish sends CDN `imageUrls` / `videoUrl` (not multi‑MB base64).
6. If **2–8 photos** and no seller phone video → bot cleans extras, builds **one multi-photo reel**, saves that MP4 URL + clean image URLs in the catalog.

## API

- `POST /api/seller/listings/studio` → `{ studioApplied, cleanImageBase64?, clipApplied, clipVideoUrl?, clipVideoBase64?, provider?, message }`
- `GET /api/seller/listings/meta` → `studioEnabled`, `studioClipEnabled`, `studioProvider`, `studioProviders[]`

## Code

| Path | Role |
|------|------|
| `whatsapp-bot/src/services/listing-studio.js` | Provider chain + clip-from-clean |
| `whatsapp-bot/src/services/clip-fallbacks.js` | Soft HyperFrames / Remotion clips after Cloudinary miss |
| `website/assets/js/seller-listing.js` | Cover + clip toggles; CDN → browser cache |
| `website/suppliers/list.html` | Studio controls |

Failures keep the original cover. Clip failure is soft — clean image still returns. Bot boots without studio keys.

### Soft clip fallbacks (optional)

Cloudinary remains the primary clip engine. If zoompan / multi returns no URL and `STUDIO_CLIP_ENABLED` is not `false`:

1. **HyperFrames** (HeyGen) — set `HEYGEN_API_KEY` or `HYPERFRAMES_API_KEY`. Bot ships a tiny Ken Burns `index.html` zip unless `HYPERFRAMES_PROJECT_ASSET_ID` / `HYPERFRAMES_PROJECT_URL` points at your template.
2. **Remotion** — set `REMOTION_RENDER_URL` (HTTP worker). Optional Lambda env only if `@remotion/lambda` is installed separately (not a bot dependency).

Order: `STUDIO_CLIP_FALLBACKS=hyperframes,remotion`. Ephemeral render URLs are re-uploaded to Cloudinary when possible so catalog links stay durable. Unset keys = no-op (existing Cloudinary path unchanged).

**Cloudinary note:** first `e_background_removal` / zoompan request can return **423** while the derived file builds. The bot retries automatically (and prefers eager transforms on upload).

**Credentials check** (on the VM):

```bash
cd ~/sokoni/whatsapp-bot && npm run verify:cloudinary
```

If you see `api_secret mismatch`, re-copy the API secret from Cloudinary Console → Settings → API Keys (reveal), update `CLOUDINARY_API_SECRET` in `.env`, redeploy.

## Why not rembg/ffmpeg on the VM?

Those pull **2–4GB+** disk/RAM. Cloudinary (or HF for images only) keeps the bot lightweight.
