/**
 * Kenya geographic fulfillment routing — local boda OTP vs seller-managed courier.
 */

/** Motorbike rider coverage (Nairobi metro / Kiambu / Athi River corridor). */
export const LOCAL_RIDER_ZONES = new Set([
  "NAIROBI",
  "KIAMBU",
  "MACHAKOS", // Athi River / Syokimau / Mavoko treated as metro when town matches
]);

/** Towns that count as local metro even when county string is ambiguous. */
const LOCAL_METRO_TOWNS = new Set([
  "THIKA",
  "RUIRU",
  "JUJA",
  "RUAKA",
  "KIKUYU",
  "KARURI",
  "GITHURAI",
  "SYOKIMAU",
  "ATHI RIVER",
  "ATHI-RIVER",
  "MAVOKO",
  "KITENGELA",
  "MLORONGO",
  "ONGATA RONGAI",
  "RONGAI",
  "NGONG",
  "KAHAWA",
  "ROYSAMBU",
  "KASARANI",
  "EMBAKASI",
  "WESTLANDS",
  "CBD",
  "NAIROBI CBD",
]);

export const FULFILLMENT_LOCAL_RIDER = "LOCAL_RIDER";
export const FULFILLMENT_SELLER_COURIER = "SELLER_COURIER";

export function normalizeCountyKey(raw) {
  let s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
  if (!s) return "";
  if (s === "NBI" || s === "NRB" || s.startsWith("NAIROBI")) return "NAIROBI";
  if (s === "THK" || s === "THIKA" || s === "THIKA METRO") return "KIAMBU";
  if (s.includes("KIAMBU")) return "KIAMBU";
  if (s.includes("MACHAKOS")) return "MACHAKOS";
  return s.split(" ")[0] || s;
}

export function normalizeTownKey(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLocalRiderZone(countyKey, townKey = "") {
  const c = normalizeCountyKey(countyKey);
  const t = normalizeTownKey(townKey);
  if (LOCAL_METRO_TOWNS.has(t)) return true;
  if (c === "NAIROBI" || c === "KIAMBU") return true;
  if (c === "MACHAKOS" && (LOCAL_METRO_TOWNS.has(t) || !t)) return true;
  return false;
}

/**
 * @param {{
 *   sellerCounty?: string,
 *   buyerCounty?: string,
 *   sellerTown?: string,
 *   buyerTown?: string,
 *   sellerLocationText?: string,
 *   buyerLocationText?: string,
 * }} locs
 */
export function evaluateFulfillmentMode(locs = {}) {
  let sellerCounty = normalizeCountyKey(locs.sellerCounty);
  let buyerCounty = normalizeCountyKey(locs.buyerCounty);
  const sellerTown = normalizeTownKey(locs.sellerTown);
  const buyerTown = normalizeTownKey(locs.buyerTown);

  // Infer from free text when county missing (lazy import avoided — caller can pre-infer).
  if (!sellerCounty && locs.sellerLocationText) {
    sellerCounty = guessCountyFromBlob(locs.sellerLocationText);
  }
  if (!buyerCounty && locs.buyerLocationText) {
    buyerCounty = guessCountyFromBlob(locs.buyerLocationText);
  }

  // Default seller hub to Nairobi when unknown (most Sokoni sellers).
  if (!sellerCounty) sellerCounty = "NAIROBI";

  const sellerLocal = isLocalRiderZone(sellerCounty, sellerTown || locs.sellerLocationText);
  const buyerLocal = isLocalRiderZone(buyerCounty, buyerTown || locs.buyerLocationText);

  if (sellerLocal && buyerLocal) {
    return {
      mode: FULFILLMENT_LOCAL_RIDER,
      fulfillmentMode: FULFILLMENT_LOCAL_RIDER,
      requiresRider: true,
      escrowHoldMinutes: 15,
      escrowHoldHours: null,
      autoReleaseHours: 24,
      description: "Instant motorbike rider with 2-stage OTP verification",
      sellerCounty,
      buyerCounty,
    };
  }

  return {
    mode: FULFILLMENT_SELLER_COURIER,
    fulfillmentMode: FULFILLMENT_SELLER_COURIER,
    requiresRider: false,
    escrowHoldMinutes: null,
    escrowHoldHours: 48,
    autoReleaseHours: 48,
    description: "Seller self-dispatches via courier / parcel sacco (waybill)",
    sellerCounty,
    buyerCounty,
  };
}

function guessCountyFromBlob(text) {
  const u = String(text || "").toUpperCase();
  if (/\bNAIROBI\b|\bWESTLANDS\b|\bKILIMANI\b|\bEMBAKASI\b/.test(u)) return "NAIROBI";
  if (/\bKIAMBU\b|\bTHIKA\b|\bRUIRU\b|\bJUJA\b|\bRUAKA\b/.test(u)) return "KIAMBU";
  if (/\bMACHAKOS\b|\bSYOKIMAU\b|\bATHI\s*RIVER\b|\bKITENGELA\b/.test(u)) return "MACHAKOS";
  if (/\bMOMBASA\b/.test(u)) return "MOMBASA";
  if (/\bKISUMU\b/.test(u)) return "KISUMU";
  if (/\bNAKURU\b/.test(u)) return "NAKURU";
  if (/\bELDORET\b|\bUASIN\b/.test(u)) return "UASIN GISHU";
  return "";
}
