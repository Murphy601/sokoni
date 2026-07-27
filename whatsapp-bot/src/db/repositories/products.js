import { query, isDbEnabled } from "../pool.js";
import { rowToCatalogProduct, jsonToDbProduct } from "../product-mapper.js";
import { ensureDefaultSeller } from "./sellers.js";

const PRODUCT_SELECT = `
  SELECT p.*,
    COALESCE(
      (SELECT json_agg(pi.url ORDER BY pi.sort_order)
       FROM product_images pi WHERE pi.product_id = p.id),
      '[]'::json
    ) AS image_urls
  FROM products p
`;

/**
 * @param {Record<string, unknown>} row
 */
function mapRow(row) {
  const urls = Array.isArray(row.image_urls) ? row.image_urls : [];
  return rowToCatalogProduct(row, urls);
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
    id, seller_id, title, description, category, sub_category, browse_category, browse_sub_category,
    brand, color, is_secondhand, condition, stock_quantity,
    price_kes, price_usd, source_price_kes, original_price_kes, retail_per_ml_kes, volume_ml,
    rating, review_count, source, source_url, scope, fulfillment, payment, emoji, tags,
    in_stock, is_sold, tracking_code, primary_image_url, image_key, image_hash,
    upload_message_id, est_delivery_days, legacy_json, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8,
    $9, $10, $11, $12, $13,
    $14, $15, $16, $17, $18, $19,
    $20, $21, $22, $23, $24, $25, $26, $27, $28::jsonb,
    $29, $30, $31, $32, $33, $34,
    $35, $36, $37::jsonb, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    seller_id = EXCLUDED.seller_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    sub_category = EXCLUDED.sub_category,
    browse_category = EXCLUDED.browse_category,
    browse_sub_category = EXCLUDED.browse_sub_category,
    brand = EXCLUDED.brand,
    color = EXCLUDED.color,
    is_secondhand = EXCLUDED.is_secondhand,
    condition = EXCLUDED.condition,
    stock_quantity = EXCLUDED.stock_quantity,
    price_kes = EXCLUDED.price_kes,
    price_usd = EXCLUDED.price_usd,
    source_price_kes = EXCLUDED.source_price_kes,
    original_price_kes = EXCLUDED.original_price_kes,
    in_stock = EXCLUDED.in_stock,
    is_sold = EXCLUDED.is_sold,
    primary_image_url = EXCLUDED.primary_image_url,
    image_key = EXCLUDED.image_key,
    image_hash = EXCLUDED.image_hash,
    upload_message_id = EXCLUDED.upload_message_id,
    legacy_json = EXCLUDED.legacy_json,
    updated_at = NOW()
`;

/**
 * Upsert one catalog product from the legacy JSON shape into PostgreSQL.
 * @param {Record<string, unknown>} catalogProduct
 */
export async function upsertCatalogProduct(catalogProduct) {
  if (!isDbEnabled()) return null;
  const sellerId = await ensureDefaultSeller();
  const row = jsonToDbProduct(catalogProduct, sellerId);
  await query(UPSERT_CATALOG_SQL, [
    row.id,
    row.seller_id,
    row.title,
    row.description,
    row.category,
    row.sub_category,
    row.browse_category,
    row.browse_sub_category,
    row.brand,
    row.color,
    row.is_secondhand,
    row.condition,
    row.stock_quantity,
    row.price_kes,
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

  const imageUrl = catalogProduct.imageUrl || null;
  const allImages =
    Array.isArray(catalogProduct.images) && catalogProduct.images.length
      ? catalogProduct.images
      : imageUrl
        ? [imageUrl]
        : [];
  if (allImages.length) {
    await query(`DELETE FROM product_images WHERE product_id = $1`, [catalogProduct.id]);
    for (let i = 0; i < allImages.length; i += 1) {
      await query(`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3)`, [
        catalogProduct.id,
        allImages[i],
        i,
      ]);
    }
  }

  return catalogProduct.id;
}

/** Mark catalog row sold after prepaid escrow payment confirms. */
export async function markProductSold(productId, orderId) {
  if (!productId) return false;
  await query(
    `UPDATE products
     SET in_stock = false, is_sold = true, tracking_code = COALESCE(tracking_code, $2), updated_at = NOW()
     WHERE id = $1`,
    [productId, orderId ? String(orderId) : null]
  );
  return true;
}
