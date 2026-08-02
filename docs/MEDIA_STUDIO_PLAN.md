# Media studio — cloud background removal

**Status:** Self-hosted rembg/ffmpeg was removed (too heavy for the 1GB bot VM).  
**Cleanup path:** remote APIs only — **0 MB** PyTorch/ONNX on the bot.

## Providers

| Provider | Env | Notes |
|----------|-----|--------|
| **Cloudinary** (recommended free) | `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` | Upload original → deliver with `e_background_removal` → optional destroy |
| **Hugging Face** | `HUGGINGFACE_API_KEY` (+ optional `HUGGINGFACE_RMBG_URL`) | Remote inference; Hub RMBG models often need a dedicated endpoint/Space URL |
| **Photoroom** | `PHOTOROOM_API_KEY` | Paid Segment API — high quality |
| **Remote** | `STUDIO_REMOTE_URL` | Any POST→PNG microservice (Modal/Render rembg) |

## Enable (pick one or more)

```env
STUDIO_PROVIDER=auto

# Free-first path
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Fallback if Cloudinary fails / quota
HUGGINGFACE_API_KEY=hf_...
# If serverless model 404s, point at a working endpoint:
# HUGGINGFACE_RMBG_URL=https://your-endpoint.example/remove

# Optional paid quality
PHOTOROOM_API_KEY=...
```

Pin a primary + fallback:

```env
STUDIO_PROVIDER=cloudinary
STUDIO_FALLBACK=huggingface
```

Redeploy the bot. Seller UI shows **Preview clean background** when `studioEnabled` is true.

## API

- `POST /api/seller/listings/studio` → `{ studioApplied, cleanImageBase64?, reason?, message, provider? }`
- `GET /api/seller/listings/meta` → `studioEnabled`, `studioProvider`, `studioProviders[]`, `studioProviderOrder[]`

## Code

| Path | Role |
|------|------|
| `whatsapp-bot/src/services/listing-studio.js` | Provider chain + preview |
| `website/assets/js/seller-listing.js` | Cover clean toggle |
| `docs/PHASE4_LISTING.md` | Seller listing docs |

Failures always keep the original cover. Bot boots without any studio keys.

## Why not rembg on the VM?

`rembg` pulls PyTorch/ONNX + weights (**2–4GB+** disk/RAM). Offload to Cloudinary/HF/Modal instead.
