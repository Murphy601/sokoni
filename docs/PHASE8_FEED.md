# Phase 8 — Personalization & ML-style feed

Depop-style **behavior-ranked feeds** — trending and personalized sections backed by real event data (not a static grid).

## Signals

| Event | Weight | Source |
|-------|--------|--------|
| `view` | 1 | Product sheet open |
| `click` | 3 | Feed rail card tap |
| `save` | 5 | ♡ saved to bag |
| `unsave` | -2 | Removed from bag |
| `purchase` | 10 | Daraja / escrow payment confirmed |
| `category` | 2 | Browse navigation (future) |
| `search` | 1 | Search bar |

Scores decay over ~72 hours. Global trending rebuilds **hourly**.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/feed/meta` | Phase info + 24h event stats |
| GET | `/api/feed/home?sessionId=&saved=` | Trending + personalized sections |
| POST | `/api/feed/event` | Log `{ type, sessionId, productId?, ... }` |
| POST | `/api/feed/refresh` | Force rebuild trending cache |

### Home feed sections

- **Picked for you** — session + saved bag + category/price affinity
- **Trending in Kenya** — global behavior scores
- **Under KES 5,000** / **2,500** — price-tier rails
- **Pre-loved picks** / **Brand new drops** — condition split

## Website

- `website/assets/js/feed.js` — session ID, event POST, homepage rails
- `#feed-rails` on `index.html` — rendered above “New arrivals”
- Integrates with bag saves, product views, search

## Storage

Events: `whatsapp-bot/data/feed-events.json` (Redis-ready design; file-backed for now).

## Files

| Area | Files |
|------|--------|
| Events | `whatsapp-bot/src/services/feed-events.js` |
| Ranking | `whatsapp-bot/src/services/feed-ranking.js` |
| API | `whatsapp-bot/src/routes/feedApi.js` |
| Purchase hook | `whatsapp-bot/src/services/escrow-automation.js` |
| Website | `website/assets/js/feed.js` |

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Cloudflare Pages deploys `website/` on push.

## Test plan

- [ ] Open product sheet → `view` event logged
- [ ] Save ♡ item → `save` event; refresh feed → “Picked for you” shifts
- [ ] `GET /api/feed/home` → trending + price-tier sections
- [ ] Pay order → `purchase` boosts product in trending
- [ ] Homepage shows feed rails above new arrivals

## Next: Phase 10

Seller analytics, moderation queue UI, and Postgres-backed orders — see roadmap.
