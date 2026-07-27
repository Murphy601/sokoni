/**
 * Phase 4 — Depop-style seller listings: photo → details → post → live instantly.
 * Post-publish moderation runs after go-live (flag/hide, not pre-approval).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { invalidateProductCache } from "./catalog.js";
import { clearCatalogPauseCache } from "./catalog-guard.js";
import { computeRetailPrice } from "./pricing.js";
import {
  enrichManualDraft,
  applyListingFieldsToProduct,
  VALID_CONDITIONS,
} from "./listing-generator.js";
import { processListingWithStudio } from "./listing-studio.js";
import { findSupplierByPhone, getSupplier } from "./suppliers.js";
import { upsertCatalogProduct, dbProductsAvailable } from "../db/repositories/products.js";
import { runPostPublishModeration, listFlaggedListings, takedownListing, restoreListing } from "./listing-moderation.js";
import { requireSeller } from "./seller-onboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const STORE_FILE = path.join(DATA_DIR, "seller-listings-store.json");
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");
const PAUSE_FILE = path.join(REPO_ROOT, "website", "data", "catalog-paused.json");
const IMAGES_DIR = path.join(REPO_ROOT, "website", "assets", "images", "products");
const COMMIT_SCRIPT = path.join(REPO_ROOT, "scripts", "commit-catalog.mjs");

export const MAX_PHOTOS = 4;
export const MAX_TAGS = 5;
export const MAX_BRANDS = 2;

const CATEGORY_PREFIX = {
  "phones-tablets": "pt",
  "tvs-audio": "ta",
  appliances: "ap",
  "health-beauty": "hb",
  "home-office": "ho",
  fashion: "fa",
  computing: "co",
  gaming: "ga",
  supermarket: "sm",
  "baby-products": "bp",
};

const CATEGORY_EMOJI = {
  "phones-tablets": "📱",
  "tvs-audio": "📺",
  appliances: "🔌",
  "health-beauty": "💄",
  "home-office": "🏠",
  fashion: "👗",
  computing: "💻",
  gaming: "🎮",
  supermarket: "🛒",
  "baby-products": "🍼",
};

/** @type {{ seq: number, drafts: Record<string, object> }} */
let store = { seq: 0, drafts: {} };
let loaded = false;

function normalizePhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

function decodeBase64(dataUrl) {
  return Buffer.from(String(dataUrl).replace(/^data:[^;]+;base64,/, ""), "base64");
}

