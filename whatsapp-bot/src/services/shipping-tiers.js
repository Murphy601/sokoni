/** Seller shipping tiers + platform fee (item + shipping). Free shipping optional (seller choice). */

export const PLATFORM_FEE_RATE = 0.1;
export const MIN_SHIPPING_KES = 150;

/** Preset rider/courier tiers — AI maps cover photo → class → typical fee. */
export const SHIPPING_TIERS = [
  {
    id: "small",
    label: "Small — tops, cosmetics, accessories",
    weightNote: "< 500 g",
    minKes: 150,
    maxKes: 200,
    typicalKes: 175,
    examples: "T-shirt, dress, jewelry, lipstick, phone case, yogurt",
  },
  {
    id: "medium",
    label: "Medium — shoes, trousers, hoodies",
    weightNote: "500 g – 1.5 kg",
    minKes: 250,
    maxKes: 300,
    typicalKes: 275,
    examples: "Jeans, shoes, handbag, hoodie, headphones",
  },
  {
    id: "large",
    label: "Large — boots, jackets, electronics",
    weightNote: "> 1.5 kg",
    minKes: 350,
    maxKes: 500,
    typicalKes: 425,
    examples: "Boots, heavy coat, laptop, blender, microwave",
  },
];

const WEIGHT_KEYWORDS = [
  {
    id: "small",
    words: [
      "t-shirt", "tshirt", "tee", "top", "blouse", "dress", "skirt", "jewelry", "jewellery",
      "earring", "necklace", "ring", "bracelet", "lipstick", "cosmetic", "perfume", "makeup",
      "soap", "lotion", "socks", "belt", "scarf", "cap", "hat", "phone case", "charger",
      "yogurt", "yoghurt", "snack", "tea", "coffee", "spice", "sauce", "dairy", "grocer",
    ],
  },
  {
    id: "medium",
    words: [
      "shirt", "jeans", "trouser", "pants", "shoe", "sandal", "sneaker", "heel", "bootie",
      "bag", "handbag", "purse", "hoodie", "sweater", "jacket light", "headphone", "kettle",
      "blender small", "tablet",
    ],
  },
  {
    id: "large",
    words: [
      "boot", "coat", "jacket heavy", "parka", "laptop", "monitor", "microwave", "cooker",
      "fridge", "freezer", "washing", "television", "tv", "speaker", "generator", "sofa",
      "mattress", "chair", "electronics",
    ],
  },
];

export function getShippingTier(id) {
  const key = String(id || "small").toLowerCase();
  const normalized = key === "bulky" ? "large" : key;
  return SHIPPING_TIERS.find((t) => t.id === normalized) || SHIPPING_TIERS[0];
}

/** Text block injected into AI vision prompts. */
export function shippingTierPromptBlock() {
  return SHIPPING_TIERS.map(
    (t) =>
      `- *${t.id}* (${t.weightNote}): KES ${t.minKes}–${t.maxKes}, typical ${t.typicalKes} — e.g. ${t.examples}`
  ).join("\n");
}

export function clampShippingKes(amount, tierId = "small") {
  const tier = getShippingTier(tierId);
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return 0;
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

/** Apply AI weight/shipping suggestion — respects seller free-shipping toggle. */
export function applyAiShippingSuggestion(draft = {}) {
  if (draft.freeShipping === true) {
    return {
      estimatedWeightClass: draft.estimatedWeightClass || inferWeightClass(draft.name),
      suggestedShippingFeeKsh: 0,
      shippingKes: 0,
      freeShipping: true,
      shippingTierLabel: "Free shipping (seller covers delivery)",
    };
  }

  const weightClass =
    String(draft.estimatedWeightClass || draft.weightClass || "").toLowerCase() ||
    inferWeightClass(draft.name);
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
    freeShipping: false,
    shippingTierLabel: `${tier.label} (${tier.weightNote})`,
  };
}

export function computeFeeBreakdown(itemKes, shippingKes, { freeShipping = false } = {}) {
  const item = Math.max(0, Math.round(Number(itemKes) || 0));
  const shipRaw = Math.round(Number(shippingKes) || 0);
  const shipping = freeShipping || shipRaw === 0 ? 0 : Math.max(MIN_SHIPPING_KES, shipRaw);
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
    freeShipping: shipping === 0,
  };
}

export function validateShippingKes(shippingKes, { freeShipping = false } = {}) {
  if (freeShipping) return { ok: true, shippingKes: 0, freeShipping: true };
  const n = Math.round(Number(shippingKes) || 0);
  if (!Number.isFinite(n) || n < MIN_SHIPPING_KES) {
    return {
      ok: false,
      error: "invalid_shipping",
      message: `Shipping fee is required (minimum KES ${MIN_SHIPPING_KES}), or tick Offer free shipping.`,
    };
  }
  return { ok: true, shippingKes: n, freeShipping: false };
}

/** Buyer-facing totals from a catalog product. */
export function computeProductTotals(product = {}) {
  const itemKes = Math.max(0, Math.round(Number(product.priceKes) || 0));
  if (product.freeShipping) {
    const fees = computeFeeBreakdown(itemKes, 0, { freeShipping: true });
    return {
      itemKes: fees.itemKes,
      shippingKes: 0,
      totalKes: fees.buyerTotalKes,
      platformFeeKes: fees.platformFeeKes,
      sellerNetKes: fees.sellerNetKes,
      freeShipping: true,
    };
  }
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
    freeShipping: false,
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

/** WhatsApp / bag one-liner: item + shipping = total */
export function formatProductListPrice(product = {}) {
  const t = computeProductTotals(product);
  if (t.freeShipping) return `KES ${t.itemKes.toLocaleString()} (free shipping)`;
  if (t.shippingKes > 0) {
    return `KES ${t.itemKes.toLocaleString()} + ${t.shippingKes.toLocaleString()} ship = ${t.totalKes.toLocaleString()}`;
  }
  return `KES ${t.itemKes.toLocaleString()}`;
}
