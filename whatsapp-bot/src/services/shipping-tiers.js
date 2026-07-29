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

/** Seller net + shipping → buyer total with platform fee added on top (not deducted from seller). */
export function computeFeeBreakdown(sellerNetKes, shippingKes, { freeShipping = false } = {}) {
  const sellerNet = Math.max(0, Math.round(Number(sellerNetKes) || 0));
  const shipRaw = Math.round(Number(shippingKes) || 0);
  const shipping = freeShipping || shipRaw === 0 ? 0 : Math.max(MIN_SHIPPING_KES, shipRaw);
  const subtotalKes = sellerNet + shipping;
  const platformFeeKes = Math.round(subtotalKes * PLATFORM_FEE_RATE);
  const buyerTotalKes = subtotalKes + platformFeeKes;
  return {
    sellerNetKes: sellerNet,
    itemKes: sellerNet,
    shippingKes: shipping,
    subtotalKes,
    platformFeeKes,
    platformFeeRate: PLATFORM_FEE_RATE,
    buyerTotalKes,
    freeShipping: shipping === 0,
  };
}

/** Lowest buyer all-in that still leaves the seller at least KES 1 after shipping + 10% fee. */
export function minBuyerTotalForOffer(shippingKes, { freeShipping = false } = {}) {
  return computeFeeBreakdown(1, shippingKes, { freeShipping }).buyerTotalKes;
}

/**
 * Public escrow split for an offer / checkout payload.
 * Buyer pays `totalKes` into escrow; on delivery seller receives `sellerNetKes`,
 * shipping is reserved for delivery, and Sokoni keeps `platformFeeKes`.
 */
export function serializeOfferBreakdown(breakdown) {
  if (!breakdown || breakdown.error) return null;
  return {
    itemKes: breakdown.itemKes,
    shippingKes: breakdown.shippingKes,
    platformFeeKes: breakdown.platformFeeKes,
    sellerNetKes: breakdown.sellerNetKes,
    totalKes: breakdown.buyerTotalKes,
    freeShipping: Boolean(breakdown.freeShipping),
    fromOffer: true,
    agreedBuyerTotalKes: breakdown.agreedBuyerTotalKes ?? breakdown.buyerTotalKes,
  };
}

/**
 * Reverse fee math for an accepted offer.
 * `agreedBuyerTotalKes` is the negotiated all-in amount the buyer pays (offer.amount_kes).
 * Shipping is taken from the listing; seller net + platform fee are derived so totals stay consistent.
 */
export function computeOfferFeeBreakdown(agreedBuyerTotalKes, shippingKes, { freeShipping = false } = {}) {
  const agreed = Math.round(Number(agreedBuyerTotalKes) || 0);
  if (!Number.isFinite(agreed) || agreed < 1) {
    return { error: "invalid_offer_amount", message: "Agreed offer amount must be a positive KES total." };
  }

  const shipRaw = Math.round(Number(shippingKes) || 0);
  const shipping = freeShipping || shipRaw === 0 ? 0 : Math.max(MIN_SHIPPING_KES, shipRaw);
  const minBuyerTotalKes = minBuyerTotalForOffer(shipping, { freeShipping: shipping === 0 });
  const subtotalKes = Math.round(agreed / (1 + PLATFORM_FEE_RATE));
  const sellerNetKes = subtotalKes - shipping;

  if (sellerNetKes < 1) {
    return {
      error: "offer_too_low_for_shipping",
      message:
        shipping > 0
          ? `Offer must be at least KES ${minBuyerTotalKes.toLocaleString("en-KE")} to cover shipping (KES ${shipping.toLocaleString("en-KE")}) and Sokoni's 10% fee.`
          : `Offer must be at least KES ${minBuyerTotalKes.toLocaleString("en-KE")} after Sokoni's 10% fee.`,
      agreedBuyerTotalKes: agreed,
      shippingKes: shipping,
      minBuyerTotalKes,
    };
  }

  // Re-run forward math so rounding matches computeFeeBreakdown.
  const forward = computeFeeBreakdown(sellerNetKes, shipping, { freeShipping: shipping === 0 });
  const buyerTotalKes = agreed;
  const feeAdjust = buyerTotalKes - forward.buyerTotalKes;

  return {
    sellerNetKes: forward.sellerNetKes,
    itemKes: forward.itemKes,
    shippingKes: forward.shippingKes,
    subtotalKes: forward.subtotalKes,
    platformFeeKes: forward.platformFeeKes + feeAdjust,
    platformFeeRate: PLATFORM_FEE_RATE,
    buyerTotalKes,
    freeShipping: forward.freeShipping,
    agreedBuyerTotalKes: agreed,
    minBuyerTotalKes,
    fromOffer: true,
  };
}

