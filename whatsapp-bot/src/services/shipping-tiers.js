/** Seller shipping tiers + platform fee (item + shipping). Free shipping optional (seller choice). */

/** Hub logistics: fee on (item + shipping), added on top for the buyer. */
export const PLATFORM_FEE_RATE = 0.1;
/** Seller-handled (express / meetup): fee on item only, taken from item price — shipping passes to seller. */
export const SELLER_HANDLED_FEE_RATE = 0.08;
export const MIN_SHIPPING_KES = 150;

export const DELIVERY_METHODS = [
  {
    id: "hub",
    label: "Sokoni hub drop-off",
    hint: "Drop at a Sokoni hub — we handle courier",
    shippingRecipient: "platform",
  },
  {
    id: "seller_express",
    label: "Seller express",
    hint: "You dispatch with your own courier",
    shippingRecipient: "seller",
  },
  {
    id: "meetup",
    label: "In-person meetup",
    hint: "Meet the buyer — no delivery fee",
    shippingRecipient: "seller",
  },
];

export function normalizeDeliveryMethod(raw) {
  const key = String(raw || "hub")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "seller_express" || key === "express" || key === "seller_delivery" || key === "self") {
    return "seller_express";
  }
  if (key === "meetup" || key === "meet" || key === "in_person" || key === "pickup_meetup") {
    return "meetup";
  }
  return "hub";
}

export function isSellerHandledDelivery(method) {
  const m = normalizeDeliveryMethod(method);
  return m === "seller_express" || m === "meetup";
}

export function deliveryMethodMeta(method) {
  const id = normalizeDeliveryMethod(method);
  return DELIVERY_METHODS.find((d) => d.id === id) || DELIVERY_METHODS[0];
}

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

/** Seller net + shipping → buyer total with platform fee added on top (not deducted from seller). Hub default. */
export function computeFeeBreakdown(sellerNetKes, shippingKes, { freeShipping = false, deliveryMethod = "hub" } = {}) {
  const method = normalizeDeliveryMethod(deliveryMethod);
  if (isSellerHandledDelivery(method)) {
    return computeSellerHandledFeeBreakdown(sellerNetKes, shippingKes, {
      freeShipping,
      deliveryMethod: method,
    });
  }

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
    deliveryMethod: "hub",
    shippingRecipient: "platform",
    sellerPayoutKes: sellerNet,
  };
}

/**
 * Seller-handled delivery escrow split.
 * Buyer pays itemKes + shipping (no fee on top). Sokoni takes 8% of item from the item slice;
 * seller receives sellerNet + full shipping.
 *
 * Example: sellerNet 1840, ship 250 → item 2000, fee 160, buyer 2250, seller payout 2090.
 */
export function computeSellerHandledFeeBreakdown(
  sellerNetKes,
  shippingKes,
  { freeShipping = false, deliveryMethod = "seller_express" } = {}
) {
  const method = normalizeDeliveryMethod(deliveryMethod);
  const sellerNet = Math.max(0, Math.round(Number(sellerNetKes) || 0));
  const shipRaw = Math.round(Number(shippingKes) || 0);
  const shipping =
    method === "meetup" || freeShipping || shipRaw === 0 ? 0 : Math.max(0, shipRaw);
  const itemKes = sellerNet > 0 ? Math.round(sellerNet / (1 - SELLER_HANDLED_FEE_RATE)) : 0;
  const platformFeeKes = Math.max(0, itemKes - sellerNet);
  const buyerTotalKes = itemKes + shipping;
  const sellerPayoutKes = sellerNet + shipping;
  return {
    sellerNetKes: sellerNet,
    itemKes,
    shippingKes: shipping,
    subtotalKes: buyerTotalKes,
    platformFeeKes,
    platformFeeRate: SELLER_HANDLED_FEE_RATE,
    buyerTotalKes,
    freeShipping: shipping === 0,
    deliveryMethod: method === "meetup" ? "meetup" : "seller_express",
    shippingRecipient: "seller",
    sellerPayoutKes,
  };
}

/** Lowest buyer all-in that still leaves the seller at least KES 1 after shipping + fee. */
export function minBuyerTotalForOffer(shippingKes, { freeShipping = false, deliveryMethod = "hub" } = {}) {
  return computeFeeBreakdown(1, shippingKes, { freeShipping, deliveryMethod }).buyerTotalKes;
}