async function loadStore() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(STORE_FILE)) {
      store = { seq: 0, drafts: {}, ...JSON.parse(await readFile(STORE_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[seller-listings] load failed:", err.message);
  }
}

async function saveStore() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

export function requireApprovedSeller(phone) {
  return requireSeller(phone);
}

export async function generateSellerListingDraft(buffer, mimeType, caption = "", opts = {}) {
  return processListingWithStudio(buffer, mimeType, caption, opts);
}

function normalizeTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/[\s,#]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean);
  return [...new Set(list.map((t) => t.toLowerCase()))].slice(0, MAX_TAGS);
}

function normalizeBrands(draft) {
  const brands = [];
  if (draft.brand) brands.push(String(draft.brand).trim());
  if (draft.secondaryBrand) brands.push(String(draft.secondaryBrand).trim());
  if (Array.isArray(draft.brands)) {
    for (const b of draft.brands) {
      if (b && brands.length < MAX_BRANDS) brands.push(String(b).trim());
    }
  }
  return brands.filter(Boolean).slice(0, MAX_BRANDS);
}

async function saveMediaFiles(productId, imagesBase64 = [], videoBase64 = null) {
  if (!existsSync(IMAGES_DIR)) await mkdir(IMAGES_DIR, { recursive: true });

  const images = [];
  const limited = imagesBase64.slice(0, MAX_PHOTOS);
  for (let i = 0; i < limited.length; i += 1) {
    const buffer = decodeBase64(limited[i]);
    if (!buffer.length) continue;
    const ext = i === 0 ? "" : `-${i + 1}`;
    const rel = `assets/images/products/${productId}${ext}.jpg`;
    await writeFile(path.join(IMAGES_DIR, `${productId}${ext}.jpg`), buffer);
    images.push(rel);
  }

  let videoUrl = null;
  if (videoBase64) {
    const buffer = decodeBase64(videoBase64);
    if (buffer.length) {
      const rel = `assets/images/products/${productId}.mp4`;
      await writeFile(path.join(IMAGES_DIR, `${productId}.mp4`), buffer);
      videoUrl = rel;
    }
  }

  return {
    imageUrl: images[0] || null,
    images,
    videoUrl,
  };
}

function nextProductId(products, category, sellerId) {
  const prefix = CATEGORY_PREFIX[category] || "ho";
  const sellerSlug = String(sellerId || "").slice(-6).replace(/[^a-z0-9]/gi, "") || "sl";
  let max = 0;
  const re = new RegExp(`^${prefix}-${sellerSlug}-(\\d+)$`);
  for (const p of products) {
    const m = String(p.id || "").match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${sellerSlug}-${String(max + 1).padStart(3, "0")}`;
}

async function rebuildPublicCatalog() {
  try {
    execSync("node scripts/build-site-catalog.mjs", { cwd: REPO_ROOT, stdio: "pipe" });
  } catch (err) {
    console.warn("[seller-listings] catalog rebuild failed:", err.message);
  }
}

async function unpauseCatalogIfNeeded() {
  try {
    if (!existsSync(PAUSE_FILE)) return;
    const state = JSON.parse(await readFile(PAUSE_FILE, "utf-8"));
    if (state?.paused !== true) return;
    await writeFile(
      PAUSE_FILE,
      JSON.stringify(
        {
          paused: false,
          reason: "Seller listings live — catalog reopened.",
          unpausedAt: new Date().toISOString(),
          previous: state,
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );
    clearCatalogPauseCache();
  } catch (err) {
    console.warn("[seller-listings] unpause failed:", err.message);
  }
}

async function maybeAutoPushCatalog() {
  if (!config.catalog.autoPush) return;
  try {
    execSync(`node "${COMMIT_SCRIPT}"`, { cwd: REPO_ROOT, stdio: "pipe", env: process.env });
  } catch (err) {
    console.warn("[seller-listings] catalog auto-push failed:", err.message);
  }
}

function linkSupplierProduct(supplier, productId) {
  supplier.productIds = [...(supplier.productIds || []), productId];
  const suppliersFile = path.join(DATA_DIR, "suppliers.json");
  if (!existsSync(suppliersFile)) return;
  const supStore = JSON.parse(readFileSync(suppliersFile, "utf-8"));
  if (supStore.suppliers?.[supplier.id]) {
    supStore.suppliers[supplier.id].productIds = supplier.productIds;
    writeFileSync(suppliersFile, JSON.stringify(supStore, null, 2));
  }
}

async function buildProduct(supplier, enriched, media, productId) {
  const brands = normalizeBrands(enriched);
  const tags = normalizeTags(enriched.tags);

  const product = {
    id: productId,
    name: enriched.name,
    category: enriched.category,
    subcategory: enriched.subcategory,
    browseCategory: enriched.browseCategory,
    browseSubCategory: enriched.browseSubCategory,
    sourcePriceKes: enriched.sourcePriceKes,
    priceKes: enriched.priceKes || computeRetailPrice(enriched.sourcePriceKes),
    description: enriched.description,
    brand: brands[0] || enriched.brand || undefined,
    secondaryBrand: brands[1] || undefined,
    color: enriched.color,
    size: enriched.size,
    era: enriched.era,
    condition: enriched.condition,
    isSecondhand: enriched.isSecondhand,
    location: enriched.location || supplier.city || undefined,
    shippingNote: enriched.shippingNote || (supplier.delivers ? "Seller delivery" : "Hub / pickup coordination"),
    rating: 4.5,
    reviews: 0,
    source: supplier.businessName,
    supplierId: supplier.id,
    emoji: CATEGORY_EMOJI[enriched.category] || "🛍️",
    tags,
    scope: "local",
    fulfillment: "store",
    payment: "prepaid",
    inStock: true,
    imageUrl: media.imageUrl,
    images: media.images,
    videoUrl: media.videoUrl,
    publishedAt: Date.now(),
    moderation: { status: "pending_scan" },
  };

  applyListingFieldsToProduct(product, enriched);
  return product;
}

/** Save draft without publishing. */
export async function saveSellerDraft({ phone, draft, images = [], videoBase64 = null }) {
  await loadStore();
  const check = requireApprovedSeller(phone);
  if (check.error) return check;

  const enriched = await enrichManualDraft(draft);
  if (!enriched.name) {
    return { error: "missing_fields", message: "Title is required to save a draft." };
  }

  store.seq += 1;
  const draftId = `DR-${new Date().getFullYear()}-${String(store.seq).padStart(4, "0")}`;
  const media = images.length ? await saveMediaFiles(`draft-${draftId}`, images, videoBase64) : {};

  store.drafts[draftId] = {
    id: draftId,
    status: "draft",
    sellerId: check.supplier.id,
    sellerPhone: normalizePhone(phone),
    businessName: check.supplier.businessName,
    draft: enriched,
    ...media,
    updatedAt: Date.now(),
  };
  await saveStore();

  return {
    draftId,
    status: "draft",
    message: "Draft saved. Finish and post when ready.",
  };
}

/** Post listing — live instantly (Depop-style). */
export async function publishSellerListing({ phone, draft, images = [], videoBase64 = null, draftId = null }) {
  await loadStore();
  const check = requireApprovedSeller(phone);
  if (check.error) return check;

  const enriched = await enrichManualDraft(draft);
  if (!enriched.name || (!enriched.priceKes && !enriched.sourcePriceKes)) {
    return { error: "missing_fields", message: "Title and price are required." };
  }
  if (!images.length) {
    return { error: "missing_image", message: "Add at least one product photo." };
  }

  const master = JSON.parse(await readFile(MASTER_CATALOG, "utf-8"));
  const productId = nextProductId(master, enriched.category, check.supplier.id);
  const media = await saveMediaFiles(productId, images, videoBase64);
  const product = await buildProduct(check.supplier, enriched, media, productId);

  master.push(product);
  await writeFile(MASTER_CATALOG, JSON.stringify(master, null, 2) + "\n", "utf-8");
  invalidateProductCache();

  if (dbProductsAvailable()) {
    await upsertCatalogProduct(product);
  }

  linkSupplierProduct(check.supplier, productId);

  if (draftId && store.drafts[draftId]) {
    delete store.drafts[draftId];
    await saveStore();
  }

  await unpauseCatalogIfNeeded();
  await rebuildPublicCatalog();
  await maybeAutoPushCatalog();

  const sellerPhone = normalizePhone(phone);
  const mod = await runPostPublishModeration(product, { sellerPhone });

  if (mod.moderation?.passed === false) {
    await rebuildPublicCatalog();
    await maybeAutoPushCatalog();
  }

  if (mod.moderation?.passed !== false) {
    try {
      await sendText(
        `${sellerPhone}@c.us`,
        `✅ *Listing live*\n*${product.name}*\n🆔 \`${productId}\`\n` +
          `Retail KES ${product.priceKes?.toLocaleString()} — visible on Sokoni now.`
      );
    } catch {}
  }

  return {
    productId,
    product: mod.product || product,
    status: mod.moderation?.passed === false ? "hidden_pending_review" : "live",
    moderation: mod.moderation,
    message:
      mod.moderation?.passed === false
        ? "Listing posted but hidden pending review — we'll WhatsApp you."
        : "Listing is live on Sokoni.",
  };
}

