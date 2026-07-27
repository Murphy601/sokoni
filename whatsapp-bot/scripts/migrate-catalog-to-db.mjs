#!/usr/bin/env node
/**
 * Import src/data/products.json into PostgreSQL.
 *
 *   npm run db:seed
 *   npm run db:seed -- --dry-run
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_ROOT = path.join(__dirname, "..");
const BOT_ENV = path.join(BOT_ROOT, ".env");
const MASTER = path.join(BOT_ROOT, "src", "data", "products.json");
const SCHEMA = path.join(BOT_ROOT, "db", "schema.sql");

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* .env optional until seed */
  }
}

await loadEnvFile(BOT_ENV);

const dryRun = process.argv.includes("--dry-run");
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("DATABASE_URL is not set. Add it to whatsapp-bot/.env");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl });

async function q(text, params = []) {
  return pool.query(text, params);
}

function mapJsonToInsert(json, sellerId) {
  const isIntl = json.scope === "international";
  return {
    id: json.id,
    seller_id: sellerId,
    title: json.name,
    description: json.description || null,
    category: json.category,
    sub_category: json.subcategory || null,
    brand: json.brand || null,
    color: json.color || null,
    is_secondhand: Boolean(json.isSecondhand),
    condition: json.condition || "brand_new_without_tags",
    stock_quantity: Math.max(1, Number(json.stockQuantity) || 1),
    price_kes: json.priceKes ?? null,
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
    fulfillment: json.fulfillment || (isIntl ? null : "store"),
    payment: json.payment || (isIntl ? "other" : "prepaid"),
    emoji: json.emoji || null,
    tags: JSON.stringify(json.tags || []),
    in_stock: json.inStock !== false,
    is_sold: Boolean(json.isSold),
    tracking_code: json.trackingCode || null,
    primary_image_url: json.imageUrl || null,
    image_key: json.imageKey || null,
    image_hash: json.imageHash || null,
    upload_message_id: json.uploadMessageId || null,
    est_delivery_days: json.estDeliveryDays != null ? String(json.estDeliveryDays) : null,
    legacy_json: JSON.stringify(json),
    imageUrl: json.imageUrl || null,
  };
}

const UPSERT_SQL = `
  INSERT INTO products (
    id, seller_id, title, description, category, sub_category, brand, color,
    is_secondhand, condition, stock_quantity,
    price_kes, price_usd, source_price_kes, original_price_kes, retail_per_ml_kes, volume_ml,
    rating, review_count, source, source_url, scope, fulfillment, payment, emoji, tags,
    in_stock, is_sold, tracking_code, primary_image_url, image_key, image_hash,
    upload_message_id, est_delivery_days, legacy_json, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8,
    $9, $10, $11,
    $12, $13, $14, $15, $16, $17,
    $18, $19, $20, $21, $22, $23, $24, $25, $26::jsonb,
    $27, $28, $29, $30, $31, $32,
    $33, $34, $35::jsonb, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    seller_id = EXCLUDED.seller_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    sub_category = EXCLUDED.sub_category,
    price_kes = EXCLUDED.price_kes,
    price_usd = EXCLUDED.price_usd,
    source_price_kes = EXCLUDED.source_price_kes,
    in_stock = EXCLUDED.in_stock,
    primary_image_url = EXCLUDED.primary_image_url,
    legacy_json = EXCLUDED.legacy_json,
    updated_at = NOW()
`;

async function main() {
  const raw = await readFile(MASTER, "utf-8");
  const products = JSON.parse(raw);
  console.log(`\nSokoni catalog → PostgreSQL`);
  console.log(`Source: ${MASTER}`);
  console.log(`Items: ${products.length}${dryRun ? " (dry run)" : ""}\n`);

  if (dryRun) {
    console.log("Sample mapping:", mapJsonToInsert(products[0], 1));
    return;
  }

  const schemaSql = await readFile(SCHEMA, "utf-8");
  await q(schemaSql);
  console.log("Schema applied.");

  let sellerId;
  const existing = await q(`SELECT id FROM sellers WHERE slug = 'sokoni-store' LIMIT 1`);
  if (existing.rows[0]) {
    sellerId = existing.rows[0].id;
  } else {
    const ins = await q(
      `INSERT INTO sellers (business_name, slug, city, is_verified, is_active)
       VALUES ('Sokoni Store', 'sokoni-store', 'Kenya', TRUE, TRUE) RETURNING id`
    );
    sellerId = ins.rows[0].id;
  }
  console.log(`Default seller id: ${sellerId}`);

  let upserted = 0;
  let images = 0;

  for (const json of products) {
    const m = mapJsonToInsert(json, sellerId);
    await q(UPSERT_SQL, [
      m.id, m.seller_id, m.title, m.description, m.category, m.sub_category, m.brand, m.color,
      m.is_secondhand, m.condition, m.stock_quantity,
      m.price_kes, m.price_usd, m.source_price_kes, m.original_price_kes, m.retail_per_ml_kes, m.volume_ml,
      m.rating, m.review_count, m.source, m.source_url, m.scope, m.fulfillment, m.payment, m.emoji, m.tags,
      m.in_stock, m.is_sold, m.tracking_code, m.primary_image_url, m.image_key, m.image_hash,
      m.upload_message_id, m.est_delivery_days, m.legacy_json,
    ]);
    upserted++;

    if (m.imageUrl) {
      await q(`DELETE FROM product_images WHERE product_id = $1`, [m.id]);
      await q(`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, 0)`, [
        m.id,
        m.imageUrl,
      ]);
      images++;
    }

    if (upserted % 200 === 0) process.stdout.write(`  ${upserted}/${products.length}\r`);
  }

  const { rows } = await q(`SELECT COUNT(*)::int AS n FROM products`);
  console.log(`\nDone. products in DB: ${rows[0].n}, images linked: ${images}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
