# Phase 2 — Depop-Style Browse Taxonomy

Category drawer, **desktop mega menu**, price tiers, item-type filters, and **aesthetic / vibe chips** for the Sokoni storefront — powered by PostgreSQL + `/api/products`.

Taxonomy lock (Kilimall gaps, additive): see [PHASE0_TAXONOMY_LOCK.md](./PHASE0_TAXONOMY_LOCK.md).

## What was added

| Path | Purpose |
|------|---------|
| `scripts/browse-taxonomy.mjs` | Browse tree + price tiers + aesthetics + legacy map + `resolvesTo` / `navOnly` / images / mega groups |
| `scripts/build-browse-menu.mjs` | Generates `website/data/browse-menu.json` |
| `whatsapp-bot/db/schema-phase2-browse.sql` | `browse_category`, `browse_sub_category` columns |
| `whatsapp-bot/scripts/backfill-browse-categories.mjs` | Maps legacy categories → browse paths (+ stale women/beauty & home/supermarket migration) |
| `website/assets/js/browse.js` | Client helpers (resolve path, nav filter aliases, labels) |
| `website/assets/js/catalog-nav.js` | Mobile / narrow left drawer |
| `website/assets/js/mega-menu.js` | Desktop (≥900px) hover flyout |
| `website/assets/js/app.js` | Loads catalog from `/api/products`, browse + price + vibe filters |
| `website/assets/images/categories/` | Optional category thumbnails (emoji fallback) |

## Browse categories (additive)

- **Women / Men / Kids** — gender-split fashion (kept)
- **Health & Beauty** — skincare, makeup, haircare, fragrances, personal care, men's grooming
- **Brands** — sportswear, designer, local labels (kept)
- **Sports** — activewear, trainers, equipment + gym, outdoor, football, cycling
- **Phones & Accessories / TV & Audio / Computers / Appliances** — nav aliases → `electronics/*`
- **Electronics** — phones, TVs, computing, gaming, appliances (kept)
- **Home & Living** — kitchen, bedding, decor (+ supermarket alias)
- **Supermarket** — food staples, beverages, household, personal grocery
- **Automotive** — car accessories, oils, tyres, motorbike, tools
- **Trending in Kenya** / **Sale & Hot Deals** — kept differentiators

## Aesthetic / vibe chips

Homepage filter bar includes `#Y2K`, `#Streetwear`, `#Vintage`, `#Clean Girl`, `#Cyberpunk`, `#Goth / Punk`, `#90s Thrift`, `#Minimalist`.

Matching uses listing `tags`, `era`, title, and description (sellers already enter tags/era on list).

## API (browse filters)

```
GET /api/products?browse=women&browseSub=tops&itemType=secondhand&limit=48&offset=0
GET /api/products?browse=phones
GET /api/products?priceTier=under-5000
GET /api/products/browse-counts
GET /api/products/meta          → includes priceTiers
```

Nav aliases (e.g. `browse=phones`) resolve server-side to canonical `electronics/phones`.

| Param | Example | Effect |
|-------|---------|--------|
| `browse` | `women` | Filter `browse_category` (or alias → canonical) |
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

After this taxonomy change, **re-run** `npm run db:backfill-browse` so Health & Beauty and Supermarket products leave `women/beauty` / `home/supermarket`.

## Storefront behaviour

1. **Catalog pause:** When `website/data/catalog-paused.json` has `"paused": true`, the site shows the empty refresh state — **no API or JSON products** on the public storefront.
2. **When unpaused:** loads from `/api/products` (or JSON fallback).
3. **WhatsApp bot** always uses the full master catalog + browse taxonomy.
4. **Desktop:** permanent category rail beside the hero banner; hover opens subcategory flyout over the banner (Kilimall-style). **Mobile:** left drawer via hamburger (rail hidden).

## Regenerate browse menu after taxonomy edits

```bash
node scripts/build-browse-menu.mjs
git add website/data/browse-menu.json && git commit -m "chore: rebuild browse menu"
```

## Next: Phase 4 listing / Phase 3 UI

See [PHASE3_UI.md](./PHASE3_UI.md) for the mobile shop UI. Phase 4: AI listing generator (Gemini Vision).
