/**
 * Phase 4 — Listing moderation (Depop-style).
 * Hard pre-publish gate blocks prohibited / off-platform / incomplete listings.
 * Soft post-publish scan remains as a second line (hide + notify).
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { invalidateProductCache } from "./catalog.js";
import { upsertCatalogProduct, dbProductsAvailable } from "../db/repositories/products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");

const OFF_PLATFORM = [
  /\b(?:wa\.me|whatsapp\.com|t\.me|telegram)\b/i,
  /\b(?:instagram|facebook|fb\.com|tiktok)\b/i,
  /\b(?:call|text|dm)\s*(?:me|us)\b/i,
  /(?:\+?254|0)\d{9}/,
  /\b\d{10,12}\b/,
  /https?:\/\//i,
  /www\.\w+/i,
];

const PROHIBITED = [
  /\b(?:counterfeit|replica|fake\s+(?:designer|gucci|lv|nike))\b/i,
  /\b(?:weapon|gun|knife|ammunition|explosive)\b/i,
  /\b(?:cocaine|heroin|marijuana|weed|drugs)\b/i,
  /\b(?:stolen|hot\s+goods)\b/i,
  /\b(?:unregistered\s+)?(?:medical\s+)?(?:pills?|pharma|prescription|viagra|tramadol|antibiotics?)\b/i,
  /\b(?:human\s+organ|blood\s+bag)\b/i,
  /\b(?:ivory|rhino\s+horn|endangered)\b/i,
];

const FLAG_LABELS = {
  missing_title: "Missing title",
  invalid_price: "Invalid price",
  missing_image: "Missing image",
  off_platform_contact: "Off-platform contact",
  prohibited_item: "Prohibited item",
  admin_takedown: "Removed by Sokoni",
  shop_review_hold: "Shop under Sokoni review",
};

export function labelForFlag(flag) {
  const key = String(flag || "").trim();
  return FLAG_LABELS[key] || key.replace(/_/g, " ");
}

export function summarizeModeration(moderation = {}, { inStock } = {}) {
  const flags = Array.isArray(moderation?.flags) ? moderation.flags.filter(Boolean) : [];
  const status =
    moderation?.status === "hidden" || (inStock === false && flags.length)
      ? "hidden"
      : moderation?.status === "live"
        ? "live"
        : moderation?.status || (inStock === false ? "hidden" : "live");
  const labels = flags.map(labelForFlag);
  const reason =
    String(moderation?.reason || "").trim() ||
    (labels.length ? labels.join(" · ") : status === "hidden" ? "Pending Sokoni review" : "");
  const sellerHint =
    status === "hidden"
      ? flags.includes("admin_takedown")
        ? "Sokoni removed this listing. Message support on WhatsApp if you need details."
        : "Sokoni is reviewing this listing. Remove off-platform contacts or policy issues, then re-list or wait for restore."
      : "";

  return {
    status,
    flags,
    labels,
    reason,
    sellerHint,
    hiddenAt: moderation?.hiddenAt || null,
    scannedAt: moderation?.scannedAt || null,
    restoredAt: moderation?.restoredAt || null,
  };
}

/** @param {Record<string, unknown>} product */
export function scanListingLocally(product) {
  const flags = [];
  const text = [
    product.name,
    product.description,
    product.brand,
    product.secondaryBrand,
    product.color,
    product.size,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ]
    .filter(Boolean)
    .join(" ");

  if (!String(product.name || "").trim()) flags.push("missing_title");
  if (!product.sourcePriceKes || Number(product.sourcePriceKes) < 10) flags.push("invalid_price");
  if (!product.imageUrl && !(product.images || []).length) flags.push("missing_image");

  for (const re of OFF_PLATFORM) {
    if (re.test(text)) {
      flags.push("off_platform_contact");
      break;
    }
  }
  for (const re of PROHIBITED) {
    if (re.test(text)) {
      flags.push("prohibited_item");
      break;
    }
  }

  const passed = flags.length === 0;
  return {
    passed,
    flags,
    action: passed ? "live" : "hidden",
    scannedAt: Date.now(),
  };
}

/** Hard flags that must block publish (never go live, even briefly). */
const HARD_PUBLISH_BLOCK = new Set([
  "prohibited_item",
  "off_platform_contact",
  "missing_title",
  "invalid_price",
  "missing_image",
]);

/**
 * Pre-publish gate — reject before master/catalog write.
 * Soft/post-publish hide remains as a second line for edge cases.
 */
