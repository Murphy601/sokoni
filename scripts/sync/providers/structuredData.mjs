const ENABLED = String(process.env.SOKONI_ENABLE_SCRAPE || "").toLowerCase() === "true";
const UA = process.env.SOKONI_SCRAPE_UA || "SokoniCatalogBot/1.0 (+https://github.com/Murphy601/sokoni)";
const TIMEOUT_MS = Number(process.env.SOKONI_SCRAPE_TIMEOUT_MS) || 15000;

export const name = "structured-data";

/**
 * Kilimall / Jumia / Temu have no public affiliate product API, so the only
 * "automatable" option is reading schema.org Product JSON-LD off the public
 * product page. This is best-effort and ToS/robots-sensitive, so it is OFF by
 * default and only runs when SOKONI_ENABLE_SCRAPE=true.
 */
export function isConfigured() {
  return ENABLED;
}

export async function fetchUpdates(items, log) {
  if (!ENABLED) {
    log.skip(
      name,
      "disabled — set SOKONI_ENABLE_SCRAPE=true to read JSON-LD from product pages (verify each site's ToS/robots.txt first)"
    );
    return new Map();
  }

  const updates = new Map();
  for (const item of items) {
    if (!item.sourceUrl) continue;
    try {
      const info = await fetchProduct(item.sourceUrl);
      if (info && Object.keys(info).length > 0) updates.set(item.id, info);
      else log.warn(name, `no usable structured data at ${item.sourceUrl} (${item.id})`);
    } catch (err) {
      log.error(name, `${item.id}: ${err.message}`);
    }
  }
  return updates;
}

async function fetchProduct(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const blocks = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ].map((m) => m[1]);

  for (const block of blocks) {
    let json;
    try {
      json = JSON.parse(block.trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(json) ? json : json["@graph"] || [json];
    for (const node of nodes) {
      const types = [].concat(node["@type"] || []);
      if (!types.includes("Product")) continue;

      const offer = [].concat(node.offers || [])[0];
      const update = {};

      if (offer) {
        const price = parseFloat(offer.price ?? offer.lowPrice);
        const currency = String(offer.priceCurrency || "").toUpperCase();
        if (Number.isFinite(price)) {
          if (currency === "KES") update.priceKes = Math.round(price);
          else if (currency === "USD") update.priceUsd = price;
        }
        const availability = String(offer.availability || "");
        if (/InStock/i.test(availability)) update.inStock = true;
        else if (/OutOfStock|SoldOut|Discontinued/i.test(availability)) update.inStock = false;
      }

      const rating = parseFloat(node.aggregateRating?.ratingValue);
      const reviews = parseInt(node.aggregateRating?.reviewCount ?? node.aggregateRating?.ratingCount, 10);
      if (Number.isFinite(rating)) update.rating = rating;
      if (Number.isInteger(reviews)) update.reviews = reviews;

      if (Object.keys(update).length > 0) return update;
    }
  }
  return null;
}