/** Legacy catalog items where priceKes was buyer item portion (fee deducted, not added on top). */
export function computeFeeBreakdownLegacy(itemKes, shippingKes, { freeShipping = false } = {}) {
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

function sellerNetMatchesAllInTotal(sellerNet, product, shipping) {
  const storedTotal = product.priceKes != null ? Math.round(Number(product.priceKes)) : null;
  if (storedTotal == null) return false;
  const ship = product.freeShipping ? 0 : Math.round(Number(shipping) || 0);
  const fees = computeFeeBreakdown(sellerNet, ship, { freeShipping: product.freeShipping });
  return Math.abs(storedTotal - fees.buyerTotalKes) <= 5;
}

/** Resolve seller net from explicit field or peer-listing shape (sourcePriceKes + all-in priceKes). */
export function resolveSellerNetKes(product = {}) {
  if (product.sellerNetKes != null) return Math.round(Number(product.sellerNetKes));

  const storedTotal = product.priceKes != null ? Math.round(Number(product.priceKes)) : null;
  const shipping = product.shippingKes != null ? Math.round(Number(product.shippingKes)) : null;

  if (product.sourcePriceKes != null) {
    const sellerNet = Math.round(Number(product.sourcePriceKes));
    if (product.platformFeeKes != null) return sellerNet;
    if (shipping != null && sellerNetMatchesAllInTotal(sellerNet, product, shipping)) return sellerNet;
  }

  // DB seller rows: price_kes is buyer all-in when it matches fee breakdown from inferred net.
  if (product.sellerId != null && storedTotal != null) {
    const ship = product.freeShipping ? 0 : Math.round(Number(shipping) || 0);
    const subtotal = Math.round(storedTotal / (1 + PLATFORM_FEE_RATE));
    const inferredNet = subtotal - ship;
    if (inferredNet >= 0 && sellerNetMatchesAllInTotal(inferredNet, product, ship)) return inferredNet;
  }

  return null;
}

function totalsFromSellerNet(product, sellerNet) {
  if (product.freeShipping) {
    const fees = computeFeeBreakdown(sellerNet, 0, { freeShipping: true });
    const storedTotal = product.priceKes != null ? Math.round(Number(product.priceKes)) : null;
    return {
      itemKes: fees.sellerNetKes,
      shippingKes: 0,
      totalKes: storedTotal != null && Math.abs(storedTotal - fees.buyerTotalKes) <= 5 ? storedTotal : fees.buyerTotalKes,
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
  const fees = computeFeeBreakdown(sellerNet, clampShippingKes(shippingRaw, weightClass));
  const storedTotal = product.priceKes != null ? Math.round(Number(product.priceKes)) : null;
  return {
    itemKes: fees.sellerNetKes,
    shippingKes: fees.shippingKes,
    totalKes:
      storedTotal != null && Math.abs(storedTotal - fees.buyerTotalKes) <= 5
        ? storedTotal
        : fees.buyerTotalKes,
    platformFeeKes: fees.platformFeeKes,
    sellerNetKes: fees.sellerNetKes,
    freeShipping: false,
  };
}

/** Buyer-facing totals from a catalog product. */
export function computeProductTotals(product = {}) {
  const sellerNet = resolveSellerNetKes(product);
  if (sellerNet != null && sellerNet >= 0) {
    return totalsFromSellerNet(product, sellerNet);
  }

  const itemKes = Math.max(0, Math.round(Number(product.priceKes) || 0));
  if (product.freeShipping) {
    const fees = computeFeeBreakdownLegacy(itemKes, 0, { freeShipping: true });
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
  const fees = computeFeeBreakdownLegacy(itemKes, clampShippingKes(shippingRaw, weightClass));
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

/** WhatsApp / bag one-liner — buyer all-in total for seller listings; legacy item+ship otherwise. */
export function formatProductListPrice(product = {}) {
  const t = computeProductTotals(product);
  if (resolveSellerNetKes(product) != null) {
    return `KES ${t.totalKes.toLocaleString()}`;
  }
  if (t.freeShipping) return `KES ${t.itemKes.toLocaleString()} (free shipping)`;
  if (t.shippingKes > 0) {
    return `KES ${t.itemKes.toLocaleString()} + ${t.shippingKes.toLocaleString()} ship = ${t.totalKes.toLocaleString()}`;
  }
  return `KES ${t.itemKes.toLocaleString()}`;
}
