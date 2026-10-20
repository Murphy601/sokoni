/**
 * Nested category / subcategory tree for storefront nav.
 * One GROUP BY on products (not N+1), then merge labels from browse-menu.json.
 * In-memory TTL so Neon is not hit on every mega-menu render.
 */
import { isDbEnabled, query } from "../db/pool.js";
import { loadBrowseMenuData } from "./browse-menu.js";

const CACHE_TTL_MS = 60 * 60 * 1000;

let cachedTree = null;
let cachedAtMs = 0;

export function invalidateCategoryCache() {
  cachedTree = null;
  cachedAtMs = 0;
}

function nestFromRows(rows, { idKey, nameKey, subIdKey, subNameKey }) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row[idKey] || "").trim();
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: String(row[nameKey] || id),
        slug: id,
        count: 0,
        subcategories: [],
      });
    }
    const cat = map.get(id);
    const n = Number(row.n) || 0;
    cat.count += n;
    const subId = row[subIdKey] ? String(row[subIdKey]).trim() : "";
    if (subId) {
      cat.subcategories.push({
        id: subId,
        name: String(row[subNameKey] || subId),
        slug: subId,
        count: n,
      });
    }
  }
  return [...map.values()];
}

async function loadLiveCounts() {
  if (!isDbEnabled()) {
    return { categories: [], browse: [] };
  }
  try {
  const [legacy, browse] = await Promise.all([
    query(
      `SELECT category AS category_id, category AS category_name,
              sub_category AS subcategory_id, sub_category AS subcategory_name,
              COUNT(*)::int AS n
         FROM products
        WHERE in_stock = TRUE AND is_sold = FALSE
        GROUP BY category, sub_category
        ORDER BY category, sub_category`
    ),
    query(
      `SELECT browse_category AS category_id, browse_category AS category_name,
              browse_sub_category AS subcategory_id, browse_sub_category AS subcategory_name,
              COUNT(*)::int AS n
         FROM products
        WHERE in_stock = TRUE AND is_sold = FALSE
          AND browse_category IS NOT NULL
        GROUP BY browse_category, browse_sub_category
        ORDER BY browse_category, browse_sub_category`
    ),
  ]);
  return {
    categories: nestFromRows(legacy.rows, {
      idKey: "category_id",
      nameKey: "category_name",
      subIdKey: "subcategory_id",
      subNameKey: "subcategory_name",
    }),
    browse: nestFromRows(browse.rows, {
      idKey: "category_id",
      nameKey: "category_name",
      subIdKey: "subcategory_id",
      subNameKey: "subcategory_name",
    }),
  };
  } catch (err) {
    console.warn("[category-tree] live counts skipped:", err.message);
    return { categories: [], browse: [] };
  }
}

function attachMenu(browseCounts, menu) {
  const countByCat = new Map((browseCounts || []).map((c) => [c.id, c]));
  return (menu.categories || []).map((cat) => {
    const live = countByCat.get(cat.id);
    const subCount = new Map((live?.subcategories || []).map((s) => [s.id, s.count]));
    return {
      id: cat.id,
      name: cat.label || cat.id,
      slug: cat.id,
      label: cat.label || cat.id,
      emoji: cat.emoji || null,
      image: cat.image || null,
      navOnly: Boolean(cat.navOnly),
      resolvesTo: cat.resolvesTo || null,
      count: live?.count || 0,
      subcategories: (cat.subcategories || []).map((sub) => ({
        id: sub.id,
        name: sub.label || sub.id,
        slug: sub.id,
        label: sub.label || sub.id,
        image: sub.image || null,
        resolvesTo: sub.resolvesTo || null,
        priceTier: sub.priceTier || null,
        count: subCount.get(sub.id) || 0,
      })),
    };
  });
}

async function buildTree() {
  const [menu, live] = await Promise.all([loadBrowseMenuData(), loadLiveCounts()]);
  return {
    version: menu.version || null,
    cached: false,
    categories: attachMenu(live.browse, menu),
    legacyCategories: live.categories,
  };
}

export async function getCategoryTree({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedTree && now - cachedAtMs < CACHE_TTL_MS) {
    return { ...cachedTree, cached: true };
  }
  const tree = await buildTree();
  cachedTree = tree;
  cachedAtMs = now;
  return tree;
}

export function categoryTreeCacheControl() {
  return "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400";
}
