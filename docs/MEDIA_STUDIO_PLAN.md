# Media studio — rembg + ffmpeg → PhotoRoom later

**Status:** Phase 0 locked (measure & decide). Phases 1–6 not started until each is approved.  
**Rule:** Do not break WhatsApp bot or seller listing. Studio stays optional; failures fall back to the original cover.  
**Stack truth:** Vanilla `website/` + Node `whatsapp-bot` on GCP. **Not** Next.js/React.

## Goal

While the business is early:

1. **Cover background cleanup** via self-hosted `rembg` (no Photoroom API fees).
2. **Short promo clip** via `ffmpeg` Ken Burns on the cleaned (or original) cover.
3. When volume/quality demand it, **swap cleanup to Photoroom API** behind the same interface — seller UX unchanged.

## Phase map

| Phase | Name | Ship when |
|-------|------|-----------|
| **0** | Decide & measure | This doc + opt-in benchmark script; **no prod wire** |
| **1** | rembg microservice | Docker/HTTP sidecar; health check; not yet default for sellers |
| **2** | Async cleanup job | Upload → queue → rembg → clean PNG; bot stays responsive |
| **3** | ffmpeg clip job | After still ready → ~5s MP4; publish not blocked on clip failure |
| **4** | Seller UX | Preview clean; optional clip; keep original vs cleaned toggle |
| **5** | Ops & limits | Concurrency, resize, disk cleanup, degrade if worker down |
| **6** | Provider swap | Flip cleanup to Photoroom when ready; same job contracts |

---

## Phase 0 — Locked decisions

### Scope
- **Cover photo only** for cleanup and clip generation (slot 0). Extra photos stay as-is.
- **Do not** run rembg/ffmpeg inside the Cloudflare Pages site or the hot WhatsApp message path.
- Jobs attach to **whatsapp-bot / seller listing API** only (`listing-studio.js` and related routes).

### UX (already partly built — preserve)
- Sellers already have **Preview clean background** + **Use cleaned cover when posting** (`website/assets/js/seller-listing.js`).
- Keep that toggle. Bad cutouts → post original.
- Clips are additive later: optional preview; listing still publishes if clip job fails.

### Provider strategy
| Stage | Cleanup | Clip |
|-------|---------|------|
| Now → early growth | `rembg` (self-hosted) | `ffmpeg` Ken Burns |
| Later | Photoroom API (`PHOTOROOM_API_KEY` path already exists) | Keep ffmpeg unless/until AI video budget exists |

Abstract cleanup behind `removeBackground()` in `listing-studio.js` so Photoroom remains a drop-in later. **Phase 0 does not change that function’s production behaviour.**

### Async (prevent slowing the bot)
```text
[ Seller cover upload / studio preview ]
         │
         ▼
[ sellerListingsApi (Node) ] ── enqueue job ──► [ media worker ]
                                                    ├── rembg → clean PNG
                                                    └── ffmpeg → 5s MP4
                                                    ▼
                                         [ same product media paths as today ]
```
- Phase 0–1 may still be sync behind a feature flag for a single preview call **with timeouts**.
- Phase 2+ must be async under concurrent sellers (queue or in-process job with concurrency=1–2).

### Storage
- Continue writing under existing product media helpers (`assets/images/products/{id}…` / current bot media save path).
- Do **not** require AWS S3 for v1. CDN/S3 can wait until Phase 5–6 if needed.

### Safety / non-goals for Phase 0
- No new default dependency that fails bot boot if rembg/ffmpeg missing.
- No change to `isStudioConfigured()` behaviour until Phase 1–2 (still Photoroom-key based today).
- Listing AI (Gemini/OpenRouter) stays separate — studio only affects pixels, not draft JSON.

### Baseline measurements (agent host, 2026-08-01)

Environment: Linux, 4 vCPU, ~15 GiB RAM, `ffmpeg 6.1.1` present; **no Docker / no rembg** in this cloud agent image.

| Step | Result |
|------|--------|
| ffmpeg Ken Burns 1080×1080 → 5s H.264 | **~0.45–0.55 s** wall time; output ~52 KB for synthetic solid-colour test |
| rembg | **Not installed here** — run `node scripts/benchmark-media-studio.mjs` on the **bot VM** after Phase 1 image exists, or with local rembg |

**VM action before Phase 1 merge to prod:** SSH to `sokoni-bot` and run the benchmark script (see below). Record rembg CPU seconds + RSS; if rembg ≫ 5 s or RAM spikes starve the bot, use a sidecar with concurrency 1 and larger timeout — do not run rembg in-process inside the WAHA webhook event loop.

### Opt-in benchmark

```bash
# From repo root — never called by bot boot or deploy-bot.sh
node scripts/benchmark-media-studio.mjs

# Optional rembg HTTP (after Phase 1 sidecar exists):
REMBG_URL=http://127.0.0.1:7000/api/remove node scripts/benchmark-media-studio.mjs
```

---

## Interface sketch (Phases 1+)

Keep seller API shapes stable:

- `POST /api/seller/listings/studio` → still returns `{ studioApplied, cleanImageBase64?, reason?, message }`
- Later add optional `{ clipStatus?, clipUrl? }` without breaking clients that ignore unknown fields
- `GET /api/seller/listings/meta` → extend with `studioProvider: "none"|"photoroom"|"rembg"` when wired

Env (planned, not required in Phase 0):

| Var | Purpose |
|-----|---------|
| `STUDIO_PROVIDER=photoroom\|rembg\|off` | Explicit provider (default: photoroom if key set, else off — until rembg ready) |
| `REMBG_URL` | HTTP rembg microservice |
| `STUDIO_CLIP_ENABLED=true` | Opt-in ffmpeg clip job |
| `PHOTOROOM_API_KEY` | Phase 6 / current path |

---

## Phase exit criteria

| Phase | Done when |
|-------|-----------|
| **0** | Decisions locked in this doc; benchmark script in repo; prod listing/studio behaviour unchanged |
| **1** | rembg container health OK on VM; manual curl remove works; bot still starts if rembg down |
| **2** | Studio preview uses rembg via job/timeout path; Photoroom still selectable; webhook latency unaffected |
| **3** | Clip file produced for cover; publish works without clip |
| **4** | Sellers can preview clean + clip; toggle preserved |
| **5** | Limits documented; disk/concurrency safe under 3 concurrent cleans |
| **6** | One-env flip to Photoroom; rembg retained as fallback optional |

---

## Related code (today)

| Path | Role |
|------|------|
| `whatsapp-bot/src/services/listing-studio.js` | Photoroom segment + preview helpers |
| `whatsapp-bot/src/routes/sellerListingsApi.js` | `/studio`, `/generate` |
| `website/assets/js/seller-listing.js` | Cover clean UI + prefer-clean toggle |
| `docs/PHASE4_LISTING.md` | Seller listing product docs |

Proceed **one phase at a time** after Phase 0 is merged and VM benchmark numbers are recorded.