export async function listSellerListings(phone) {
  await loadStore();
  const check = requireApprovedSeller(phone);
  if (check.error) return check;

  const digits = normalizePhone(phone);
  const drafts = Object.values(store.drafts)
    .filter((d) => d.sellerPhone === digits || d.sellerId === check.supplier.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  let live = [];
  try {
    const master = JSON.parse(await readFile(MASTER_CATALOG, "utf-8"));
    live = master
      .filter((p) => p.supplierId === check.supplier.id)
      .map((p) => ({
        id: p.id,
        productId: p.id,
        status: p.moderation?.status === "hidden" || p.inStock === false ? "hidden" : "live",
        draft: {
          name: p.name,
          sourcePriceKes: p.sourcePriceKes,
          priceKes: p.priceKes,
        },
        imageUrl: p.imageUrl,
        images: p.images,
        moderation: p.moderation,
        createdAt: p.publishedAt || null,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {}

  return { drafts, listings: live };
}

export async function getSellerListingMeta() {
  let browseTaxonomy = [];
  try {
    const taxPath = path.join(REPO_ROOT, "scripts", "browse-taxonomy.mjs");
    const mod = await import(pathToFileURL(taxPath).href);
    browseTaxonomy = mod.BROWSE_TAXONOMY || [];
  } catch {}

  return {
    conditions: VALID_CONDITIONS,
    maxPhotos: MAX_PHOTOS,
    maxTags: MAX_TAGS,
    maxBrands: MAX_BRANDS,
    browseTaxonomy,
    eras: ["vintage", "80s", "90s", "y2k", "handmade"],
    visionModel: config.catalog.visionModel,
    dbEnabled: dbProductsAvailable(),
    instantPublish: true,
    studioEnabled: Boolean(process.env.PHOTOROOM_API_KEY?.trim()),
    note: "Set up your shop (phone + M-Pesa), then list. Listings go live instantly; moderation runs after publish.",
  };
}

export { listFlaggedListings, takedownListing, restoreListing, VALID_CONDITIONS };