export function assertListingAllowedForPublish(product) {
  const result = scanListingLocally(product);
  const hardFlags = result.flags.filter((f) => HARD_PUBLISH_BLOCK.has(f));
  if (!hardFlags.length) {
    return { ok: true, flags: result.flags, moderation: result };
  }
  const labels = hardFlags.map(labelForFlag);
  return {
    ok: false,
    error: "moderation_blocked",
    flags: hardFlags,
    moderation: result,
    message:
      `Listing blocked before going live: ${labels.join(" · ")}. ` +
      `Fix the title/price/photo or remove prohibited / off-platform contact details, then post again.`,
  };
}

async function loadMaster() {
  return JSON.parse(await readFile(MASTER_CATALOG, "utf-8"));
}

async function saveMaster(products) {
  await writeFile(MASTER_CATALOG, JSON.stringify(products, null, 2) + "\n", "utf-8");
  try {
    const { enforceSoldLocksOnMaster } = await import("./product-availability.js");
    await enforceSoldLocksOnMaster();
  } catch (err) {
    console.warn("[listing-moderation] sold-lock enforce:", err.message);
  }
  invalidateProductCache();
}

/** Hide a live listing after moderation failure. */
export async function hideListing(productId, { flags = [], reason = "" } = {}) {
  const master = await loadMaster();
  const idx = master.findIndex((p) => p.id === productId);
  if (idx < 0) return { error: "not_found" };

  const product = master[idx];
  product.inStock = false;
  product.moderation = {
    status: "hidden",
    flags,
    reason: reason || flags.join(", "),
    hiddenAt: Date.now(),
  };
  master[idx] = product;
  await saveMaster(master);

  if (dbProductsAvailable()) {
    try {
      await upsertCatalogProduct(product);
    } catch (err) {
      console.warn("[listing-moderation] hideListing upsert skipped:", err.message);
    }
  }

  return { product };
}

/** Restore a hidden listing after human review. */
export async function restoreListing(productId) {
  const master = await loadMaster();
  const idx = master.findIndex((p) => p.id === productId);
  if (idx < 0) return { error: "not_found" };

  const product = master[idx];
  const { assertCanRestock } = await import("./product-availability.js");
  const gate = await assertCanRestock(productId, product);
  if (!gate.ok) {
    return {
      error: gate.error,
      message: gate.message || "Sold items cannot be restored to the live grid.",
    };
  }

  product.inStock = true;
  product.moderation = {
    ...(product.moderation || {}),
    status: "live",
    restoredAt: Date.now(),
  };
  master[idx] = product;
  await saveMaster(master);

  if (dbProductsAvailable()) {
    await upsertCatalogProduct(product);
  }

  return { product };
}

export async function takedownListing(productId, reason = "") {
  return hideListing(productId, { flags: ["admin_takedown"], reason });
}

/** Hide all live listings for a supplier while the shop is under review. */
export async function hideListingsForSupplier(supplierId, { reason = "Shop under Sokoni review", phone = "", handle = "" } = {}) {
  const sid = String(supplierId || "").trim();
  if (!sid && !phone && !handle) return { error: "missing_supplier", hidden: 0 };
  const master = await loadMaster();
  let hidden = 0;
  for (let i = 0; i < master.length; i++) {
    const p = master[i];
    if (sid && String(p.supplierId || "") !== sid) continue;
    if (!sid) continue;
    if (p.moderation?.status === "hidden" && p.inStock === false) continue;
    const flags = Array.isArray(p.moderation?.flags) ? [...p.moderation.flags] : [];
    if (!flags.includes("shop_review_hold")) flags.push("shop_review_hold");
    master[i] = {
      ...p,
      inStock: false,
      moderation: {
        ...(p.moderation || {}),
        status: "hidden",
        flags,
        reason,
        hiddenAt: Date.now(),
        shopReviewHold: true,
      },
    };
    hidden += 1;
    if (dbProductsAvailable()) {
      try {
        await upsertCatalogProduct(master[i]);
      } catch {
        /* ignore */
      }
    }
  }
  if (hidden) await saveMaster(master);

  // Also hide Postgres storefront products (seller_user_id / seller_id / legacy supplierId)
  let dbHidden = 0;
  try {
    dbHidden = await hideDbProductsForSeller({ supplierId: sid, phone, handle, reason });
  } catch (err) {
    console.warn("[listing-moderation] hideDbProducts:", err.message);
  }

  try {
    invalidateProductCache();
  } catch {
    /* ignore */
  }

  return { ok: true, hidden: hidden + dbHidden, jsonHidden: hidden, dbHidden };
}

/**
 * Force-hide active DB products for a seller so homepage / shop / search go blank.
 */