/**
 * Public escrow split for an offer / checkout payload.
 * Buyer pays `totalKes` into escrow; on delivery seller receives payout (item net ± shipping by mode),
 * and Sokoni keeps `platformFeeKes`.
 */
export function serializeOfferBreakdown(breakdown) {
  if (!breakdown || breakdown.error) return null;
  return {
    itemKes: breakdown.itemKes,
    shippingKes: breakdown.shippingKes,
    platformFeeKes: breakdown.platformFeeKes,
    sellerNetKes: breakdown.sellerNetKes,
    sellerPayoutKes: breakdown.sellerPayoutKes ?? breakdown.sellerNetKes,
    totalKes: breakdown.buyerTotalKes,
    freeShipping: Boolean(breakdown.freeShipping),
    deliveryMethod: breakdown.deliveryMethod || "hub",
    shippingRecipient: breakdown.shippingRecipient || "platform",
    fromOffer: true,
    agreedBuyerTotalKes: breakdown.agreedBuyerTotalKes ?? breakdown.buyerTotalKes,
  };
}

/**
 * Reverse fee math for an accepted offer.
 * `agreedBuyerTotalKes` is the negotiated all-in amount the buyer pays (offer.amount_kes).
 * Shipping is taken from the listing; seller net + platform fee are derived so totals stay consistent.
 */
export function computeOfferFeeBreakdown(
  agreedBuyerTotalKes,
  shippingKes,
  { freeShipping = false, deliveryMethod = "hub" } = {}
) {
  const method = normalizeDeliveryMethod(deliveryMethod);
  const agreed = Math.round(Number(agreedBuyerTotalKes) || 0);
  if (!Number.isFinite(agreed) || agreed < 1) {
    return { error: "invalid_offer_amount", message: "Agreed offer amount must be a positive KES total." };
  }

  if (isSellerHandledDelivery(method)) {
    const shipRaw = Math.round(Number(shippingKes) || 0);
    const shipping =
      method === "meetup" || freeShipping || shipRaw === 0 ? 0 : Math.max(0, shipRaw);
    const itemKes = Math.max(0, agreed - shipping);
    if (itemKes < 1) {
      return {
        error: "offer_too_low_for_shipping",
        message: `Offer must cover delivery (KES ${shipping.toLocaleString("en-KE")}).`,
        agreedBuyerTotalKes: agreed,
        shippingKes: shipping,
        minBuyerTotalKes: shipping + 1,
      };
    }
    const platformFeeKes = Math.round(itemKes * SELLER_HANDLED_FEE_RATE);
    const sellerNetKes = itemKes - platformFeeKes;
    const forward = computeSellerHandledFeeBreakdown(sellerNetKes, shipping, {
      freeShipping: shipping === 0,
      deliveryMethod: method,
    });
    // Prefer agreed buyer total; absorb rounding in fee.
    const feeAdjust = agreed - forward.buyerTotalKes;
    return {
      ...forward,
      platformFeeKes: forward.platformFeeKes + feeAdjust,
      buyerTotalKes: agreed,
      agreedBuyerTotalKes: agreed,
      minBuyerTotalKes: minBuyerTotalForOffer(shipping, { freeShipping: shipping === 0, deliveryMethod: method }),
      fromOffer: true,
    };
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
    deliveryMethod: "hub",
    shippingRecipient: "platform",
    sellerPayoutKes: forward.sellerNetKes,
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

export function validateShippingKes(shippingKes, { freeShipping = false, deliveryMethod = "hub" } = {}) {
  const method = normalizeDeliveryMethod(deliveryMethod);
  if (freeShipping || method === "meetup") {
    return { ok: true, shippingKes: 0, freeShipping: true };
  }
  const n = Math.round(Number(shippingKes) || 0);
  if (isSellerHandledDelivery(method)) {
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false,
        error: "invalid_shipping",
        message: "Enter your delivery fee in KES (or 0 if you cover it).",
      };
    }
    return { ok: true, shippingKes: n, freeShipping: n === 0 };
  }
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
  const fees = computeFeeBreakdown(sellerNet, ship, {
    freeShipping: product.freeShipping,
    deliveryMethod: product.deliveryMethod,
  });
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
  const deliveryMethod = normalizeDeliveryMethod(product.deliveryMethod);
  if (product.freeShipping || deliveryMethod === "meetup") {
    const fees = computeFeeBreakdown(sellerNet, 0, { freeShipping: true, deliveryMethod });
    const storedTotal = product.priceKes != null ? Math.round(Number(product.priceKes)) : null;
    return {
      itemKes: fees.itemKes,
      shippingKes: 0,
      totalKes: storedTotal != null && Math.abs(storedTotal - fees.buyerTotalKes) <= 5 ? storedTotal : fees.buyerTotalKes,
      platformFeeKes: fees.platformFeeKes,
      sellerNetKes: fees.sellerNetKes,
      sellerPayoutKes: fees.sellerPayoutKes,
      freeShipping: true,
      deliveryMethod: fees.deliveryMethod,
      shippingRecipient: fees.shippingRecipient,
    };
  }

  const weightClass = product.estimatedWeightClass || inferWeightClass(product.name);
  const shippingRaw =
    product.shippingKes ??
    product.shippingFeeKes ??
    (isSellerHandledDelivery(deliveryMethod) ? 0 : getShippingTier(weightClass).typicalKes);
  const shippingKes = isSellerHandledDelivery(deliveryMethod)
    ? Math.max(0, Math.round(Number(shippingRaw) || 0))
    : clampShippingKes(shippingRaw, weightClass);
  const fees = computeFeeBreakdown(sellerNet, shippingKes, { deliveryMethod });
  const storedTotal = product.priceKes != null ? Math.round(Number(product.priceKes)) : null;
  return {
    itemKes: fees.itemKes,
    shippingKes: fees.shippingKes,
    totalKes:
      storedTotal != null && Math.abs(storedTotal - fees.buyerTotalKes) <= 5
        ? storedTotal
        : fees.buyerTotalKes,
    platformFeeKes: fees.platformFeeKes,
    sellerNetKes: fees.sellerNetKes,
    sellerPayoutKes: fees.sellerPayoutKes,
    freeShipping: false,
    deliveryMethod: fees.deliveryMethod,
    shippingRecipient: fees.shippingRecipient,
  };
}

