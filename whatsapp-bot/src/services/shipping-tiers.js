/** Seller shipping tiers + platform fee (item + shipping). No free shipping. */

export const PLATFORM_FEE_RATE = 0.1;
export const MIN_SHIPPING_KES = 150;

export const SHIPPING_TIERS = [
  { id: "small", label: "Small (< 500 g)", minKes: 150, maxKes: 250, typicalKes: 150 },
  { id: "medium", label: "Medium (500 g – 2 kg)", minKes: 250, maxKes: 400, typicalKes: 300 },
  { id: "large", label: "Large (2 – 10 kg)", minKes: 400, maxKes: 800, typicalKes: 550 },
  { id: "bulky", label: "Bulky (10 kg+)", minKes: 800, maxKes: 2000, typicalKes: 1200 },
];

const WEIGHT_KEYWORDS = [
  { id: "small", words: ["phone", "case", "charger", "earring", "ring", "lipstick", "perfume", "soap", "socks", "belt", "scarf", "cap", "hat", "yogurt", "snack", "tea", "coffee"] },
  { id: "medium", words: ["shirt", "top", "dress", "shoe", "sandal", "bag", "handbag", "hoodie", "jeans", "trouser", "blender", "kettle", "headphone"] },
  { id: "large", words: ["laptop", "monitor", "microwave", "cooker", "fridge", "freezer", "washing", "television", "tv", "sofa", "mattress", "chair"] },
  { id: "bulky", words: ["wardrobe", "bed", "dining set", "freezer chest", "generator"] },
];

export function getShippingTier(id) {
  const key = String(id || "small").toLowerCase();
  return SHIPPING_TIERS.find((t) => t.id === key) || SHIPPING_TIERS[0];
}

export function clampShippingKes(amount, tierId = "small") {
  const tier = getShippingTier(tierId);
  const n = Math.round(Number(amount) || 0);
  return Math.max(MIN_SHIPPING_KES, Math.min(tier.maxKes, Math.max(tier.minKes, n || tier.typicalKes)));
}

export function inferWeightClass(name = "") {
  const hay = String(name || "").toLowerCase();
  let best = { id: "small", score: 0 };
  for (const row of WEIGHT_KEYWORDS) {
    let score = 0;
    for (const w of row.words) if (hay.includes(w)) score += 1;
    if (score > best.score) best = { id: row.id, score };
  }
  return best.id;
}

/** Apply AI weight/shipping suggestion — always returns a valid shipping fee ≥ min. */
export function applyAiShippingSuggestion(draft = {}) {
  const weightClass = String(draft.estimatedWeightClass || draft.weightClass || "").toLowerCase() || inferWeightClass(draft.name);
  const tier = getShippingTier(weightClass);
  const raw =
    draft.suggestedShippingFeeKsh ??
    draft.shippingKes ??
    draft.shippingFeeKes ??
    tier.typicalKes;
  const shippingKes = clampShippingKes(raw, tier.id);
  return {
    estimatedWeightClass: tier.id,
    suggestedShippingFeeKsh: shippingKes,
    shippingKes,
    shippingTierLabel: tier.label,
  };
}

export function computeFeeBreakdown(itemKes, shippingKes) {
  const item = Math.max(0, Math.round(Number(itemKes) || 0));
  const shipping = clampShippingKes(shippingKes);
  const buyerTotal = item + shipping;
  const platformFeeKes = Math.round(buyerTotal * PLATFORM_FEE_RATE);
  const sellerNetKes = buyerTotal - platformFeeKes;
  return {
    itemKes: item,
    shippingKes: shipping,
    buyerTotalKes: buyerTotal,
    platformFeeKes,
    platformFeeRate: PLATFORM_FEE_RATE,
    sellerNetKes,
  };
}

export function validateShippingKes(shippingKes) {
  const n = Math.round(Number(shippingKes) || 0);
  if (!Number.isFinite(n) || n < MIN_SHIPPING_KES) {
    return {
      ok: false,
      error: "invalid_shipping",
      message: `Shipping fee is required (minimum KES ${MIN_SHIPPING_KES}).`,
    };
  }
  return { ok: true, shippingKes: n };
}

/** Buyer-facing totals from a catalog product (defaults shipping to min if missing). */
export function computeProductTotals(product = {}) {
  const itemKes = Math.max(0, Math.round(Number(product.priceKes) || 0));
  const weightClass = product.estimatedWeightClass || inferWeightClass(product.name);
  const shippingRaw =
    product.shippingKes ??
    product.shippingFeeKes ??
    getShippingTier(weightClass).typicalKes;
  const fees = computeFeeBreakdown(itemKes, clampShippingKes(shippingRaw, weightClass));
  return {
    itemKes: fees.itemKes,
    shippingKes: fees.shippingKes,
    totalKes: fees.buyerTotalKes,
    platformFeeKes: fees.platformFeeKes,
    sellerNetKes: fees.sellerNetKes,
  };
}

/** Amount the buyer pays (item + shipping). Falls back for legacy orders. */
export function orderBuyerTotal(order = {}) {
  if (order.totalKes != null) return Math.round(Number(order.totalKes));
  const item = Math.round(Number(order.priceKes) || 0);
  const ship = Math.round(Number(order.shippingKes) || 0);
  return ship > 0 ? item + ship : item;
}

export function formatBuyerTotalLine(orderOrProduct) {
  const totals =
    orderOrProduct?.totalKes != null || orderOrProduct?.shippingKes != null
      ? {
          itemKes: Math.round(Number(orderOrProduct.priceKes ?? orderOrProduct.itemKes) || 0),
          shippingKes: Math.round(Number(orderOrProduct.shippingKes) || 0),
          totalKes: orderBuyerTotal(orderOrProduct),
        }
      : computeProductTotals(orderOrProduct);
  const item = totals.itemKes ?? Math.round(Number(orderOrProduct.priceKes) || 0);
  const ship = totals.shippingKes ?? 0;
  const total = totals.totalKes ?? orderBuyerTotal(orderOrProduct);
  if (ship > 0) {
    return `KES ${item.toLocaleString()} + KES ${ship.toLocaleString()} shipping = *KES ${total.toLocaleString()}*`;
  }
  return `*KES ${total.toLocaleString()}*`;
}
