# Media studio — Photoroom (current)

**Status:** Self-hosted rembg + ffmpeg experiment **removed** (too heavy for the 1GB bot VM).  
**Cleanup path:** Photoroom Remove Background / Segment API only.

## Enable

In `whatsapp-bot/.env`:

```env
PHOTOROOM_API_KEY=your_photoroom_api_key
```

Then redeploy the bot. Seller UI shows **Preview clean background** when `studioEnabled` is true.

## API

- `POST /api/seller/listings/studio` → `{ studioApplied, cleanImageBase64?, reason?, message }`
- `GET /api/seller/listings/meta` → `studioEnabled`, `studioProvider: "photoroom"|"none"`

## Code

| Path | Role |
|------|------|
| `whatsapp-bot/src/services/listing-studio.js` | Photoroom segment + preview |
| `website/assets/js/seller-listing.js` | Cover clean toggle |
| `docs/PHASE4_LISTING.md` | Seller listing docs |

Failures always keep the original cover. Bot boots without the key.
