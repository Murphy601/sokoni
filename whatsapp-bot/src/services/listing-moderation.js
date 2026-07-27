/**
 * Phase 4 — Post-publish listing moderation (Depop-style).
 * Listings go live instantly; automated scans flag/hide policy violations after publish.
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
];

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

async function loadMaster() {
  return JSON.parse(await readFile(MASTER_CATALOG, "utf-8"));
}

async function saveMaster(products) {
  await writeFile(MASTER_CATALOG, JSON.stringify(products, null, 2) + "\n", "utf-8");
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
    await upsertCatalogProduct(product);
  }

  return { product };
}

/** Restore a hidden listing after human review. */
export async function restoreListing(productId) {
  const master = await loadMaster();
  const idx = master.findIndex((p) => p.id === productId);
  if (idx < 0) return { error: "not_found" };

  const product = master[idx];
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
      await sendText(
        `${String(sellerPhone).replace(/\D/g, "")}@c.us`,
        `⚠️ *Listing hidden pending review*\n*${product.name}*\n🆔 \`${product.id}\`\n` +
          `Reason: ${result.flags.join(", ")}\n\n` +
          `_Sokoni will review shortly. Fix off-platform links or policy issues and re-list if needed._`
      );
    } catch {}
  }

  if (config.admin.primary) {
    try {
      await sendText(
        `${config.admin.primary.replace(/\D/g, "")}@c.us`,
        `🚩 *Listing flagged* \`${product.id}\`\n*${product.name}*\nFlags: ${result.flags.join(", ")}\n` +
          `Restore: POST /admin/suppliers/seller-listings/${product.id}/restore?token=...`
      );
    } catch {}
  }

  return { product: hiddenProduct, moderation: result };
}

export async function listFlaggedListings() {
  const master = await loadMaster();
  return master.filter(
    (p) =>
      p.moderation?.status === "hidden" ||
      (p.inStock === false && p.moderation?.flags?.length)
  );
}
