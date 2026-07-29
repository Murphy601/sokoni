/**
 * Phase 8 — Trending & personalized feed ranking from behavior signals.
 */
import { searchProducts } from "./catalog.js";
import { listFeedEvents, eventsForSession, logFeedEvent } from "./feed-events.js";

const WEIGHTS = {
  view: 1,
  click: 3,
  save: 5,
  unsave: -2,
  purchase: 10,
  category: 2,
  search: 1,
};

const PRICE_TIERS = {
  under2500: 2500,
  under5000: 5000,
  under10000: 10000,
};

let cache = { builtAt: 0, trending: [], under5000: [], preloved: [], ttlMs: 15 * 60_000 };

function decay(at, now = Date.now()) {
  const ageH = (now - at) / 3_600_000;
  return Math.exp(-ageH / 72);
}

/** Boost recently bumped / refreshed listings toward the top of feeds. */
function recencyBoost(product, now = Date.now()) {
  const ts = Number(
    product?.refreshedAt ||
      product?.publishedAt ||
      (product?.updatedAt ? Date.parse(product.updatedAt) : 0) ||
      (product?.createdAt ? Date.parse(product.createdAt) : 0) ||
      0
  );
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  const ageH = Math.max(0, (now - ts) / 3_600_000);
  // Strong for ~48h after bump, fades over ~5 days
  return Math.max(0, 10 * Math.exp(-ageH / 36));
}

function scoreProduct(productId, events, now = Date.now()) {
  let score = 0;
  for (const e of events) {
    if (e.productId !== productId) continue;
    score += (WEIGHTS[e.type] || 0) * decay(e.at, now);
  }
  return score;
}

function toPublicProduct(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    priceKes: p.priceKes,
    rating: p.rating,
    reviews: p.reviews,
    isSecondhand: Boolean(p.isSecondhand),
    condition: p.condition,
    category: p.category,
    browseCategory: p.browseCategory,
    imageUrl: p.imageUrl,
    inStock: p.inStock !== false,
    tags: (p.tags || []).slice(0, 5),
    era: p.era || undefined,
    refreshedAt: p.refreshedAt || undefined,
    updatedAt: p.updatedAt || undefined,
  };
}

async function loadStoreProducts() {
  const products = await searchProducts({ scope: "local", fulfillment: "store", limit: 500 });
  return products.filter((p) => p.inStock !== false);
}

function rankProducts(products, events, { limit = 12, filter = null, boost = null } = {}) {
  const now = Date.now();
  const scored = products
    .filter((p) => (filter ? filter(p) : true))
    .map((p) => {
      let s = scoreProduct(p.id, events, now);
      s += (Number(p.rating) || 0) * 0.4;
      s += Math.min(Number(p.reviews) || 0, 500) * 0.002;
      s += recencyBoost(p, now);
      if (boost) s += boost(p);
      return { product: p, score: s };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((x) => toPublicProduct(x.product));
}

function sessionPreferences(sessionEvents, savedIds = [], products = []) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const categories = new Map();
  const prices = [];
  let secondhandBias = 0;

  const ids = new Set([
    ...savedIds,
    ...sessionEvents.filter((e) => e.productId).map((e) => e.productId),
  ]);

  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const cat = p.browseCategory || p.category || "general";
    categories.set(cat, (categories.get(cat) || 0) + 1);
    if (Number.isFinite(Number(p.priceKes))) prices.push(Number(p.priceKes));
    if (p.isSecondhand) secondhandBias += 1;
    else secondhandBias -= 0.5;
  }

  prices.sort((a, b) => a - b);
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null;

  return { categories, medianPrice, secondhandBias };
}

function buildForYou(products, sessionEvents, savedIds = []) {
  const prefs = sessionPreferences(sessionEvents, savedIds, products);
  const hasSignal = prefs.categories.size > 0 || savedIds.length > 0 || sessionEvents.length > 0;

  if (!hasSignal) {
    return rankProducts(products, listFeedEvents({ sinceMs: Date.now() - 7 * 86_400_000 }), { limit: 8 });
  }

  return rankProducts(products, sessionEvents, {
    limit: 8,
    boost: (p) => {
      let b = 0;
      const cat = p.browseCategory || p.category;
      if (cat && prefs.categories.has(cat)) b += prefs.categories.get(cat) * 2;
      if (prefs.medianPrice && Number(p.priceKes)) {
        const diff = Math.abs(Number(p.priceKes) - prefs.medianPrice);
        b += Math.max(0, 3 - diff / 2000);
      }
      if (prefs.secondhandBias > 0 && p.isSecondhand) b += 2;
      if (prefs.secondhandBias < 0 && !p.isSecondhand) b += 1;
      if (savedIds.includes(p.id)) b += 4;
      return b;
    },
  });
}

/** Rebuild global trending slices (cron / on demand). */
export async function refreshFeedCache() {
  const events = listFeedEvents({ sinceMs: Date.now() - 7 * 86_400_000, limit: 5000 });
  const products = await loadStoreProducts();

  cache = {
    builtAt: Date.now(),
    ttlMs: cache.ttlMs,
    trending: rankProducts(products, events, { limit: 12 }),
    under2500: rankProducts(products, events, {
      limit: 10,
      filter: (p) => Number(p.priceKes) <= PRICE_TIERS.under2500,
    }),
    under5000: rankProducts(products, events, {
      limit: 10,
      filter: (p) => Number(p.priceKes) <= PRICE_TIERS.under5000,
    }),
    preloved: rankProducts(products, events, {
      limit: 10,
      filter: (p) => p.isSecondhand || p.condition === "gently_used" || p.condition === "like_new",
    }),
    brandNew: rankProducts(products, events, {
      limit: 10,
      filter: (p) => !p.isSecondhand,
    }),
  };

  return cache;
}

async function ensureCache() {
  if (!cache.builtAt || Date.now() - cache.builtAt > cache.ttlMs) {
    await refreshFeedCache();
  }
  return cache;
}

/** Home feed payload for website. */
export async function buildHomeFeed({ sessionId = "", savedIds = [] } = {}) {
  await ensureCache();
  const products = await loadStoreProducts();
  const sessionEvents = sessionId ? eventsForSession(sessionId, 150) : [];
  const globalEvents = listFeedEvents({ sinceMs: Date.now() - 7 * 86_400_000, limit: 3000 });

  const forYou = buildForYou(products, [...sessionEvents, ...globalEvents.slice(0, 50)], savedIds);

  return {
    builtAt: cache.builtAt,
    sections: {
      forYou: { title: "Picked for you", products: forYou },
      trending: { title: "Trending in Kenya", products: cache.trending },
      under5000: { title: "Under KES 5,000", products: cache.under5000 },
      under2500: { title: "Under KES 2,500", products: cache.under2500 },
      preloved: { title: "Pre-loved picks", products: cache.preloved },
      brandNew: { title: "Brand new drops", products: cache.brandNew },
    },
    personalized: Boolean(sessionId && (sessionEvents.length > 0 || savedIds.length > 0)),
  };
}

export function feedMeta() {
  return {
    phase: 8,
    eventTypes: Object.keys(WEIGHTS),
    endpoints: {
      home: "/api/feed/home",
      event: "/api/feed/event",
      meta: "/api/feed/meta",
    },
    priceTiers: Object.keys(PRICE_TIERS),
  };
}

export function recordPurchaseFeedEvent(order) {
  if (!order?.productId) return;
  logFeedEvent({
    type: "purchase",
    productId: order.productId,
    sessionId: order.customerKey || null,
    meta: { orderId: order.id, priceKes: order.priceKes },
  });
}
