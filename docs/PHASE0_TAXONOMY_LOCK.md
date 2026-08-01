# Phase 0 — Locked browse taxonomy (Kilimall gaps, additive)

**Status:** Locked and implemented (Phases 1–5 on branch)  
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

1. Women *(expanded: skirts, jumpsuits, activewear, sleepwear, sunglasses)*  
2. Men *(expanded: trousers, shorts, jackets, bags)*  
3. Kids *(expanded: school-wear, accessories; shoes image is kids-scoped)*  
4. Health & Beauty *(+ nail-care, bath-body)*  
5. Brands  
6. Sports *(+ basketball, swimming, running)*  
7. Phones & Accessories *(nav alias → electronics/phones)*  
8. TV & Audio *(nav → electronics/tvs-audio)*  
9. Computers & Accessories *(nav → electronics/computing)*  
10. Appliances *(nav → electronics/appliances)*  
11. Electronics *(+ cameras, smart-home)*  
12. Home & Living *(+ furniture, lighting, storage)*  
13. Supermarket  
14. Automotive  
15. Pets *(additive)*  
16. Office & Books *(additive)*  
17. Garden & Outdoor *(additive)*  
18. Restaurant *(additive — Kenya meals/diets/dishes: nyama choma, ugali, pilau, chapati, githeri, street bites, vegan/diet bowls, juices, catering)*  
19. Trending in Kenya  
20. Sale & Hot Deals  

**Images:** `scripts/browse-category-images.mjs` → rebuild with `node scripts/build-browse-menu.mjs` (runs URL verify). Kids shoes must use path key `kids/shoes`, never women's heels.

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
