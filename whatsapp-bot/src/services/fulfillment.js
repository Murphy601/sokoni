import { config } from "../config.js";
import { listPickupPoints } from "./pickupPoints.js";
import { updateOrderMeta } from "./orders.js";

/** Nairobi & environs — rider delivery to customer address. */
const HOME_DELIVERY_TOKENS = [
  "nairobi",
  "westlands",
  "kilimani",
  "karen",
  "langata",
  "kasarani",
  "ruaka",
  "ruiru",
  "kiambu",
  "rongai",
  "ngong",
  "kitengela",
  "embakasi",
  "donholm",
  "buruburu",
  "parklands",
  "lavington",
  "kileleshwa",
  "eastleigh",
  "umoja",
  "kayole",
  "south b",
  "south c",
  "syokimau",
  "athi river",
  "machakos town",
  "thika town",
  "thika",
  "juja",
  "wangige",
  "githurai",
  "kahawa",
  "roysambu",
  "pipeline",
  "tassia",
  "komarock",
];

function normalizeLocationText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesToken(haystack, token) {
  if (!token || token.length < 3) return false;
  if (haystack.includes(token)) return true;
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(haystack);
}

function scorePickupPoint(locationText, point) {
  const loc = normalizeLocationText(locationText);
  if (!loc) return 0;

  let score = 0;
  const city = normalizeLocationText(point.city);
  const county = normalizeLocationText(point.county);
  const landmark = normalizeLocationText(point.landmark);
  const address = normalizeLocationText(point.address);

  if (city && includesToken(loc, city)) score += 55;
  if (county && includesToken(loc, county)) score += 18;
  if (landmark && landmark.length > 3 && includesToken(loc, landmark)) score += 42;
  if (address) {
    for (const token of address.split(" ").filter((w) => w.length > 3)) {
      if (includesToken(loc, token)) score += 12;
    }
  }
  for (const token of city.split(" ").filter((w) => w.length > 3)) {
    if (includesToken(loc, token)) score += 28;
  }

  return score;
}

export function isHomeDeliveryArea(locationText) {
  const loc = normalizeLocationText(locationText);
  if (!loc) return false;
  return HOME_DELIVERY_TOKENS.some((token) => includesToken(loc, token));
}

