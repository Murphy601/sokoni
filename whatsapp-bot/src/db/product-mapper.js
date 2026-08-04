/** Maps DB rows to the legacy JSON catalog shape used by catalog.js and the bot. */

const CONDITION_LABELS = {
  brand_new_with_tags: "Brand New with Tags",
  brand_new_without_tags: "Brand New without Tags",
  like_new: "Like New",
  gently_used: "Gently Used",
  fair_condition: "Fair Condition",
};

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} [imageUrls]
 */
export function rowToCatalogProduct(row, imageUrls = []) {
  const images = imageUrls.length
    ? imageUrls
    : row.primary_image_url
      ? [String(row.primary_image_url)]
      : [];

  const imageUrl = images[0] || null;

  let legacy = {};
  try {
    legacy =
      typeof row.legacy_json === "string"
        ? JSON.parse(row.legacy_json)
        : row.legacy_json && typeof row.legacy_json === "object"
          ? row.legacy_json
          : {};
  } catch {}

  return {
    id: row.id,
    name: row.title,
    title: row.title,
    category: row.category,
    subcategory: row.sub_category,
    browseCategory: row.browse_category || undefined,
    browseSubCategory: row.browse_sub_category || undefined,
    brand: row.brand || undefined,
    color: row.color || undefined,
    size: row.size_label || legacy.size || undefined,
    pitToPitIn:
      row.pit_to_pit_in != null
        ? Number(row.pit_to_pit_in)
        : legacy.pitToPitIn != null
          ? Number(legacy.pitToPitIn)
          : undefined,
    lengthIn:
      row.length_in != null
        ? Number(row.length_in)
        : legacy.lengthIn != null
          ? Number(legacy.lengthIn)
          : undefined,
    waistIn:
      row.waist_in != null
        ? Number(row.waist_in)
        : legacy.waistIn != null
          ? Number(legacy.waistIn)
          : undefined,
    genderFit: row.gender_fit || undefined,
    sellerHandle: row.seller_handle
      ? String(row.seller_handle).replace(/^@+/, "")
      : undefined,
    shopHandle: row.seller_handle || row.seller_slug
      ? String(row.seller_handle || row.seller_slug).replace(/^@+/, "")
      : undefined,
    businessName: row.seller_shop_name || row.seller_business_name || undefined,
    sellerUserId: (() => {
      const raw = row.seller_user_id ?? row.seller_user_join_id ?? row.seller_table_user_id;
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    })(),
    sellerAvatarUrl: row.seller_avatar_url ? String(row.seller_avatar_url) : undefined,
    description: row.description || undefined,

    isSecondhand: Boolean(row.is_secondhand),
    condition: row.condition,
    conditionLabel: CONDITION_LABELS[row.condition] || row.condition,
    stockQuantity: Number(row.stock_quantity) || 1,

    priceKes: row.price_kes != null ? Number(row.price_kes) : undefined,
    shippingKes: row.shipping_kes != null ? Number(row.shipping_kes) : undefined,
    sellerNetKes: legacy.sellerNetKes != null ? Number(legacy.sellerNetKes) : undefined,
    platformFeeKes: legacy.platformFeeKes != null ? Number(legacy.platformFeeKes) : undefined,
    supplierId: legacy.supplierId || undefined,
    priceUsd: row.price_usd != null ? Number(row.price_usd) : undefined,
    sourcePriceKes: row.source_price_kes != null ? Number(row.source_price_kes) : undefined,
    originalPriceKes: row.original_price_kes != null ? Number(row.original_price_kes) : undefined,
    retailPerMlKes: row.retail_per_ml_kes != null ? Number(row.retail_per_ml_kes) : undefined,
    volumeMl: row.volume_ml != null ? Number(row.volume_ml) : undefined,

    rating: row.rating != null ? Number(row.rating) : 4.5,
    reviews: Number(row.review_count) || 0,

    source: row.source || "Sokoni",
    sourceUrl: row.source_url || undefined,
    scope: row.scope || "local",
    fulfillment: row.fulfillment || "store",
    payment: row.payment || "prepaid",
    emoji: row.emoji || undefined,
    tags: Array.isArray(row.tags) ? row.tags : [],
    era: legacy.era || undefined,
    refreshedAt: legacy.refreshedAt != null ? Number(legacy.refreshedAt) : undefined,
    publishedAt: legacy.publishedAt != null ? Number(legacy.publishedAt) : undefined,

    inStock: row.in_stock !== false && !row.is_sold,
    isSold: Boolean(row.is_sold),
    trackingCode: row.tracking_code || undefined,

    imageUrl,
    images,
    // CDN reels live in legacy_json only (no products.video_url column / local mp4 for studio clips).
    videoUrl:
      typeof legacy.videoUrl === "string" && legacy.videoUrl.trim()
        ? legacy.videoUrl.trim()
        : undefined,
    videoKind:
      legacy.videoKind === "seller" || legacy.videoKind === "preview"
        ? legacy.videoKind
        : undefined,
    imageKey: row.image_key || undefined,
    imageHash: row.image_hash || undefined,
    uploadMessageId: row.upload_message_id || undefined,
    estDeliveryDays: row.est_delivery_days || undefined,

    sellerId: row.seller_id != null ? Number(row.seller_id) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {Record<string, unknown>} json — legacy products.json entry
 */
export function jsonToDbProduct(json, sellerId = null) {
  const isIntl = json.scope === "international";
  const stockQty = json.fulfillment === "store" && !isIntl ? 1 : Math.max(1, Number(json.stockQuantity) || 1);

  return {
    id: json.id,
    seller_id: sellerId,
    title: json.name,
    description: json.description || null,
    category: json.category,
    sub_category: json.subcategory || null,
    browse_category: json.browseCategory || null,
    browse_sub_category: json.browseSubCategory || null,
    brand: json.brand || null,
    color: json.color || null,
    size_label: json.size || json.sizeLabel || null,
    pit_to_pit_in:
      json.pitToPitIn != null && Number.isFinite(Number(json.pitToPitIn))
        ? Number(json.pitToPitIn)
        : null,
    length_in:
      json.lengthIn != null && Number.isFinite(Number(json.lengthIn))
        ? Number(json.lengthIn)
        : null,
    waist_in:
      json.waistIn != null && Number.isFinite(Number(json.waistIn))
        ? Number(json.waistIn)
        : null,
    gender_fit:
      typeof json.genderFit === "string"
        ? String(json.genderFit).trim().toLowerCase() || null
        : null,
    is_secondhand: Boolean(json.isSecondhand),
    condition: json.condition || "brand_new_without_tags",
    stock_quantity: stockQty,
    price_kes: json.priceKes ?? null,
    shipping_kes: json.shippingKes ?? null,
    price_usd: json.priceUsd ?? null,
    source_price_kes: json.sourcePriceKes ?? null,
    original_price_kes: json.originalPriceKes ?? null,
    retail_per_ml_kes: json.retailPerMlKes ?? null,
    volume_ml: json.volumeMl ?? null,
    rating: json.rating ?? 4.5,
    review_count: json.reviews ?? 0,
    source: json.source || null,
    source_url: json.sourceUrl || null,
    scope: json.scope || "local",
    fulfillment: json.fulfillment || "store",
    payment: json.payment || "prepaid",
    emoji: json.emoji || null,
    tags: JSON.stringify(json.tags || []),
    in_stock: json.inStock !== false,
    is_sold: Boolean(json.isSold),
    tracking_code: json.trackingCode || null,
    primary_image_url: json.imageUrl || null,
    image_key: json.imageKey || null,
    image_hash: json.imageHash || null,
    upload_message_id: json.uploadMessageId || null,
    est_delivery_days: json.estDeliveryDays || null,
    legacy_json: JSON.stringify(json),
  };
}

export { CONDITION_LABELS };
