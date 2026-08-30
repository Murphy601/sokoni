import { query, isDbEnabled } from "../pool.js";
import { rowToCatalogProduct, jsonToDbProduct } from "../product-mapper.js";
import { ensureDefaultSeller, getSellerById, getSellerBySlug } from "./sellers.js";

const PRODUCT_SELECT = `
  SELECT p.*,
    s.business_name AS seller_business_name,
    s.slug AS seller_slug,
    s.user_id AS seller_table_user_id,
    s.is_verified AS seller_table_verified,
    COALESCE(s.is_verified_store, s.is_verified, FALSE) AS seller_table_verified_store,
    su.id AS seller_user_join_id,
    su.handle AS seller_handle,
    su.shop_name AS seller_shop_name,
    su.avatar_url AS seller_avatar_url,
    su.is_seller_verified AS seller_user_verified,
    su.rating_score AS seller_rating_score,
    su.rating_count AS seller_rating_count,
    su.badge_tier AS seller_badge_tier,
    COALESCE(su.completed_orders, 0)::int AS seller_completed_orders,
    COALESCE(su.dispute_count, 0)::int AS seller_dispute_count,
    COALESCE(su.unresolved_disputes, 0)::int AS seller_unresolved_disputes,
    (
      SELECT COUNT(*)::int
        FROM products px
       WHERE px.is_sold = TRUE
         AND (
           (p.seller_id IS NOT NULL AND px.seller_id = p.seller_id)
           OR (
             COALESCE(p.seller_user_id, s.user_id) IS NOT NULL
             AND px.seller_user_id = COALESCE(p.seller_user_id, s.user_id)
           )
         )
    ) AS seller_sales_count,
    (
      SELECT COALESCE(AVG(r.rating), 0)::numeric(10,2)
        FROM order_reviews r
       WHERE r.seller_user_id = COALESCE(p.seller_user_id, s.user_id)
         AND r.direction = 'buyer_to_seller'
    ) AS seller_avg_rating,
    (
      SELECT COUNT(*)::int
        FROM order_reviews r
       WHERE r.seller_user_id = COALESCE(p.seller_user_id, s.user_id)
         AND r.direction = 'buyer_to_seller'
    ) AS seller_total_reviews,
    COALESCE(
      (SELECT json_agg(pi.url ORDER BY pi.sort_order)
       FROM product_images pi WHERE pi.product_id = p.id),
      '[]'::json
    ) AS image_urls
  FROM products p
  LEFT JOIN sellers s ON s.id = p.seller_id
  LEFT JOIN users su ON su.id = COALESCE(p.seller_user_id, s.user_id)
`;

/**
 * @param {Record<string, unknown>} row
 */
function mapRow(row) {
  const urls = Array.isArray(row.image_urls) ? row.image_urls : [];
  return rowToCatalogProduct(row, urls);
}

const GENDER_FIT_VALUES = ["mens", "womens", "unisex", "kids"];
const GENDER_FIT_ALIASES = {
  mens: "mens",
  women: "womens",
  womens: "womens",
  unisex: "unisex",
  kids: "kids",
  m: "mens",
  w: "womens",
};

const CREATE_CONDITION_MAP = {
  brand_new: "brand_new_without_tags",
  like_new: "like_new",
  good: "gently_used",
  fair: "fair_condition",
  brand_new_with_tags: "brand_new_with_tags",
  brand_new_without_tags: "brand_new_without_tags",
  gently_used: "gently_used",
  fair_condition: "fair_condition",
};

function normalizeCreateCondition(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  return CREATE_CONDITION_MAP[key] || null;
}

function normalizeGenderFit(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  return GENDER_FIT_ALIASES[key] || null;
}

function inferIsSecondhand(condition) {
  return ["like_new", "gently_used", "fair_condition"].includes(condition);
}

function createProductId() {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `prod_${Date.now().toString(36)}_${suffix}`;
}