export async function hideDbProductsForSeller({
  supplierId = "",
  phone = "",
  handle = "",
  reason = "Shop under Sokoni review",
} = {}) {
  const { isDbEnabled, query } = await import("../db/pool.js");
  if (!isDbEnabled()) return 0;

  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.slice(-9);
  const cleanHandle = String(handle || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  const userIds = new Set();
  const sellerIds = new Set();

  if (national.length >= 9) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1
        LIMIT 20`,
      [national]
    );
    for (const r of rows) userIds.add(Number(r.id));
  }
  if (cleanHandle) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE LOWER(REPLACE(handle, '@', '')) = $1
        LIMIT 5`,
      [cleanHandle]
    );
    for (const r of rows) userIds.add(Number(r.id));
  }
  if (userIds.size) {
    const { rows } = await query(
      `SELECT id FROM sellers WHERE user_id = ANY($1::int[])`,
      [[...userIds]]
    );
    for (const r of rows) sellerIds.add(Number(r.id));
  }

  const clauses = [];
  const params = [];
  if (supplierId) {
    params.push(String(supplierId));
    clauses.push(`(legacy_json->>'supplierId') = $${params.length}`);
  }
  if (userIds.size) {
    params.push([...userIds]);
    clauses.push(`seller_user_id = ANY($${params.length}::int[])`);
  }
  if (sellerIds.size) {
    params.push([...sellerIds]);
    clauses.push(`seller_id = ANY($${params.length}::int[])`);
  }
  if (!clauses.length) return 0;

  params.push(String(reason || "").slice(0, 280));
  const reasonParam = `$${params.length}`;

  const { rows: updated } = await query(
    `UPDATE products SET
       in_stock = FALSE,
       updated_at = NOW(),
       legacy_json = COALESCE(legacy_json, '{}'::jsonb) || jsonb_build_object(
         'moderation', jsonb_build_object(
           'status', 'hidden',
           'shopReviewHold', true,
           'reason', ${reasonParam}::text,
           'hiddenAt', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
         ),
         'inStock', false
       )
     WHERE in_stock = TRUE
       AND is_sold = FALSE
       AND (${clauses.join(" OR ")})
     RETURNING id`,
    params
  );
  return updated.length;
}

/** Restore listings that were only hidden for shop review (keeps policy takedowns). */
export async function restoreListingsForSupplier(supplierId, { phone = "", handle = "" } = {}) {
  const sid = String(supplierId || "").trim();
  if (!sid && !phone && !handle) return { error: "missing_supplier", restored: 0 };
  const master = await loadMaster();
  const { assertCanRestock } = await import("./product-availability.js");
  let restored = 0;
  for (let i = 0; i < master.length; i++) {
    const p = master[i];
    if (sid && String(p.supplierId || "") !== sid) continue;
    if (!sid) continue;
    const flags = Array.isArray(p.moderation?.flags) ? p.moderation.flags : [];
    if (!flags.includes("shop_review_hold") && !p.moderation?.shopReviewHold) continue;
    // Keep hard policy hides (prohibited / admin_takedown) off the grid.
    if (flags.includes("admin_takedown") || flags.includes("prohibited_item")) continue;
    const gate = await assertCanRestock(p.id, p);
    if (!gate.ok) continue;
    const nextFlags = flags.filter((f) => f !== "shop_review_hold");
    master[i] = {
      ...p,
      inStock: true,
      moderation: {
        ...(p.moderation || {}),
        status: "live",
        flags: nextFlags,
        shopReviewHold: false,
        restoredAt: Date.now(),
      },
    };
    restored += 1;
    if (dbProductsAvailable()) {
      try {
        await upsertCatalogProduct(master[i]);
      } catch {
        /* ignore */
      }
    }
  }
  if (restored) await saveMaster(master);

  let dbRestored = 0;
  try {
    dbRestored = await restoreDbProductsForSeller({ supplierId: sid, phone, handle });
  } catch (err) {
    console.warn("[listing-moderation] restoreDbProducts:", err.message);
  }

  try {
    invalidateProductCache();
  } catch {
    /* ignore */
  }

  return { ok: true, restored: restored + dbRestored, jsonRestored: restored, dbRestored };
}

