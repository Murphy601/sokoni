import { query, isDbEnabled } from "../pool.js";
import { rowToCatalogProduct } from "../product-mapper.js";

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
  keywords,
  maxPriceKes,
  minPriceKes,
  source,
  scope,
  fulfillment,
  isSecondhand,
  condition,
  inStockOnly = true,
  limit = 5000,
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
      OR LOWER(COALESCE(p.brand, '')) LIKE $${i}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p.tags) t
        WHERE LOWER(t) LIKE $${i}
      )
    )`);
  }

  let sql = PRODUCT_SELECT;
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += ` ORDER BY p.rating DESC NULLS LAST, p.review_count DESC`;
  if (limit != null && limit > 0) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await query(sql, params);
  return rows.map(mapRow);
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

export function dbProductsAvailable() {
  return isDbEnabled();
}