/** Buyer-facing totals from a catalog product. */
export function computeProductTotals(product = {}) {
  const sellerNet = resolveSellerNetKes(product);
  if (sellerNet != null && sellerNet >= 0) {
    return totalsFromSellerNet(product, sellerNet);
  }

  const deliveryMethod = normalizeDeliveryMethod(product.deliveryMethod);
  const itemKes = Math.max(0, Math.round(Number(product.priceKes) || 0));
  if (product.freeShipping || deliveryMethod === "meetup") {
    const fees = computeFeeBreakdownLegacy(itemKes, 0, { freeShipping: true });
    return {
      itemKes: fees.itemKes,
      shippingKes: 0,
      totalKes: fees.buyerTotalKes,
      platformFeeKes: fees.platformFeeKes,
      sellerNetKes: fees.sellerNetKes,
      sellerPayoutKes: fees.sellerNetKes,
      freeShipping: true,
      deliveryMethod,
      shippingRecipient: isSellerHandledDelivery(deliveryMethod) ? "seller" : "platform",
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
    sellerPayoutKes: fees.sellerNetKes,
    freeShipping: false,
    deliveryMethod: "hub",
    shippingRecipient: "platform",
  };
}

/** Amount paid out to the seller after delivery (item net + shipping when seller-handled). */
export function resolveSellerPayoutKes(orderOrTotals = {}) {
  if (orderOrTotals.sellerPayoutKes != null) {
    return Math.round(Number(orderOrTotals.sellerPayoutKes) || 0);
  }
  const net = Math.round(Number(orderOrTotals.sellerNetKes ?? orderOrTotals.sourcePriceKes) || 0);
  const ship = Math.round(Number(orderOrTotals.shippingKes) || 0);
  const recipient =
    orderOrTotals.shippingRecipient ||
    (isSellerHandledDelivery(orderOrTotals.deliveryMethod) ? "seller" : "platform");
  if (recipient === "seller") return net + ship;
  return net;
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
