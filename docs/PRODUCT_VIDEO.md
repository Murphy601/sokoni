# Sokoni product video system

Short clips raise trust on pre-loved / streetwear listings. They must stay light on Kenya mobile data.

## Two video types

| Kind | Length | Source | Where it plays |
|------|--------|--------|----------------|
| **`preview`** | 3–5s, muted loop | Cloudinary zoompan from cleaned cutout | Grid hover / ▶ tap; PDP fallback |
| **`seller`** | 15–30s, max 15MB | Phone upload by seller | Product detail page (controls + muted autoplay) |

Product fields:

- `videoUrl` — relative `assets/images/products/{id}.mp4` (or absolute CDN)
- `videoKind` — `"preview"` | `"seller"`

Public catalog (`toPublicProduct` + `build-site-catalog`) exposes both. Bot serves files at `/catalog-images/{id}.mp4`.

## Storefront rules

1. **Grid / search cards** — still image (cleaned cover) is the thumbnail. Never autoplay every video.
2. **Desktop** — hover the image to play the muted loop (one card at a time).
3. **Mobile** — ▶ button on the card toggles the clip; tapping the card opens the PDP.
4. **`prefers-reduced-motion`** — clip UI hidden; stills only.
5. **PDP** — video is the main media when present (`poster` = cover photo). Seller clips show controls; preview clips stay muted/looped.

## Seller flow

1. Optional phone video → validated client-side (≤30s, ≤15MB) → `videoKind: "seller"`.
2. Else optional studio clip from cleaned PNG → `videoKind: "preview"`.
3. Publish stores `{id}.mp4` next to cover JPEGs.

Studio clips are already Cloudinary-compressed (`q_auto:eco`, `w_720`, ~4s). Raw seller uploads are size-capped; full Cloudinary re-encode of 15–30s uploads can be added later without changing the public fields.

## Limits (meta + server)

- `maxVideoSeconds`: 30  
- `maxVideoBytes`: 15 × 1024 × 1024  
- JSON body limit remains 25mb (base64 headroom)

## Related

- [MEDIA_STUDIO_PLAN.md](./MEDIA_STUDIO_PLAN.md) — clean PNG + AI preview clip pipeline  
- `website/assets/js/app.js` — grid hover/tap  
- `website/assets/js/product-sheet.js` — PDP viewer  
