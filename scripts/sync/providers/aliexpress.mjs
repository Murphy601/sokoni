import crypto from "node:crypto";

const GATEWAY = process.env.ALIEXPRESS_GATEWAY || "https://api-sg.aliexpress.com/sync";
const APP_KEY = process.env.ALIEXPRESS_APP_KEY || "";
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || "";
const TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || process.env.ALIEXPRESS_AFFILIATE_ID || "";
const TARGET_CURRENCY = process.env.ALIEXPRESS_TARGET_CURRENCY || "USD";
const TARGET_LANGUAGE = process.env.ALIEXPRESS_TARGET_LANGUAGE || "EN";

export const name = "aliexpress";

export function isConfigured() {
  return Boolean(APP_KEY && APP_SECRET);
}

/**
 * Resolves an AliExpress numeric product id — either an explicit `externalId`
 * field or parsed from a /item/<id>.html URL.
 */
export function resolveProductId(item) {
  if (item.externalId) return String(item.externalId);
  const match = /\/item\/(\d+)/.exec(item.sourceUrl || "");
  return match ? match[1] : null;
}

/**
 * TOP/IOP-style signature: sort params by key, concatenate `key+value`, then
 * HMAC-SHA256 with the app secret and uppercase-hex the result.
 *
 * NOTE: AliExpress has revised its signing/gateway a few times — verify against
 * the current Open Platform docs for your app if calls return an auth error.
 */
function sign(params) {
  const base = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return crypto.createHmac("sha256", APP_SECRET).update(base, "utf8").digest("hex").toUpperCase();
}

/**
 * Returns Map<productId, update> where update is { priceUsd?, inStock? }.
 */
export async function fetchUpdates(items, log) {
  if (!isConfigured()) {
    log.skip(name, "missing ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET");
    return new Map();
  }

  const extToProductId = new Map();
  for (const item of items) {
    const ext = resolveProductId(item);
    if (ext) extToProductId.set(ext, item.id);
    else log.warn(name, `no product id for ${item.id} — add an "externalId" field or a /item/<id>.html sourceUrl`);
  }

  const ids = [...extToProductId.keys()];
  const updates = new Map();

  // productdetail.get accepts a comma-separated batch of ids.
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    try {
      const products = await productDetail(batch);
      for (const product of products) {
        const productId = extToProductId.get(String(product.product_id));
        if (!productId) continue;
        const price = parseFloat(
          product.target_sale_price ?? product.target_app_sale_price ?? product.sale_price
        );
        updates.set(productId, {
          ...(Number.isFinite(price) ? { priceUsd: price } : {}),
          inStock: true,
        });
      }
    } catch (err) {
      log.error(name, err.message);
    }
  }

  return updates;
}

async function productDetail(ids) {
  const params = {
    app_key: APP_KEY,
    method: "aliexpress.affiliate.productdetail.get",
    sign_method: "sha256",
    timestamp: String(Date.now()),
    v: "2.0",
    format: "json",
    product_ids: ids.join(","),
    target_currency: TARGET_CURRENCY,
    target_language: TARGET_LANGUAGE,
    fields: "product_id,target_sale_price,product_detail_url",
    ...(TRACKING_ID ? { tracking_id: TRACKING_ID } : {}),
  };
  params.sign = sign(params);

  const url = `${GATEWAY}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AliExpress API HTTP ${res.status}`);
  if (data.error_response) {
    throw new Error(`AliExpress API: ${data.error_response.msg || JSON.stringify(data.error_response)}`);
  }

  const resp = data.aliexpress_affiliate_productdetail_get_response || data;
  const result = resp?.resp_result?.result || resp?.result;
  const products = result?.products?.product;
  return Array.isArray(products) ? products : [];
}
