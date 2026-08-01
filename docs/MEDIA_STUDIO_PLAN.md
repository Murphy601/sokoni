# Media studio — rembg + ffmpeg → PhotoRoom later

**Status:** Phases **0–6 implemented** in code. Enable on the VM with env + Docker; bot boots safely if rembg is down.  
**Rule:** Studio stays optional; failures fall back to the original cover. Never blocks WhatsApp chat.  
**Stack:** Vanilla `website/` + Node `whatsapp-bot` on GCP. **Not** Next.js/React.

## Goal

1. **Cover background cleanup** via self-hosted `rembg` (no Photoroom fees by default).
2. **Short promo clip** via `ffmpeg` Ken Burns on the cleaned (or original) cover.
3. When volume/quality demand it, **swap cleanup to Photoroom API** with optional rembg fallback — seller UX unchanged.

## Phase map

| Phase | Name | Status |
|-------|------|--------|
| **0** | Decide & measure | Done — decisions + `scripts/benchmark-media-studio.mjs` |
| **1** | rembg microservice | Done — `media-worker/` + `docker-compose.media.yml` |
| **2** | Async cleanup job | Done — `media-jobs.js` concurrency queue |
| **3** | ffmpeg clip job | Done — `media-clip.js` + `/studio/clip` |
| **4** | Seller UX | Done — clean toggle + optional clip UI |
| **5** | Ops & limits | Done — concurrency, max bytes, timeouts, health cache, mem_limit |
| **6** | Provider swap | Done — `STUDIO_PROVIDER` + `STUDIO_FALLBACK_REMBG` |

## VM enable (production)

```bash
cd ~/sokoni
git fetch origin main && git checkout -B main origin/main

# 1) rembg sidecar (requires Docker)
docker compose -f docker-compose.media.yml up -d --build
curl -s http://127.0.0.1:7000/health

# 2) bot .env (whatsapp-bot/.env)
# STUDIO_PROVIDER=auto
# REMBG_URL=http://127.0.0.1:7000
# STUDIO_CLIP_ENABLED=true
# STUDIO_CONCURRENCY=1
# STUDIO_FALLBACK_REMBG=false
# PHOTOROOM_API_KEY=   # leave empty until you pay for Photoroom

# 3) ffmpeg on host (for clips)
sudo apt-get install -y ffmpeg

# 4) deploy bot
SKIP_CATALOG_PUBLISH=1 SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh

# 5) benchmark (optional)
node scripts/benchmark-media-studio.mjs
REMBG_URL=http://127.0.0.1:7000/api/remove node scripts/benchmark-media-studio.mjs
```

### Phase 6 — switch to Photoroom later

```env
STUDIO_PROVIDER=photoroom
PHOTOROOM_API_KEY=your_key
REMBG_URL=http://127.0.0.1:7000
STUDIO_FALLBACK_REMBG=true
```

Or keep rembg primary: `STUDIO_PROVIDER=rembg`.

## Locked decisions (Phase 0)

- **Cover photo only** for cleanup and clip.
- Jobs only on seller listing API — not WAHA webhook path.
- Keep **original vs cleaned** toggle.
- Clip failure never blocks publish.
- Storage = existing `assets/images/products/` paths (no S3 required).

## Architecture

```text
[ Seller cover upload / studio preview ]
         │
         ▼
[ sellerListingsApi (Node) ]
         │
         ├── media-jobs queue (concurrency 1–2)
         │         ├── rembg HTTP  → clean PNG
         │         └── ffmpeg      → 5s MP4
         ▼
[ Seller UI: preview clean + optional clip → publish ]
```

## Env reference

| Var | Purpose |
|-----|---------|
| `STUDIO_PROVIDER` | `auto` \| `rembg` \| `photoroom` \| `off` |
| `REMBG_URL` | e.g. `http://127.0.0.1:7000` |
| `PHOTOROOM_API_KEY` | Paid cleanup (optional) |
| `STUDIO_FALLBACK_REMBG` | `true` = Photoroom fail → rembg |
| `STUDIO_CLIP_ENABLED` | `true` = Ken Burns clips |
| `STUDIO_CONCURRENCY` | Max parallel media jobs (default 1) |
| `STUDIO_MAX_BYTES` | Max upload for cleanup (default 12MB) |

## API (backward compatible)

- `POST /api/seller/listings/studio` → `{ studioApplied, cleanImageBase64?, wantClip→ clipStatus, clipBase64? }`
- `POST /api/seller/listings/studio/clip` → `{ clipStatus, clipBase64? }`
- `GET /api/seller/listings/meta` → `studioProvider`, `studioClipEnabled`, `rembgHealthy`, …

## Tests

```bash
cd whatsapp-bot
node scripts/test-listing-studio.mjs
node scripts/test-media-clip.mjs
```

## Related code

| Path | Role |
|------|------|
| `media-worker/` | rembg FastAPI sidecar |
| `docker-compose.media.yml` | Run rembg on VM |
| `whatsapp-bot/src/services/listing-studio.js` | Providers + preview |
| `whatsapp-bot/src/services/media-jobs.js` | Queue / concurrency |
| `whatsapp-bot/src/services/media-clip.js` | ffmpeg Ken Burns |
| `website/assets/js/seller-listing.js` | Seller UI |
