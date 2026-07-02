import { signRequest } from "../lib/sigv4.mjs";

const HOST = process.env.AMAZON_HOST || "webservices.amazon.com";
const REGION = process.env.AMAZON_REGION || "us-east-1";
const MARKETPLACE = process.env.AMAZON_MARKETPLACE || "www.amazon.com";
const ACCESS = process.env.AMAZON_ACCESS_KEY || "";
const SECRET = process.env.AMAZON_SECRET_KEY || "";
const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG || process.env.AMAZON_AFFILIATE_TAG || "";

export const name = "amazon";

export function isConfigured() {
  return Boolean(ACCESS && SECRET && PARTNER_TAG);
}

/**
 * Resolves a product's ASIN — either an explicit `asin` field, or parsed from a
 * standard /dp/<ASIN> Amazon URL.
 */
export function resolveAsin(item) {
  if (item.asin) return item.asin;
  const match = /\/dp\/([A-Z0-9]{10})/i.exec(item.sourceUrl || "");
  return match ? match[1].toUpperCase() : null;
}

/**
 * Returns Map<productId, update> where update is { priceUsd?, inStock? }.
 * PA-API only exposes price + availability (not rating/review counts anymore).
 */
export async function fetchUpdates(items, log) {
  if (!isConfigured()) {
    log.skip(name, "missing AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_PARTNER_TAG");
    return new Map();
  }

  const asinToProductId = new Map();
  for (const item of items) {
    const asin = resolveAsin(item);
    if (asin) asinToProductId.set(asin, item.id);
    else log.warn(name, `no ASIN for ${item.id} — add an "asin" field or a /dp/<ASIN> sourceUrl`);
  }

  const asins = [...asinToProductId.keys()];
  const updates = new Map();

  // GetItems accepts up to 10 ASINs per call.
  for (let i = 0; i < asins.length; i += 10) {
    const batch = asins.slice(i, i + 10);
    try {
      const results = await getItems(batch);
      for (const result of results) {
        const productId = asinToProductId.get(result.asin);
        if (productId) updates.set(productId, result.update);
      }
    } catch (err) {
      log.error(name, err.message);
    }
  }

  return updates;
}

async function getItems(asins) {
  const uri = "/paapi5/getitems";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems";
  const payload = JSON.stringify({
    ItemIds: asins,
    ItemIdType: "ASIN",
    Resources: [
      "Offers.Listings.Price",
      "Offers.Listings.Availability.Type",
      "Offers.Listings.Availability.Message",
    ],
    PartnerTag: PARTNER_TAG,
    PartnerType: "Associates",
    Marketplace: MARKETPLACE,
  });

  const headers = signRequest({
    host: HOST,
    region: REGION,
    service: "ProductAdvertisingAPI",
    uri,
    target,
    payload,
    accessKey: ACCESS,
    secretKey: SECRET,
  });

  const res = await fetch(`https://${HOST}${uri}`, { method: "POST", headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.Errors ? JSON.stringify(data.Errors) : `HTTP ${res.status}`;
    throw new Error(`PA-API GetItems failed: ${detail}`);
  }

  const out = [];
  for (const item of data.ItemsResult?.Items || []) {
    const listing = item.Offers?.Listings?.[0];
    const price = listing?.Price?.Amount;
    const availabilityType = listing?.Availability?.Type;
    out.push({
      asin: item.ASIN,
      update: {
        ...(typeof price === "number" ? { priceUsd: price } : {}),
        ...(availabilityType ? { inStock: availabilityType === "Now" } : {}),
      },
    });
  }
  return out;
}