function buildSearchClauses({
  category,
  subcategory,
  browseCategory,
  browseSubCategory,
  keywords,
  maxPriceKes,
  minPriceKes,
  source,
  scope,
  fulfillment,
  isSecondhand,
  condition,
  inStockOnly = true,
} = {}) {
  const clauses = [];
  const params = [];

  if (inStockOnly) {
    clauses.push(`p.in_stock = TRUE AND p.is_sold = FALSE`);
  }
  if (category) {
    params.push(category);
    clauses.push(`p.category = $${params.length}`);
  }
  if (subcategory) {
    params.push(subcategory);
    clauses.push(`p.sub_category = $${params.length}`);
  }
  if (browseCategory) {
    params.push(browseCategory);
    clauses.push(`p.browse_category = $${params.length}`);
  }
  if (browseSubCategory) {
    params.push(browseSubCategory);
    clauses.push(`p.browse_sub_category = $${params.length}`);
  }
  if (source) {
    params.push(source);
    clauses.push(`p.source = $${params.length}`);
  }
  if (scope) {
    params.push(scope);
    clauses.push(`p.scope = $${params.length}`);
  }
  if (fulfillment) {
    params.push(fulfillment);
    clauses.push(`p.fulfillment = $${params.length}`);
  }
  if (isSecondhand != null) {
    params.push(Boolean(isSecondhand));
    clauses.push(`p.is_secondhand = $${params.length}`);
  }
  if (condition) {
    params.push(condition);
    clauses.push(`p.condition = $${params.length}`);
  }
  if (maxPriceKes != null) {
    params.push(maxPriceKes);
    clauses.push(`p.price_kes IS NOT NULL AND p.price_kes <= $${params.length}`);
  }
  if (minPriceKes != null) {
    params.push(minPriceKes);
    clauses.push(`p.price_kes IS NOT NULL AND p.price_kes >= $${params.length}`);
  }
  if (keywords) {
    params.push(`%${String(keywords).toLowerCase().replace(/%/g, "")}%`);
    const i = params.length;
    clauses.push(`(
      LOWER(p.title) LIKE $${i}
      OR LOWER(COALESCE(p.description, '')) LIKE $${i}
      OR LOWER(p.category) LIKE $${i}
      OR LOWER(COALESCE(p.sub_category, '')) LIKE $${i}
      OR LOWER(COALESCE(p.browse_category, '')) LIKE $${i}
      OR LOWER(COALESCE(p.browse_sub_category, '')) LIKE $${i}
      OR LOWER(COALESCE(p.brand, '')) LIKE $${i}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p.tags) t
        WHERE LOWER(t) LIKE $${i}
      )
    )`);
  }

  return { clauses, params };
}