/** Rank pickup points for a customer location (best first). */
export function rankPickupPointsForLocation(locationText, limit = 5) {
  return listPickupPoints()
    .map((point) => ({ point, score: scorePickupPoint(locationText, point) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function findBestPickupPoint(locationText) {
  const ranked = rankPickupPointsForLocation(locationText, 1);
  if (!ranked.length) return null;
  const best = ranked[0];
  if (best.score < 28) return null;
  return best;
}

/**
 * Decide how an order should be fulfilled from the customer's location text.
 * - Strong pickup match outside Nairobi → pickup point
 * - Strong pickup match in town (e.g. Kenol) → pickup point
 * - Nairobi metro without pickup → home delivery
 * - Otherwise → admin assigns pickup or courier
 */
export function planFulfillment(locationText) {
  const pickup = findBestPickupPoint(locationText);
  const homeEligible = isHomeDeliveryArea(locationText);

  if (pickup && pickup.score >= 40) {
    return {
      mode: "pickup_point",
      pickupPoint: pickup.point,
      confidence: pickup.score,
      reason: "nearest_pickup_partner",
    };
  }

  if (homeEligible && (!pickup || pickup.score < 35)) {
    return {
      mode: "home_delivery",
      pickupPoint: null,
      confidence: null,
      reason: "nairobi_metro_delivery",
    };
  }

  if (pickup) {
    return {
      mode: "pickup_point",
      pickupPoint: pickup.point,
      confidence: pickup.score,
      reason: "regional_pickup_partner",
    };
  }

  return {
    mode: "pending_assignment",
    pickupPoint: null,
    confidence: null,
    reason: "no_match_yet",
  };
}

export function pickupMetaFromPoint(point) {
  if (!point) return {};
  return {
    deliveryMode: "pickup_point",
    pickupPointId: point.id,
    pickupPointName: point.shopName,
    pickupPointPhone: point.phone,
    pickupPointCity: point.city,
    pickupPointCounty: point.county,
    pickupPointAddress: point.address,
    pickupPointLandmark: point.landmark || "",
    pickupPointHours: point.openingHours || "",
    fulfillmentStoreId: point.id,
    fulfillmentStoreName: point.shopName,
    fulfillmentStorePhone: point.phone,
    fulfillmentStoreCity: point.city,
    pickupAssignedAt: Date.now(),
  };
}

/** Apply auto-matched fulfillment plan to an order (returns fresh order fields). */
export function applyFulfillmentPlan(orderId, plan) {
  if (!orderId || !plan) return null;

  if (plan.mode === "pickup_point" && plan.pickupPoint) {
    return updateOrderMeta(orderId, pickupMetaFromPoint(plan.pickupPoint));
  }

  if (plan.mode === "home_delivery") {
    return updateOrderMeta(orderId, {
      deliveryMode: "home_delivery",
      pickupPointId: null,
      pickupPointName: null,
      pickupPointPhone: null,
    });
  }

  return updateOrderMeta(orderId, { deliveryMode: "pending_assignment" });
}

export function formatFulfillmentLine(order) {
  if (!order) return "Fulfillment details coming soon";
  if (order.deliveryMode === "pickup_point" && order.pickupPointName) {
    const where = [order.pickupPointCity, order.pickupPointCounty].filter(Boolean).join(", ");
    return `Collect at *${order.pickupPointName}*${where ? ` · ${where}` : ""}`;
  }
  if (order.deliveryMode === "home_delivery") {
    return `Home delivery to your address (${config.store.codAreas})`;
  }
  if (order.deliveryMode === "supplier_to_customer") {
    return "Supplier delivering to your address";
  }
  return "We're matching your nearest pickup partner or delivery route";
}

export function formatFulfillmentConfirmBlock(order) {
  if (!order) return "";
  if (order.deliveryMode === "pickup_point" && order.pickupPointName) {
    const lines = [
      `📍 *Pickup partner:* ${order.pickupPointName}`,
      order.pickupPointCity ? `🏘️ ${order.pickupPointCity}${order.pickupPointCounty ? `, ${order.pickupPointCounty}` : ""}` : "",
      order.pickupPointAddress ? `📌 ${order.pickupPointAddress}` : "",
      order.pickupPointLandmark ? `🧭 Near ${order.pickupPointLandmark}` : "",
      order.pickupPointHours ? `🕐 ${order.pickupPointHours}` : "",
      "",
      `_We'll notify you here when your parcel is ready to collect. Pay on delivery via M-Pesa Till or at the shop._`,
    ].filter(Boolean);
    return `\n\n${lines.join("\n")}`;
  }
  if (order.deliveryMode === "home_delivery") {
    return (
      `\n\n🛵 *Delivery:* We'll bring your order to *${order.location}*.\n` +
      `_${config.store.deliveryNote}_`
    );
  }
  return (
    `\n\n📍 *Fulfillment:* We're finding the best option for *${order.location}* — ` +
    `home delivery or a nearby Sokoni pickup partner. You'll get shop details here shortly.`
  );
}

export function formatPickupAssignedMessage(order) {
  if (!order?.pickupPointName) return null;
  return (
    `📍 *${order.id}* — collect at *${order.pickupPointName}*` +
    `${order.pickupPointCity ? ` in ${order.pickupPointCity}` : ""}.\n\n` +
    `_We'll send the full shop address, hours, and phone when your parcel is packed and ready._`
  );
}

export function formatPickupReadyMessage(order) {
  if (!order?.pickupPointName) return null;
  const lines = [
    `📍 *Collect your order ${order.id} here:*`,
    ``,
    `🏪 *${order.pickupPointName}*`,
    order.pickupPointAddress ? `📌 ${order.pickupPointAddress}` : "",
    order.pickupPointLandmark ? `🧭 Landmark: ${order.pickupPointLandmark}` : "",
    [order.pickupPointCity, order.pickupPointCounty].filter(Boolean).length
      ? `🏘️ ${[order.pickupPointCity, order.pickupPointCounty].filter(Boolean).join(", ")}`
      : "",
    order.pickupPointHours ? `🕐 ${order.pickupPointHours}` : "",
    order.pickupPointPhone ? `📞 Shop: +${String(order.pickupPointPhone).replace(/\D/g, "")}` : "",
    ``,
    `Bring your order ID *${order.id}* and pay on delivery (M-Pesa Till *${config.store.mpesaTill}* or at the shop).`,
    `_Reply *paid* after you pay. Type *track* anytime for status._`,
  ].filter((line) => line !== undefined);
  return lines.join("\n");
}

export function formatAdminFulfillmentBlock(order, locationText = "") {
  const loc = locationText || order?.location || "";
  const suggestions = rankPickupPointsForLocation(loc, 3);

  if (order?.deliveryMode === "pickup_point" && order.pickupPointName) {
    return (
      `*Fulfillment:* Pickup @ *${order.pickupPointName}* (${order.pickupPointId || "assigned"})\n` +
      `${order.pickupPointCity || ""} · +${order.pickupPointPhone || "—"}\n` +
      `Override: #pickup ${order.id} <pp-id>`
    );
  }

  if (order?.deliveryMode === "home_delivery") {
    return `*Fulfillment:* Home delivery → ${order.location}\n_(Nairobi & environs)_`;
  }

  let block = `*Fulfillment:* ⚠️ Not assigned — customer at *${loc}*\n`;
  if (suggestions.length) {
    const lines = suggestions.map(
      (s) => `• *${s.point.shopName}* (${s.point.id}) · ${s.point.city} · score ${s.score}`
    );
    block += `Suggested pickup:\n${lines.join("\n")}\n`;
    block += `#pickup ${order?.id || "SK-xxxx"} ${suggestions[0].point.id}`;
  } else {
    block += `No pickup partners in this area yet.\n#fulfill ${order?.id || "SK-xxxx"} · or add partners via pickup programme`;
  }
  return block;
}
