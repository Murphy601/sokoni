# Phase 2 — Depop-Style Browse Taxonomy

Category drawer, price tiers, item-type filters, and **aesthetic / vibe chips** for the Sokoni storefront — powered by PostgreSQL + `/api/products`.

## What was added

| Path | Purpose |
|------|---------|
| `scripts/browse-taxonomy.mjs` | Women/Men/Kids/Brands/Sports/Trending/Sale/Electronics/Home + price tiers + aesthetics + legacy map |
| `scripts/build-browse-menu.mjs` | Generates `website/data/browse-menu.json` |
| `whatsapp-bot/db/schema-phase2-browse.sql` | `browse_category`, `browse_sub_category` columns |
| `whatsapp-bot/scripts/backfill-browse-categories.mjs` | Maps legacy categories → browse paths in DB |
| `website/assets/js/browse.js` | Client helpers (resolve path, enrich products, labels) |
| `website/assets/js/catalog-nav.js` | Depop-style left drawer using browse taxonomy |
| `website/assets/js/app.js` | Loads catalog from `/api/products`, browse + price + vibe filters |

## Aesthetic / vibe chips

Homepage filter bar includes `#Y2K`, `#Streetwear`, `#Vintage`, `#Clean Girl`, `#Cyberpunk`, `#Goth / Punk`, `#90s Thrift`, `#Minimalist`.

Matching uses listing `tags`, `era`, title, and description (sellers already enter tags/era on list).

## Browse categories

- **Women** — tops, dresses, jeans, shoes, bags, beauty…
- **Men** — t-shirts, hoodies, sneakers, watches…
- **Kids** — clothing, toys, baby gear
- **Brands** — sportswear, designer, local labels
- **Sports** — activewear, trainers, equipment
- **Trending in Kenya** — thrift fits, streetwear, viral bargains
- **Sale & Hot Deals** — price tier subs (Under KES 1k / 2.5k / 5k / 10k)
- **Electronics** — phones, TVs, computing, gaming
- **Home & Living** — kitchen, bedding, decor

## API (browse filters)

```
GET /api/products?browse=women&browseSub=tops&itemType=secondhand&limit=48&offset=0
GET /api/products?priceTier=under-5000
GET /api/products/browse-counts
GET /api/products/meta          → includes priceTiers
```

Query params:

| Param | Example | Effect |
|-------|---------|--------|
| `browse` | `women` | Filter `browse_category` |
| `browseSub` | `tops` | Filter `browse_sub_category` |
| `itemType` | `new` / `secondhand` | Brand new vs pre-loved |
| `priceTier` | `under-5000` | Max price KES 5,000 |
| `offset` | `48` | Pagination |
| `limit` | `48` | Page size (max 500) |

## Setup (VM)

```bash
cd ~/sokoni && git pull origin main
node scripts/build-browse-menu.mjs

cd whatsapp-bot
npm run db:migrate
npm run db:backfill-browse
bash ../scripts/deploy-bot.sh
```

Cloudflare Pages deploys the website automatically on push — no local sync needed.

## Storefront behaviour

1. **Catalog pause:** When `website/data/catalog-paused.json` has `"paused": true`, the site shows the empty refresh state — **no API or JSON products** on the public storefront.
2. **When unpaused:** loads from `/api/products` (or JSON fallback).
3. **WhatsApp bot** always uses the full master catalog + browse taxonomy (Women / Men / Sale / etc.).

## Regenerate browse menu after taxonomy edits

```bash
node scripts/build-browse-menu.mjs
git add website/data/browse-menu.json && git commit -m "chore: rebuild browse menu"
```

## Next: Phase 4

See [PHASE3_UI.md](./PHASE3_UI.md) for the mobile shop UI. Phase 4: AI listing generator (Gemini Vision).
