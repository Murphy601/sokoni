# Phase 0 — Locked browse taxonomy (Kilimall gaps, additive)

**Status:** Locked for implementation  
**Rule:** Add missing categories. Do **not** remove existing browse IDs, Brands, Trending, Sale, or Women/Men/Kids gender split.  
**Stack:** Vanilla HTML/JS + `scripts/browse-taxonomy.mjs` → `website/data/browse-menu.json`. No React/Prisma for this work.

## Decisions locked

| Topic | Decision |
|--------|----------|
| Women / Men / Kids | **Keep** gender-split fashion (Depop-style) |
| Brands | **Keep** as top-level browse category |
| Trending in Kenya | **Keep** |
| Sale & Hot Deals | **Keep** (price-tier subs) |
| Shoes / Bags / Watches & Jewellery | **Stay under gender cats** (no extra top-level — avoids duplicate nav) |
| Health & Beauty | **Add** top-level; keep `women/beauty` as alias |
| Supermarket | **Add** top-level; keep `home/supermarket` as alias |
| Automotive | **Add** new top-level + subs |
| Electronics | **Keep** parent; **also add** top-level Phones, TV & Audio, Computers, Appliances that alias to existing `electronics/*` paths |
| Sports | **Expand** subs; keep Activewear / Trainers / Equipment |
| Icons | Optional `image` + **emoji fallback** |
| Mega menu | Desktop hover flyout; **keep** mobile drawer |
| Design | Sokoni tokens (cream / green) — not Kilimall black sample |

## Target top-level order (browse)

1. Women  
2. Men  
3. Kids  
4. Health & Beauty *(new)*  
5. Brands  
6. Sports *(expanded subs)*  
7. Phones & Accessories *(new top-level alias → electronics/phones)*  
8. TV & Audio *(new → electronics/tvs-audio)*  
9. Computers & Accessories *(new → electronics/computing)*  
10. Appliances *(new → electronics/appliances)*  
11. Electronics *(keep — all existing subs incl. Gaming)*  
12. Home & Living *(keep kitchen/bedding/decor; supermarket sub stays as alias)*  
13. Supermarket *(new top-level)*  
14. Automotive *(new)*  
15. Trending in Kenya  
16. Sale & Hot Deals  

## New / expanded subcategory IDs

### `health-beauty` (new top-level)
- `skincare`, `makeup`, `haircare`, `fragrances`, `personal-care`, `mens-grooming`

### `supermarket` (new top-level)
- `food-staples`, `beverages`, `household`, `personal-grocery`  
  (Products mapped from legacy `supermarket` land on a default sub, e.g. `food-staples`.)

### `automotive` (new)
- `car-accessories`, `oils-fluids`, `tyres-wheels`, `motorbike`, `tools-care`

### Electronics alias tops (filter via existing browse paths)
| New top-level id | Resolves products as |
|------------------|----------------------|
| `phones` | `electronics` + `phones` |
| `tv-audio` | `electronics` + `tvs-audio` |
| `computers` | `electronics` + `computing` |
| `appliances-home` | `electronics` + `appliances` |

Canonical product columns stay `browse_category=electronics` + existing subs. Alias tops are **nav-only** shortcuts that set the same filter.

### `sports` (keep + add)
Keep: `activewear`, `trainers`, `equipment`  
Add: `gym-fitness`, `outdoor`, `football`, `cycling`

## Alias / legacy rules (Phase 2)

- `health-beauty*` → `health-beauty` + matching sub (not only `women/beauty`)
- `women/beauty` remains valid; nav and old links keep working
- `supermarket` → `supermarket` top-level (default sub)
- `home/supermarket` remains valid alias
- Automotive has no legacy source until listings exist
- Electronics legacy paths unchanged (`phones-tablets` → `electronics/phones`, etc.)

## Out of scope for this lock

- Removing Brands or converting to filter-only  
- Prisma Category / SubGroup tables  
- React/Next mega menu rewrite  
- Replacing emoji before image assets exist  

## Implementation order

0. This lock (done)  
1. Taxonomy JSON source + rebuild  
2. Legacy map + backfill  
3. Desktop mega menu  
4. Optional images + emoji fallback  
5. Groups polish, catalog-taxonomy sync, docs  