export async function restoreDbProductsForSeller({ supplierId = "", phone = "", handle = "" } = {}) {
  const { isDbEnabled, query } = await import("../db/pool.js");
  if (!isDbEnabled()) return 0;

  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.slice(-9);
  const cleanHandle = String(handle || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  const userIds = new Set();
  const sellerIds = new Set();

  if (national.length >= 9) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1
        LIMIT 20`,
      [national]
    );
    for (const r of rows) userIds.add(Number(r.id));
  }
  if (cleanHandle) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE LOWER(REPLACE(handle, '@', '')) = $1
        LIMIT 5`,
      [cleanHandle]
    );
    for (const r of rows) userIds.add(Number(r.id));
  }
  if (userIds.size) {
    const { rows } = await query(
      `SELECT id FROM sellers WHERE user_id = ANY($1::int[])`,
      [[...userIds]]
    );
    for (const r of rows) sellerIds.add(Number(r.id));
  }

  const clauses = [];
  const params = [];
  if (supplierId) {
    params.push(String(supplierId));
    clauses.push(`(legacy_json->>'supplierId') = $${params.length}`);
  }
  if (userIds.size) {
    params.push([...userIds]);
    clauses.push(`seller_user_id = ANY($${params.length}::int[])`);
  }
  if (sellerIds.size) {
    params.push([...sellerIds]);
    clauses.push(`seller_id = ANY($${params.length}::int[])`);
  }
  if (!clauses.length) return 0;

  // Only restock items we hid for shop review (not sold / not hard takedown)
  const { rows: updated } = await query(
    `UPDATE products SET
       in_stock = TRUE,
       updated_at = NOW(),
       legacy_json = COALESCE(legacy_json, '{}'::jsonb)
         || jsonb_build_object('inStock', true)
         || jsonb_build_object(
              'moderation',
              (COALESCE(legacy_json->'moderation', '{}'::jsonb)
                - 'shopReviewHold'
                - 'hiddenAt')
                || jsonb_build_object(
                     'status', 'live',
                     'shopReviewHold', false,
                     'restoredAt', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
                   )
            )
     WHERE in_stock = FALSE
       AND is_sold = FALSE
       AND (
         (legacy_json->'moderation'->>'shopReviewHold') IN ('true', 't', '1')
         OR COALESCE(legacy_json->'moderation'->'flags', '[]'::jsonb) ? 'shop_review_hold'
       )
       AND NOT (
         COALESCE(legacy_json->'moderation'->'flags', '[]'::jsonb) ? 'admin_takedown'
         OR COALESCE(legacy_json->'moderation'->'flags', '[]'::jsonb) ? 'prohibited_item'
       )
       AND (${clauses.join(" OR ")})
     RETURNING id`,
    params
  );
  return updated.length;
}

/** Run moderation after instant publish; hide + notify if flagged. */
export async function runPostPublishModeration(product, { sellerPhone = "" } = {}) {
  const result = scanListingLocally(product);
  product.moderation = {
    status: result.passed ? "live" : "hidden",
    flags: result.flags,
    scannedAt: result.scannedAt,
  };

  if (result.passed) {
    return { product, moderation: result };
  }

  const hidden = await hideListing(product.id, { flags: result.flags });
  const hiddenProduct = hidden.product || product;

  if (sellerPhone) {
    try {
      const summary = summarizeModeration(
        { status: "hidden", flags: result.flags, reason: result.flags.join(", ") },
        { inStock: false }
      );
      await sendText(
        `${String(sellerPhone).replace(/\D/g, "")}@c.us`,
        `⚠️ *Listing hidden pending review*\n*${product.name}*\n🆔 \`${product.id}\`\n` +
          `Reason: ${summary.reason}\n\n` +
          `_Sokoni will review shortly. Fix off-platform links or policy issues and re-list if needed._`
      );
    } catch {}
  }

  if (config.admin.primary) {
    try {
      const summary = summarizeModeration(
        { status: "hidden", flags: result.flags, reason: result.flags.join(", ") },
        { inStock: false }
      );
      await sendText(
        `${config.admin.primary.replace(/\D/g, "")}@c.us`,
        `🚩 *Listing flagged* \`${product.id}\`\n*${product.name}*\nFlags: ${summary.reason}\n` +
          `Review: https://sokonimall.com/admin-seller-listings.html\n` +
          `Restore: POST /admin/suppliers/seller-listings/${product.id}/restore?token=...`
      );
    } catch {}
  }

  return { product: hiddenProduct, moderation: result };
}

export async function listFlaggedListings() {
  const master = await loadMaster();
  return master
    .filter(
      (p) =>
        p.moderation?.status === "hidden" ||
        (p.inStock === false && p.moderation?.flags?.length)
    )
    .map((p) => ({
      ...p,
      moderationSummary: summarizeModeration(p.moderation || {}, { inStock: p.inStock }),
    }));
}