export async function listProducts({ inStockOnly = false } = {}) {
  let sql = `${PRODUCT_SELECT}`;
  const params = [];
  if (inStockOnly) {
    sql += ` WHERE p.in_stock = TRUE AND p.is_sold = FALSE`;
  }
  sql += ` ORDER BY p.category, p.sub_category, p.title`;
  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

export async function getProductById(id) {
  const { rows } = await query(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Create a product listing with mandatory social-marketplace metadata.
 */
export async function createProductListing({
  sellerId,
  title,
  description = "",
  priceKsh,
  images = [],
  category = "fashion",
  subCategory = null,
  size,
  condition,
  brand,
  genderFit,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const cleanTitle = String(title || "").trim();
  const cleanDescription = String(description || "").trim();
  const amount = Number(priceKsh);
  const imageUrls = Array.isArray(images)
    ? images.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  const sizeLabel = String(size || "").trim();
  const normalizedCondition = normalizeCreateCondition(condition);
  const normalizedGenderFit = normalizeGenderFit(genderFit);

  if (!cleanTitle || !Number.isFinite(amount) || amount <= 0 || imageUrls.length < 1) {
    return { error: "missing_required", message: "Title, price, and cover image are required." };
  }
  if (!sizeLabel || !normalizedCondition || !normalizedGenderFit) {
    return {
      error: "missing_metadata",
      message: "Missing mandatory metadata (Size, Condition, Gender Fit).",
    };
  }

  let resolvedSellerId = null;
  let resolvedSellerUserId = null;
  let resolvedSellerProfile = null;
  if (sellerId != null && String(sellerId).trim() !== "") {
    const numericSellerId = Number(sellerId);
    if (!Number.isInteger(numericSellerId) || numericSellerId < 1) {
      return { error: "invalid_seller", message: "sellerId must be a valid numeric seller ID." };
    }
    const seller = await getSellerById(numericSellerId);
    if (!seller) {
      return { error: "seller_not_found", message: "Seller profile not found." };
    }
    resolvedSellerProfile = seller;
    resolvedSellerId = numericSellerId;
    resolvedSellerUserId =
      seller.user_id != null && Number.isInteger(Number(seller.user_id))
        ? Number(seller.user_id)
        : null;
  } else {
    resolvedSellerId = await ensureDefaultSeller();
    const seller = await getSellerById(resolvedSellerId);
    resolvedSellerProfile = seller || null;
    resolvedSellerUserId =
      seller?.user_id != null && Number.isInteger(Number(seller.user_id))
        ? Number(seller.user_id)
        : null;
  }

  const productId = createProductId();
  const safeBrand = String(brand || "").trim() || "Unbranded / Thrift";
  const isSecondhand = inferIsSecondhand(normalizedCondition);
  const safeCategory = String(category || "fashion").trim() || "fashion";
  const safeSubCategory = String(subCategory || "").trim() || null;
  const sourceName = String(resolvedSellerProfile?.business_name || "Sokoni").trim() || "Sokoni";

  await query(
    `INSERT INTO products (
      id, seller_id, seller_user_id, title, description, category, sub_category, brand,
      size_label, gender_fit, is_secondhand, condition, stock_quantity,
      price_kes, source, scope, fulfillment, payment, tags, in_stock, is_sold,
      primary_image_url, legacy_json, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19::jsonb, $20, $21,
      $22, $23::jsonb, NOW(), NOW()
    )`,
    [
      productId,
      resolvedSellerId,
      resolvedSellerUserId,
      cleanTitle,
      cleanDescription || null,
      safeCategory,
      safeSubCategory,
      safeBrand,
      sizeLabel,
      normalizedGenderFit,
      isSecondhand,
      normalizedCondition,
      1,
      amount,
      sourceName,
      "local",
      "store",
      "prepaid",
      "[]",
      true,
      false,
      imageUrls[0],
      JSON.stringify({
        sellerUserId: resolvedSellerUserId,
        sellerId: resolvedSellerId,
        shopHandle: resolvedSellerProfile?.slug || null,
        title: cleanTitle,
        priceKsh: amount,
        category: safeCategory,
        subCategory: safeSubCategory,
        size: sizeLabel,
        condition: normalizedCondition,
        brand: safeBrand,
        genderFit: normalizedGenderFit,
      }),
    ]
  );

  for (let i = 0; i < imageUrls.length; i += 1) {
    await query(`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3)`, [
      productId,
      imageUrls[i],
      i,
    ]);
  }

  const product = await getProductById(productId);
  return { success: true, product };
}

export async function searchProductsDb({
  category,
  subcategory,
  browseCategory,
  browseSubCategory,
  keywords,
  maxPriceKes,
  minPriceKes,
  source,
  scope,
  fulfillment,
  isSecondhand,
  condition,
  inStockOnly = true,
  limit = 48,
  offset = 0,
} = {}) {
  const { clauses, params } = buildSearchClauses({
    category,
    subcategory,
    browseCategory,
    browseSubCategory,
    keywords,
    maxPriceKes,
    minPriceKes,
    source,
    scope,
    fulfillment,
    isSecondhand,
    condition,
    inStockOnly,
  });

  let sql = PRODUCT_SELECT;
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += ` ORDER BY p.rating DESC NULLS LAST, p.review_count DESC, p.title`;

  if (offset > 0) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  if (limit != null && limit > 0) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

export async function countSearchProductsDb(filters = {}) {
  const { clauses, params } = buildSearchClauses(filters);
  let sql = `SELECT COUNT(*)::int AS n FROM products p`;
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  const { rows } = await query(sql, params);
  return rows[0]?.n || 0;
}

export async function countProducts() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM products`);
  return rows[0]?.n || 0;
}

export async function getCategoriesFromDb() {
  const { rows } = await query(`
    SELECT category, sub_category, COUNT(*)::int AS n
    FROM products
    WHERE in_stock = TRUE AND is_sold = FALSE
    GROUP BY category, sub_category
    ORDER BY category, sub_category
  `);
  /** @type {Record<string, string[]>} */
  const categories = {};
  for (const row of rows) {
    if (!categories[row.category]) categories[row.category] = [];
    if (row.sub_category && !categories[row.category].includes(row.sub_category)) {
      categories[row.category].push(row.sub_category);
    }
  }
  return categories;
}

export async function getBrowseCountsFromDb() {
  const { rows } = await query(`
    SELECT browse_category, browse_sub_category, COUNT(*)::int AS n
    FROM products
    WHERE in_stock = TRUE AND is_sold = FALSE
      AND browse_category IS NOT NULL
    GROUP BY browse_category, browse_sub_category
    ORDER BY browse_category, browse_sub_category
  `);
  /** @type {Record<string, Record<string, number>>} */
  const counts = {};
  for (const row of rows) {
    if (!counts[row.browse_category]) counts[row.browse_category] = {};
    counts[row.browse_category][row.browse_sub_category || ""] = row.n;
  }
  return counts;
}

export function dbProductsAvailable() {
  return isDbEnabled();
}

const UPSERT_CATALOG_SQL = `
  INSERT INTO products (
    id, seller_id, seller_user_id, title, description, category, sub_category, browse_category, browse_sub_category,
    brand, color, size_label, pit_to_pit_in, length_in, waist_in, is_secondhand, condition, stock_quantity,
    price_kes, shipping_kes, price_usd, source_price_kes, original_price_kes, retail_per_ml_kes, volume_ml,
    rating, review_count, source, source_url, scope, fulfillment, payment, emoji, tags,
    in_stock, is_sold, tracking_code, primary_image_url, image_key, image_hash,
    upload_message_id, est_delivery_days, legacy_json, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9,
    $10, $11, $12, $13, $14, $15, $16, $17, $18,
    $19, $20, $21, $22, $23, $24, $25,
    $26, $27, $28, $29, $30, $31, $32, $33, $34::jsonb,
    $35, $36, $37, $38, $39, $40,
    $41, $42, $43::jsonb, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    seller_id = EXCLUDED.seller_id,
    seller_user_id = COALESCE(EXCLUDED.seller_user_id, products.seller_user_id),
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    sub_category = EXCLUDED.sub_category,
    browse_category = EXCLUDED.browse_category,
    browse_sub_category = EXCLUDED.browse_sub_category,
    brand = EXCLUDED.brand,
    color = EXCLUDED.color,
    size_label = COALESCE(EXCLUDED.size_label, products.size_label),
    pit_to_pit_in = COALESCE(EXCLUDED.pit_to_pit_in, products.pit_to_pit_in),
    length_in = COALESCE(EXCLUDED.length_in, products.length_in),
    waist_in = COALESCE(EXCLUDED.waist_in, products.waist_in),
    is_secondhand = EXCLUDED.is_secondhand,
    condition = EXCLUDED.condition,
    stock_quantity = EXCLUDED.stock_quantity,
    price_kes = EXCLUDED.price_kes,
    shipping_kes = EXCLUDED.shipping_kes,
    price_usd = EXCLUDED.price_usd,
    source_price_kes = EXCLUDED.source_price_kes,
    original_price_kes = COALESCE(EXCLUDED.original_price_kes, products.original_price_kes),
    -- Never clear sold / never restock a sold row via JSON upsert races.
    -- Explicit restock uses updateProductInventory + clearSoldSku, not catalog sync.
    is_sold = products.is_sold OR EXCLUDED.is_sold,
    in_stock = CASE
      WHEN products.is_sold OR EXCLUDED.is_sold THEN FALSE
      ELSE EXCLUDED.in_stock
    END,
    primary_image_url = EXCLUDED.primary_image_url,
    image_key = EXCLUDED.image_key,
    image_hash = EXCLUDED.image_hash,
    upload_message_id = EXCLUDED.upload_message_id,
    legacy_json = EXCLUDED.legacy_json,
    updated_at = NOW()
`;

/**
 * Resolve the Postgres seller row for a master-catalog product.
 * Never silently attribute peer-seller listings to the default Sokoni store.
 * Never CREATE users/sellers from catalog sync — that resurrected purged shops
 * when a phone was reused as a rider and leftover products re-synced.
 */
async function resolveCatalogSeller(catalogProduct) {
  const handle = String(catalogProduct.shopHandle || catalogProduct.sellerHandle || "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();

  let sellerId = null;
  let sellerUserId = null;

  if (handle && handle !== "sokoni-store") {
    try {
      // Prefer an existing live supplier — refuse to provision zombies.
      let liveSupplier = null;
      try {
        const { getSupplierByHandle, findSupplierByPhone, getSupplier } = await import(
          "../../services/suppliers.js"
        );
        if (catalogProduct.supplierId) liveSupplier = getSupplier(catalogProduct.supplierId);
        if (!liveSupplier && handle) liveSupplier = getSupplierByHandle(handle);
        if (!liveSupplier && catalogProduct.sellerPhone) {
          liveSupplier = findSupplierByPhone(catalogProduct.sellerPhone);
        }
      } catch {
        /* ignore */
      }

      if (!liveSupplier) {
        // Peer listing with no supplier.json row — keep prior owner if any, else default.
                // Do NOT call ensureSellerSocialProfile — recreates deleted sellers / hijacks rider phones.
        console.warn(
          "[products] upsert skip seller provision — no live supplier for",
          catalogProduct.id,
          "handle=",
          handle
        );
      } else {
        const existing = await getSellerBySlug(handle);
        if (existing) {
          sellerId = existing.id;
          sellerUserId =
            existing.user_id != null && Number.isInteger(Number(existing.user_id))
              ? Number(existing.user_id)
              : null;
        }

        if (!sellerId || !sellerUserId) {
          const { rows } = await query(
            `SELECT id, handle FROM users
              WHERE LOWER(REPLACE(COALESCE(handle,''), '@', '')) = $1
              LIMIT 1`,
            [handle]
          );
          const user = rows[0];
          const uid =
            user?.id != null && Number.isInteger(Number(user.id)) ? Number(user.id) : null;
          if (uid) {
            sellerUserId = sellerUserId || uid;
            const { ensureSellerLinkedToUser } = await import("./sellers.js");
            const linked = await ensureSellerLinkedToUser({
              userId: uid,
              slug: handle,
              businessName: catalogProduct.source || handle,
              city: catalogProduct.location || null,
            });
            if (!linked.error && linked.seller?.id) {
              sellerId = linked.seller.id;
            }
          }
        }
      }
    } catch (err) {
      console.warn("[products] seller resolve for upsert skipped:", err.message);
    }
  }

  if (!sellerId) {
    // Keep an existing non-default owner if resolve failed (do not steal listings).
    try {
      const { rows } = await query(
        `SELECT seller_id, seller_user_id, s.slug
           FROM products p
           LEFT JOIN sellers s ON s.id = p.seller_id
          WHERE p.id = $1
          LIMIT 1`,
        [catalogProduct.id]
      );
      const prev = rows[0];
      const prevSlug = String(prev?.slug || "")
        .replace(/^@+/, "")
        .trim()
        .toLowerCase();
      if (prev?.seller_id && prevSlug && prevSlug !== "sokoni-store") {
        return {
          sellerId: prev.seller_id,
          sellerUserId:
            prev.seller_user_id != null && Number.isInteger(Number(prev.seller_user_id))
              ? Number(prev.seller_user_id)
              : null,
          handle,
        };
      }
    } catch {
      /* ignore */
    }
    sellerId = await ensureDefaultSeller();
    if (handle && handle !== "sokoni-store") {
      console.warn(
        "[products] upsert falling back to default seller for",
        catalogProduct.id,
        "handle=",
        handle
      );
    }
  }

  if (sellerId && !sellerUserId) {
    try {
      const seller = await getSellerById(sellerId);
      if (seller?.user_id != null && Number.isInteger(Number(seller.user_id))) {
        sellerUserId = Number(seller.user_id);
      }
    } catch {
      /* ignore */
    }
  }

  return { sellerId, sellerUserId, handle };
}

/**
 * Upsert one catalog product from the legacy JSON shape into PostgreSQL.
 * @param {Record<string, unknown>} catalogProduct
 */
export async function upsertCatalogProduct(catalogProduct) {
  if (!isDbEnabled()) return null;

  const { sellerId, sellerUserId } = await resolveCatalogSeller(catalogProduct);

  // Preserve permanent sold tombstones from the sold-skus registry / DB / master flags.
  // Never clear sold because stale master JSON still says "in stock" — that resurrected
  // bought items (and dropped sale prices) after catalog sync / hide-restore cycles.
  let productForUpsert = catalogProduct;
  try {
    const { preserveSoldState, isSkuSold, isProductSold } = await import(
      "../../services/product-availability.js"
    );
    const { rows: existingRows } = await query(
      `SELECT is_sold, in_stock, tracking_code, legacy_json FROM products WHERE id = $1`,
      [catalogProduct.id]
    );
    const existing = existingRows[0];
    const registrySold = await isSkuSold(catalogProduct.id);
    const masterSold = isProductSold(catalogProduct);
    if (existing?.is_sold || registrySold || masterSold) {
      const legacy =
        existing?.legacy_json && typeof existing.legacy_json === "object"
          ? existing.legacy_json
          : {};
      productForUpsert = preserveSoldState(
        {
          ...legacy,
          id: catalogProduct.id,
          isSold: true,
          inStock: false,
          soldOrderId: catalogProduct.soldOrderId || legacy.soldOrderId || existing?.tracking_code,
        },
        catalogProduct
      );
    }
  } catch (err) {
    console.warn("[products] sold-preserve on upsert skipped:", err.message);
  }

  // Preserve sale / compare-at metadata when incoming master omits it (stale wipe).
  try {
    const { rows: priceRows } = await query(
      `SELECT original_price_kes, compare_at_price, legacy_json FROM products WHERE id = $1`,
      [catalogProduct.id]
    );
    const prev = priceRows[0];
    if (prev) {
      const prevLegacy =
        prev.legacy_json && typeof prev.legacy_json === "object" ? prev.legacy_json : {};
      const incomingCompare =
        Number(productForUpsert.compareAtPrice ?? productForUpsert.originalPriceKes) || 0;
      const dbCompare =
        Number(prev.compare_at_price ?? prev.original_price_kes ?? prevLegacy.compareAtPrice) || 0;
      if (!incomingCompare && dbCompare > 0) {
        productForUpsert = {
          ...productForUpsert,
          compareAtPrice: dbCompare,
          originalPriceKes: dbCompare,
          promo: productForUpsert.promo || prevLegacy.promo || undefined,
        };
      }
    }
  } catch {
    /* compare_at_price column may be absent */
  }

  const row = jsonToDbProduct(productForUpsert, sellerId);
  await query(UPSERT_CATALOG_SQL, [
    row.id,
    row.seller_id,
    sellerUserId,
    row.title,
    row.description,
    row.category,
    row.sub_category,
    row.browse_category,
    row.browse_sub_category,
    row.brand,
    row.color,
    row.size_label,
    row.pit_to_pit_in,
    row.length_in,
    row.waist_in,
    row.is_secondhand,
    row.condition,
    row.stock_quantity,
    row.price_kes,
    row.shipping_kes,
    row.price_usd,
    row.source_price_kes,
    row.original_price_kes,
    row.retail_per_ml_kes,
    row.volume_ml,
    row.rating,
    row.review_count,
    row.source,
    row.source_url,
    row.scope,
    row.fulfillment,
    row.payment,
    row.emoji,
    row.tags,
    row.in_stock,
    row.is_sold,
    row.tracking_code,
    row.primary_image_url,
    row.image_key,
    row.image_hash,
    row.upload_message_id,
    row.est_delivery_days,
    row.legacy_json,
  ]);

  // Keep compare_at_price in sync with original_price_kes (phase17). Never wipe with null.
  try {
    await query(
      `UPDATE products SET compare_at_price = COALESCE($2, compare_at_price) WHERE id = $1`,
      [row.id, row.original_price_kes]
    );
  } catch (err) {
    if (!String(err.message || "").includes("compare_at_price")) {
      console.warn("[products] compare_at_price sync skipped:", err.message);
    }
  }

  const imageUrl = productForUpsert.imageUrl || catalogProduct.imageUrl || null;
  const allImages =
    Array.isArray(productForUpsert.images) && productForUpsert.images.length
      ? productForUpsert.images
      : Array.isArray(catalogProduct.images) && catalogProduct.images.length
        ? catalogProduct.images
        : imageUrl
          ? [imageUrl]
          : [];
  if (allImages.length) {
    await query(`DELETE FROM product_images WHERE product_id = $1`, [productForUpsert.id || catalogProduct.id]);
    for (let i = 0; i < allImages.length; i += 1) {
      await query(`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3)`, [
        productForUpsert.id || catalogProduct.id,
        allImages[i],
        i,
      ]);
    }
  }

  return catalogProduct.id;
}

/**
 * Re-upsert every master catalog product into Postgres (fixes wrong seller / sticky sold).
 * @returns {{ ok: boolean, upserted: number, errors: string[] }}
 */
export async function syncMasterCatalogToDb() {
  if (!isDbEnabled()) {
    return { ok: false, upserted: 0, errors: ["database_not_configured"] };
  }
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const masterPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "data",
    "products.json"
  );
  let master = [];
  try {
    master = JSON.parse(await readFile(masterPath, "utf-8"));
  } catch (err) {
    return { ok: false, upserted: 0, errors: [err.message || "read_master_failed"] };
  }
  if (!Array.isArray(master)) {
    return { ok: false, upserted: 0, errors: ["master_not_array"] };
  }

  let upserted = 0;
  const errors = [];
  for (const product of master) {
    if (!product?.id) continue;
    try {
      await upsertCatalogProduct(product);
      upserted += 1;
    } catch (err) {
      errors.push(`${product.id}: ${err.message || err}`);
    }
  }
  return { ok: errors.length === 0, upserted, errors, total: master.length };
}

/** Mark catalog row sold after prepaid escrow payment confirms. */
export async function markProductSold(productId, orderId) {
  if (!productId) return false;
  await query(
    `UPDATE products
     SET in_stock = false, is_sold = true, stock_quantity = 0,
         tracking_code = COALESCE(tracking_code, $2), updated_at = NOW()
     WHERE id = $1`,
    [productId, orderId ? String(orderId) : null]
  );
  return true;
}

/** Sync units / availability after a sale or seller restock (multi-unit aware). */
export async function updateProductInventory(
  productId,
  { stockQuantity = 0, inStock = true, isSold = false, orderId = null } = {}
) {
  if (!productId) return false;
  const qty = Math.max(0, Math.round(Number(stockQuantity) || 0));
  const sold = Boolean(isSold);
  const live = Boolean(inStock) && !sold && qty > 0;
  await query(
    `UPDATE products
     SET stock_quantity = $2,
         in_stock = $3,
         is_sold = $4,
         tracking_code = CASE
           WHEN $4::boolean THEN COALESCE(tracking_code, $5)
           ELSE tracking_code
         END,
         updated_at = NOW()
     WHERE id = $1`,
    [productId, qty, live, sold, orderId ? String(orderId) : null]
  );
  return true;
}
