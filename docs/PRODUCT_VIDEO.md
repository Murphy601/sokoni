# Sokoni product video system

Short clips raise trust on pre-loved / streetwear listings. They must stay light on Kenya mobile data.

## Two video types

| Kind | Length | Source | Where it plays |
|------|--------|--------|----------------|
| **`preview`** | 3–5s (1 photo) or ~2s×N (multi-photo reel) | Cloudinary zoompan **or** multi slideshow from cleaned cutouts | Grid hover / ▶ tap; PDP fallback |
| **`seller`** | 15–30s, max 15MB | Phone upload by seller | Product detail page (controls + muted autoplay) |

Product fields:

- `videoUrl` — absolute Cloudinary CDN URL preferred (transform once); else relative `assets/images/products/{id}.mp4`
- `videoKind` — `"preview"` | `"seller"`
- `imageUrl` / `images` — cleaned cutout CDN URLs when studio ran (static delivery)

Public catalog (`toPublicProduct` + `build-site-catalog`) exposes both. Bot serves files at `/catalog-images/{id}.mp4`.

## Storefront rules

1. **Grid / search cards** — still image (cleaned cover) is the thumbnail. Never autoplay every video.
2. **Desktop** — hover the image to play the muted loop (one card at a time).
3. **Mobile** — ▶ button on the card toggles the clip; tapping the card opens the PDP.
4. **`prefers-reduced-motion`** — clip UI hidden; stills only.
5. **PDP** — video is the main media when present (`poster` = cover photo). Seller clips show controls; preview clips stay muted/looped.

## Seller flow

1. Optional phone video → validated client-side (≤30s, ≤15MB) → `POST /api/seller/listings/upload-video` stages `stage_*.mp4` on the bot → publish sends only that short `videoUrl` with `videoKind: "seller"` (skips AI reel). Never put multi‑MB `videoBase64` in `/publish` (that caused nginx timeouts and a fake “Post sent” with no listing).
2. Else studio: clean backgrounds once → **1 photo** zoompan clip, or **2–8 photos** one Cloudinary multi reel → `videoKind: "preview"`.
3. Publish saves CDN `videoUrl` (preview) or local `/catalog-images/{id}.mp4` (seller) + cleaned `imageUrl`s; caches a local cover JPEG for WhatsApp.

Studio / reel videos are Cloudinary-compressed (`q_auto:eco`, `w_720`). Raw seller uploads are size-capped.

## Limits (meta + server)

- `maxVideoSeconds`: 30  
- `maxVideoBytes`: 15 × 1024 × 1024  
- JSON body limit remains 25mb (base64 headroom for `/upload-video` alone)

## Related

- [MEDIA_STUDIO_PLAN.md](./MEDIA_STUDIO_PLAN.md) — clean PNG + AI preview clip pipeline  
- `website/assets/js/app.js` — grid hover/tap  
- `website/assets/js/product-sheet.js` — PDP viewer  
