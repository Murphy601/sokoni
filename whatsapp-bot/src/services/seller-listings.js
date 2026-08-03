/**
 * Phase 4 — Depop-style seller listings: photo → details → post → live instantly.
 * Post-publish moderation runs after go-live (flag/hide, not pre-approval).
 */
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../config.js";
import { geminiVisionAvailable } from "./gemini-vision.js";
import { nvidiaVisionAvailable } from "./nvidia-vision.js";
import { sendText } from "./whatsapp.js";
import { invalidateProductCache } from "./catalog.js";
import { clearCatalogPauseCache } from "./catalog-guard.js";
import {
  PLATFORM_FEE_RATE,
  validateShippingKes,
  computeFeeBreakdown,
} from "./shipping-tiers.js";
import {
  enrichManualDraft,
  applyListingFieldsToProduct,
  VALID_CONDITIONS,
} from "./listing-generator.js";
import {
  isStudioConfigured,
  isStudioClipEnabled,
  isCloudinaryConfigured,
  processListingWithStudio,
  prepareListingShowcaseMedia,
  attachVideoFromCleanImageUrls,
  getStudioMeta,
} from "./listing-studio.js";
import { findSupplierByPhone, getSupplier } from "./suppliers.js";
import { upsertCatalogProduct, dbProductsAvailable } from "../db/repositories/products.js";
import { runPostPublishModeration, listFlaggedListings, takedownListing, restoreListing, summarizeModeration } from "./listing-moderation.js";
import { requireAuthenticatedSeller } from "./seller-onboard.js";
import {
  BULK_CSV_MAX_ROWS,
  BULK_CSV_HEADERS,
  buildBulkCsvTemplate,
  bulkCsvUiHelp,
  csvTextToDraftRows,
} from "./bulk-listing-csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const STORE_FILE = path.join(DATA_DIR, "seller-listings-store.json");
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");
const PAUSE_FILE = path.join(REPO_ROOT, "website", "data", "catalog-paused.json");
const IMAGES_DIR = path.join(REPO_ROOT, "website", "assets", "images", "products");
const COMMIT_SCRIPT = path.join(REPO_ROOT, "scripts", "commit-catalog.mjs");

export const MAX_PHOTOS = 8;
export const MAX_TAGS = 5;
export const MAX_BRANDS = 2;
/** Real seller showcase videos — keep Kenya mobile feeds light. */
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
/** Client-enforced; server trusts size. AI previews stay 3–5s separately. */
export const MAX_VIDEO_SECONDS = 30;

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

/** Allow seller publish to pull studio CDN assets without stuffing them through nginx (413). */
function isAllowedRemoteMediaUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "res.cloudinary.com" ||
      host.endsWith(".cloudinary.com") ||
      host === "bot.sokonimall.com" ||
      host === "localhost" ||
      host === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

/**
 * Resolve a data-URL or allowlisted HTTPS URL to a Buffer.
 * @param {string|null|undefined} source
 * @param {{ maxBytes?: number, label?: string }} [opts]
 */
async function resolveMediaBuffer(source, opts = {}) {
  const maxBytes = opts.maxBytes || MAX_VIDEO_BYTES;
  const label = opts.label || "media";
  const raw = String(source || "").trim();
  if (!raw) return null;

  if (/^data:/i.test(raw)) {
    const buf = decodeBase64(raw);
    if (buf.length > maxBytes) {
      const err = new Error(`${label}_too_large`);
      err.code = "media_too_large";
      throw err;
    }
    return buf.length ? buf : null;
  }

  if (/^https?:\/\//i.test(raw)) {
    if (!isAllowedRemoteMediaUrl(raw)) {
      console.warn("[seller-listings] blocked remote media host:", raw.slice(0, 120));
      return null;
    }
    const res = await fetch(raw, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) {
      console.warn("[seller-listings] remote media fetch failed:", res.status, raw.slice(0, 120));
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      const err = new Error(`${label}_too_large`);
      err.code = "media_too_large";
      throw err;
    }
    return buf.length ? buf : null;
  }

  return null;
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

export async function requireApprovedSeller(phone, sessionToken) {
  return requireAuthenticatedSeller(phone, sessionToken);
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

/**
 * Persist listing media. Prefer durable Cloudinary CDN URLs in the catalog
 * (transform once on upload — never re-request bg-removal/zoompan per page view).
 * Still write a local cover JPEG for WhatsApp /catalog-images when possible.
 *
 * Each image/video source may be a data-URL **or** an allowlisted HTTPS URL.
 * @param {string} productId
 * @param {string[]} imageSources
 * @param {string|null} videoSource
 * @param {"seller"|"preview"|null} [videoKind]
 */
async function saveMediaFiles(productId, imageSources = [], videoSource = null, videoKind = null) {
  if (!existsSync(IMAGES_DIR)) await mkdir(IMAGES_DIR, { recursive: true });

  const images = [];
  const limited = imageSources.slice(0, MAX_PHOTOS);
  try {
    for (let i = 0; i < limited.length; i += 1) {
      const src = String(limited[i] || "").trim();
      if (!src) continue;
      const ext = i === 0 ? "" : `-${i + 1}`;

      // Keep absolute CDN URLs in the product record (static delivery).
      if (/^https?:\/\//i.test(src) && isAllowedRemoteMediaUrl(src)) {
        images.push(src);
        // Cover only: also cache a small local JPEG for WhatsApp catalog push.
        if (i === 0) {
          try {
            let fetchUrl = src;
            if (/res\.cloudinary\.com/i.test(src) && !/\/f_jpg/i.test(src)) {
              fetchUrl = src.replace("/upload/", "/upload/c_limit,w_1200,q_auto,f_jpg/");
            }
            const buffer = await resolveMediaBuffer(fetchUrl, {
              maxBytes: MAX_VIDEO_BYTES,
              label: "image",
            });
            if (buffer?.length) {
              await writeFile(path.join(IMAGES_DIR, `${productId}.jpg`), buffer);
            }
          } catch (err) {
            console.warn("[seller-listings] local cover cache skipped:", err.message);
          }
        }
        continue;
      }

      const buffer = await resolveMediaBuffer(src, {
        maxBytes: MAX_VIDEO_BYTES,
        label: "image",
      });
      if (!buffer?.length) continue;
      const rel = `assets/images/products/${productId}${ext}.jpg`;
      await writeFile(path.join(IMAGES_DIR, `${productId}${ext}.jpg`), buffer);
      images.push(rel);
    }

    let videoUrl = null;
    let savedVideoKind = null;
    if (videoSource) {
      const src = String(videoSource || "").trim();
      const isHttps = /^https?:\/\//i.test(src) && isAllowedRemoteMediaUrl(src);
      // Pre-uploaded seller clips live on our bot as stage_*.mp4 — rename under product id.
      const isBotStaging =
        isHttps && /\/catalog-images\/stage_[a-z0-9_-]+\.mp4(?:$|\?)/i.test(src);
      if (isHttps && !isBotStaging) {
        // Studio / multi-reel CDN MP4 — store the URL; do not pull multi‑MB into the 1GB bot.
        videoUrl = src;
        savedVideoKind =
          videoKind === "seller" || videoKind === "preview" ? videoKind : "preview";
      } else {
        const buffer = await resolveMediaBuffer(src, {
          maxBytes: MAX_VIDEO_BYTES,
          label: "video",
        });
        if (buffer?.length) {
          const rel = `assets/images/products/${productId}.mp4`;
          await writeFile(path.join(IMAGES_DIR, `${productId}.mp4`), buffer);
          videoUrl = rel;
          savedVideoKind =
            videoKind === "seller" || videoKind === "preview" ? videoKind : "seller";
          // Drop staging file after copy (best-effort).
          if (isBotStaging) {
            try {
              const stageName = path.basename(new URL(src).pathname);
              if (/^stage_/i.test(stageName)) {
                await unlink(path.join(IMAGES_DIR, stageName)).catch(() => {});
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    }

    return {
      imageUrl: images[0] || null,
      images,
      videoUrl,
      videoKind: videoUrl ? savedVideoKind : null,
    };
  } catch (err) {
    if (err?.code === "media_too_large" || /_too_large$/.test(String(err?.message || ""))) {
      return {
        imageUrl: images[0] || null,
        images,
        videoUrl: null,
        videoKind: null,
        error: "video_too_large",
        message: `Media must be ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))}MB or smaller.`,
      };
    }
    throw err;
  }
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

/** In-memory dedupe so a retried publish (after proxy timeout) does not create a second listing. */
const recentClientPublishIds = new Map();

function rememberClientPublish(clientPublishId, productId) {
  const key = String(clientPublishId || "").trim();
  if (!key || !productId) return;
  recentClientPublishIds.set(key, { productId, at: Date.now() });
  // Drop entries older than 30 minutes
  const cutoff = Date.now() - 30 * 60_000;
  for (const [k, v] of recentClientPublishIds) {
    if (v.at < cutoff) recentClientPublishIds.delete(k);
  }
}

function findRecentClientPublish(clientPublishId) {
  const key = String(clientPublishId || "").trim();
  if (!key) return null;
  const hit = recentClientPublishIds.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > 30 * 60_000) {
    recentClientPublishIds.delete(key);
    return null;
  }
  return hit;
}

/**
 * Preview already produced CDN clean images (+ optional reel) — do not re-run Cloudinary
 * on publish (that was timing out nginx ~60s and dropping the product video).
 * @returns {"full"|"images"|false}
 */
function studioReadyCdnLevel(publishImages, publishVideo, publishVideoKind) {
  const hasHttpsVideo = /^https?:\/\//i.test(String(publishVideo || ""));
  const hasDataVideo = /^data:/i.test(String(publishVideo || ""));
  // Only treat as "full" when a seller/preview video payload is actually present.
  if (publishVideoKind === "seller" && (hasHttpsVideo || hasDataVideo)) return "full";
  const list = (publishImages || []).map((u) => String(u || "").trim()).filter(Boolean);
  if (!list.length) return false;
  const allCdn = list.every(
    (u) => /^https?:\/\//i.test(u) && /res\.cloudinary\.com/i.test(u)
  );
  if (!allCdn) return false;
  if (publishVideoKind === "preview" && hasHttpsVideo) {
    return "full";
  }
  // Clean CDN stills from Preview, but reel URL missing — skip full re-clean.
  return "images";
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
  const sellerNet = Math.round(Number(enriched.sellerNetKes ?? enriched.priceKes ?? enriched.sourcePriceKes) || 0);
  // Platform shipping calc retired — sellers arrange delivery with buyers after payment.
  const deliveryMethod = "seller_express";
  const fees = computeFeeBreakdown(sellerNet, 0, {
    freeShipping: true,
    deliveryMethod,
  });

  const product = {
    id: productId,
    name: enriched.name,
    category: enriched.category,
    subcategory: enriched.subcategory,
    browseCategory: enriched.browseCategory,
    browseSubCategory: enriched.browseSubCategory,
    sellerNetKes: fees.sellerNetKes,
    sourcePriceKes: fees.sellerNetKes,
    priceKes: fees.buyerTotalKes,
    platformFeeKes: fees.platformFeeKes,
    transactionFeeKes: fees.transactionFeeKes,
    sellerPayoutKes: fees.sellerPayoutKes,
    deliveryMethod: fees.deliveryMethod,
    shippingRecipient: fees.shippingRecipient,
    description: enriched.description,
    brand: brands[0] || enriched.brand || undefined,
    secondaryBrand: brands[1] || undefined,
    color: enriched.color,
    size: enriched.size,
    pitToPitIn: enriched.pitToPitIn != null ? Number(enriched.pitToPitIn) : undefined,
    lengthIn: enriched.lengthIn != null ? Number(enriched.lengthIn) : undefined,
    waistIn: enriched.waistIn != null ? Number(enriched.waistIn) : undefined,
    era: enriched.era,
    condition: enriched.condition,
    isSecondhand: enriched.isSecondhand,
    location: enriched.location || supplier.city || undefined,
    shippingKes: 0,
    freeShipping: true,
    estimatedWeightClass: enriched.estimatedWeightClass || null,
    shippingNote: enriched.shippingNote || "Seller handles dispatch (direct delivery)",
    rating: 4.5,
    reviews: 0,
    source: supplier.businessName,
    supplierId: supplier.id,
    shopHandle:
      String(supplier.shopHandle || supplier.businessName || "")
        .replace(/^@+/, "")
        .trim()
        .toLowerCase() || undefined,
    sellerPhone: supplier.phone || undefined,
    emoji: CATEGORY_EMOJI[enriched.category] || "🛍️",
    tags,
    scope: "local",
    fulfillment: "store",
    payment: "prepaid",
    inStock: true,
    imageUrl: media.imageUrl,
    images: media.images,
    videoUrl: media.videoUrl,
    videoKind: media.videoKind || undefined,
    publishedAt: Date.now(),
    moderation: { status: "pending_scan" },
  };

  applyListingFieldsToProduct(product, enriched);
  return product;
}

function sellerOwnsDraft(record, phone, supplier) {
  if (!record) return false;
  const digits = normalizePhone(phone);
  return record.sellerPhone === digits || (supplier?.id && record.sellerId === supplier.id);
}

async function loadStoredMediaAsBase64(record) {
  const images = [];
  for (const rel of record?.images || []) {
    const file = path.basename(String(rel || ""));
    if (!file) continue;
    const full = path.join(IMAGES_DIR, file);
    if (!existsSync(full)) continue;
    try {
      const buf = await readFile(full);
      if (buf.length) images.push(`data:image/jpeg;base64,${buf.toString("base64")}`);
    } catch {
      /* skip missing/unreadable */
    }
  }
  let videoBase64 = null;
  if (record?.videoUrl) {
    const file = path.basename(String(record.videoUrl));
    const full = path.join(IMAGES_DIR, file);
    if (existsSync(full)) {
      try {
        const buf = await readFile(full);
        if (buf.length) videoBase64 = `data:video/mp4;base64,${buf.toString("base64")}`;
      } catch {
        /* ignore */
      }
    }
  }
  return { images, videoBase64 };
}

/** Save draft without publishing. Upserts when draftId belongs to this seller. */
export async function saveSellerDraft({
  phone,
  draft,
  images = [],
  imageUrls = [],
  videoBase64 = null,
  videoUrl = null,
  videoKind = null,
  draftId = null,
  sessionToken,
}) {
  await loadStore();
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) return check;

  const enriched = await enrichManualDraft(draft);
  if (!enriched.name) {
    return { error: "missing_fields", message: "Title is required to save a draft." };
  }

  const requestedId = String(draftId || "").trim();
  const existing = requestedId ? store.drafts[requestedId] : null;
  if (requestedId && existing && !sellerOwnsDraft(existing, phone, check.supplier)) {
    return { error: "forbidden", message: "Draft not found." };
  }
  if (requestedId && !existing) {
    return { error: "not_found", message: "Draft not found. Save again to create a new one." };
  }

  let id = existing?.id;
  if (!id) {
    store.seq += 1;
    id = `DR-${new Date().getFullYear()}-${String(store.seq).padStart(4, "0")}`;
  }

  const urlList = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
  const dataList = Array.isArray(images) ? images.filter(Boolean) : [];
  const mediaSources = urlList[0] ? [urlList[0], ...dataList] : dataList;
  const mediaVideo = videoUrl || videoBase64 || null;

  let media = {};
  if (mediaSources.length) {
    media = await saveMediaFiles(
      `draft-${id}`,
      mediaSources,
      mediaVideo,
      videoKind === "seller" || videoKind === "preview" ? videoKind : null
    );
    if (media.error === "video_too_large") {
      return { error: media.error, message: media.message };
    }
  } else if (existing) {
    media = {
      imageUrl: existing.imageUrl || null,
      images: existing.images || [],
      videoUrl: existing.videoUrl || null,
      videoKind: existing.videoKind || null,
    };
  }

  store.drafts[id] = {
    id,
    status: "draft",
    sellerId: check.supplier.id,
    sellerPhone: normalizePhone(phone),
    businessName: check.supplier.businessName,
    draft: enriched,
    ...media,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await saveStore();

  return {
    draftId: id,
    status: "draft",
    message: existing ? "Draft updated. Finish and post when ready." : "Draft saved. Finish and post when ready.",
  };
}

/**
 * Depop-style bulk CSV → draft listings (no photos).
 * Auth once, then create up to BULK_CSV_MAX_ROWS drafts.
 */
export async function bulkImportSellerDraftsFromCsv({ phone, csvText, sessionToken }) {
  await loadStore();
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) return check;

  const parsed = csvTextToDraftRows(csvText, { maxRows: BULK_CSV_MAX_ROWS });
  if (!parsed.rows.length) {
    return {
      error: "invalid_csv",
      message: parsed.errors[0]?.message || "No valid rows in CSV.",
      errors: parsed.errors,
      created: [],
      count: 0,
    };
  }

  const created = [];
  const rowErrors = [...parsed.errors];

  for (const item of parsed.rows) {
    try {
      const enriched = await enrichManualDraft(item.draft);
      if (!enriched.name) {
        rowErrors.push({ row: item.sourceRow, message: "Title is required." });
        continue;
      }
      store.seq += 1;
      const draftId = `DR-${new Date().getFullYear()}-${String(store.seq).padStart(4, "0")}`;
      store.drafts[draftId] = {
        id: draftId,
        status: "draft",
        sellerId: check.supplier.id,
        sellerPhone: normalizePhone(phone),
        businessName: check.supplier.businessName,
        draft: enriched,
        source: "bulk_csv",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      created.push({
        draftId,
        name: enriched.name,
        sellerNetKes: enriched.sellerNetKes,
        sourceRow: item.sourceRow,
      });
    } catch (err) {
      rowErrors.push({ row: item.sourceRow, message: err.message || "Could not save row." });
    }
  }

  if (created.length) await saveStore();

  return {
    success: true,
    count: created.length,
    created,
    errors: rowErrors,
    maxRows: BULK_CSV_MAX_ROWS,
    message:
      created.length > 0
        ? `${created.length} draft${created.length === 1 ? "" : "s"} ready. Open each to add photos, then Post.`
        : "No drafts created — check CSV errors.",
  };
}

export function getBulkListingCsvTemplate() {
  const help = bulkCsvUiHelp();
  return {
    filename: "sokoni-bulk-listings-template.csv",
    contentType: "text/csv; charset=utf-8",
    body: buildBulkCsvTemplate(),
    maxRows: BULK_CSV_MAX_ROWS,
    headers: BULK_CSV_HEADERS,
    help,
  };
}

/** Delete a seller's draft. */
export async function deleteSellerDraft({ phone, draftId, sessionToken }) {
  await loadStore();
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) return check;

  const id = String(draftId || "").trim();
  const existing = id ? store.drafts[id] : null;
  if (!existing || !sellerOwnsDraft(existing, phone, check.supplier)) {
    return { error: "not_found", message: "Draft not found." };
  }
  delete store.drafts[id];
  await saveStore();
  return { ok: true, draftId: id, message: "Draft deleted." };
}

/** Post listing — live instantly (Depop-style). */
export async function publishSellerListing({
  phone,
  draft,
  images = [],
  imageUrls = [],
  videoBase64 = null,
  videoUrl = null,
  videoKind = null,
  draftId = null,
  clientPublishId = null,
  sessionToken,
}) {
  await loadStore();
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) return check;

  const prior = findRecentClientPublish(clientPublishId);
  if (prior?.productId) {
    console.log("[seller-listings] duplicate publish token — returning existing", prior.productId);
    return {
      productId: prior.productId,
      status: "live",
      duplicate: true,
      message: "Listing already posted — not creating another copy.",
    };
  }

  const enriched = await enrichManualDraft(draft);
  if (!enriched.name || (!enriched.priceKes && !enriched.sourcePriceKes)) {
    return { error: "missing_fields", message: "Title and price are required." };
  }
  // Sellers arrange delivery themselves — never charge platform shipping on publish.
  enriched.deliveryMethod = "seller_express";
  enriched.shippingKes = 0;
  enriched.freeShipping = true;
  const shippingCheck = validateShippingKes(0, {
    freeShipping: true,
    deliveryMethod: "seller_express",
  });
  if (!shippingCheck.ok) return shippingCheck;

  const requestedDraftId = String(draftId || "").trim();
  const linkedDraft = requestedDraftId ? store.drafts[requestedDraftId] : null;
  if (requestedDraftId && (!linkedDraft || !sellerOwnsDraft(linkedDraft, phone, check.supplier))) {
    return { error: "not_found", message: "Draft not found." };
  }

  // Prefer short CDN URLs (studio cutout/clip) over multi‑MB data-URLs — avoids nginx 413.
  const urlList = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
  const dataList = Array.isArray(images) ? images.filter(Boolean) : [];
  // Preserve photo order: CDN covers first, then remaining data-URLs (extras).
  let publishImages = [...urlList, ...dataList.filter((d) => !urlList.includes(d))];
  let publishVideo = videoUrl || videoBase64 || null;
  let publishVideoKind =
    videoKind === "seller" || videoKind === "preview"
      ? videoKind
      : linkedDraft?.videoKind || null;
  // Draft may say videoKind=seller with no bytes — clear so we can attach a Preview reel.
  if (publishVideoKind === "seller" && !publishVideo) {
    publishVideoKind = null;
  }
  if (!publishImages.length && linkedDraft) {
    const stored = await loadStoredMediaAsBase64(linkedDraft);
    publishImages = stored.images;
    if (!publishVideo) {
      publishVideo = stored.videoBase64;
      if (!publishVideoKind) publishVideoKind = linkedDraft.videoKind || "seller";
    }
  }
  if (!publishImages.length) {
    return { error: "missing_image", message: "Add at least one product photo." };
  }

  // Prefer CDN URLs from Preview — re-running Cloudinary on publish drops the reel
  // and exceeds nginx timeouts.
  const studioReady = studioReadyCdnLevel(publishImages, publishVideo, publishVideoKind);
  if (studioReady === "full") {
    console.log("[seller-listings] using Preview CDN media — skip showcase rebuild", {
      images: publishImages.length,
      videoKind: publishVideoKind,
      videoUrl: String(publishVideo || "").slice(0, 96),
    });
  } else if (studioReady === "images") {
    // Stills ready; keep any client reel URL, else build video from those CDN stills.
    console.log("[seller-listings] Preview CDN stills — skip full showcase", {
      images: publishImages.length,
      hasVideo: Boolean(publishVideo),
    });
    if (publishVideo && !publishVideoKind) {
      publishVideoKind = "preview";
    }
    if (!publishVideo && isCloudinaryConfigured() && isStudioClipEnabled()) {
      try {
        const attached = await attachVideoFromCleanImageUrls(publishImages);
        if (attached?.videoUrl) {
          publishVideo = attached.videoUrl;
          publishVideoKind = attached.videoKind || "preview";
          console.log("[seller-listings] attached video from clean CDN stills", {
            slides: publishImages.length,
            videoUrl: String(publishVideo).slice(0, 96),
          });
        }
      } catch (err) {
        console.warn("[seller-listings] attach video from stills failed:", err.message);
      }
    }
  } else if (
    publishVideoKind !== "seller" &&
    isCloudinaryConfigured() &&
    isStudioClipEnabled()
  ) {
    try {
      const sources = [];
      for (const src of publishImages.slice(0, MAX_PHOTOS)) {
        const raw = String(src || "").trim();
        if (!raw) continue;
        if (/^https?:\/\//i.test(raw)) {
          sources.push(raw);
        } else if (/^data:/i.test(raw)) {
          const buf = decodeBase64(raw);
          if (buf?.length) sources.push(buf);
        }
      }
      if (sources.length) {
        const existingVideo =
          /^https?:\/\//i.test(String(publishVideo || "")) ? publishVideo : null;
        const showcase = await prepareListingShowcaseMedia(sources, {
          existingClipUrl: existingVideo,
          productKey: check.supplier.id,
        });
        if (showcase?.imageUrls?.length) {
          publishImages = showcase.imageUrls;
        }
        if (showcase?.videoUrl) {
          publishVideo = showcase.videoUrl;
          publishVideoKind = showcase.videoKind || "preview";
          console.log("[seller-listings] showcase reel ready", {
            slides: showcase.slideCount || showcase.imageUrls.length,
            reelTag: showcase.reelTag || null,
            error: showcase.error || null,
            videoUrl: String(publishVideo).slice(0, 96),
          });
        } else if (existingVideo) {
          // Never drop a Preview reel if multi rebuild failed.
          publishVideo = existingVideo;
          publishVideoKind = publishVideoKind || "preview";
          console.warn("[seller-listings] showcase missed video — keeping Preview reel URL");
        } else {
          console.warn("[seller-listings] showcase produced no videoUrl", {
            slides: showcase?.slideCount || showcase?.imageUrls?.length || 0,
            error: showcase?.error || null,
          });
        }
      }
    } catch (err) {
      console.warn("[seller-listings] showcase reel failed:", err.message);
    }
  }

  // Last resort: CDN stills present but still no video (client omitted reel URL).
  if (!publishVideo && isCloudinaryConfigured() && isStudioClipEnabled()) {
    const CDN = publishImages.filter(
      (u) => /^https?:\/\//i.test(String(u)) && /res\.cloudinary\.com/i.test(String(u))
    );
    if (CDN.length) {
      try {
        const attached = await attachVideoFromCleanImageUrls(CDN);
        if (attached?.videoUrl) {
          publishVideo = attached.videoUrl;
          publishVideoKind = "preview";
          console.log("[seller-listings] last-resort video attach", {
            slides: CDN.length,
            videoUrl: String(publishVideo).slice(0, 96),
          });
        }
      } catch (err) {
        console.warn("[seller-listings] last-resort video attach failed:", err.message);
      }
    }
  }

  const master = JSON.parse(await readFile(MASTER_CATALOG, "utf-8"));
  const productId = nextProductId(master, enriched.category, check.supplier.id);
  const media = await saveMediaFiles(productId, publishImages, publishVideo, publishVideoKind);
  // Never lose a Cloudinary reel URL — saveMediaFiles may skip if host checks fail mid-write.
  if (!media.videoUrl && publishVideo && isAllowedRemoteMediaUrl(publishVideo)) {
    console.warn("[seller-listings] saveMediaFiles dropped videoUrl — keeping CDN reel", {
      in: String(publishVideo).slice(0, 96),
      kind: publishVideoKind,
    });
    media.videoUrl = String(publishVideo).trim();
    media.videoKind =
      publishVideoKind === "seller" || publishVideoKind === "preview"
        ? publishVideoKind
        : "preview";
  }
  if (media.error === "video_too_large") {
    return { error: media.error, message: media.message };
  }
  if (!media.imageUrl || !(media.images || []).length) {
    return {
      error: "image_save_failed",
      message: "Could not save product photo on the server. Try a smaller JPEG and post again.",
    };
  }
  const product = await buildProduct(check.supplier, enriched, media, productId);

  master.push(product);
  await writeFile(MASTER_CATALOG, JSON.stringify(master, null, 2) + "\n", "utf-8");
  invalidateProductCache();

  if (dbProductsAvailable()) {
    try {
      const { ensureSellerSocialProfile } = await import("../db/repositories/users.js");
      await ensureSellerSocialProfile({
        phone: check.supplier.phone,
        handle: product.shopHandle || check.supplier.shopHandle || check.supplier.businessName,
        shopName: check.supplier.businessName,
        location: check.supplier.city || null,
        mpesaNumber: check.supplier.mpesaNumber || null,
        isVerified: check.supplier.isSellerVerified !== false,
      });
    } catch (err) {
      console.warn("[seller-listings] social profile ensure skipped:", err.message);
    }
    await upsertCatalogProduct(product);
  }

  linkSupplierProduct(check.supplier, productId);

  if (linkedDraft) {
    delete store.drafts[linkedDraft.id];
    await saveStore();
  }

  await unpauseCatalogIfNeeded();
  await rebuildPublicCatalog();

  const sellerPhone = normalizePhone(phone);
  // Local scan is fast — keep it in-request. Git push + WhatsApp often exceed proxy timeouts.
  const mod = await runPostPublishModeration(product, { sellerPhone });

  if (mod.moderation?.passed === false) {
    await rebuildPublicCatalog();
  }

  const liveProduct = mod.product || product;
  const status = mod.moderation?.passed === false ? "hidden_pending_review" : "live";
  rememberClientPublish(clientPublishId, productId);

  // Background: push static catalog + WhatsApp — return 201 before nginx cuts the socket.
  setImmediate(() => {
    void (async () => {
      try {
        await maybeAutoPushCatalog();
      } catch (err) {
        console.warn("[seller-listings] background catalog push:", err?.message || err);
      }
      if (status !== "live") return;
      try {
        await sendText(
          `${sellerPhone}@c.us`,
          `✅ *Listing live*\n*${liveProduct.name}*\n🆔 \`${productId}\`\n` +
            `Live on Sokoni — buyer pays KES ${liveProduct.priceKes?.toLocaleString()}, you receive KES ${liveProduct.sellerNetKes?.toLocaleString()}.`
        );
      } catch (err) {
        console.warn("[seller-listings] background WA notify:", err?.message || err);
      }
    })();
  });

  return {
    productId,
    product: liveProduct,
    status,
    moderation: mod.moderation,
    videoUrl: liveProduct.videoUrl || null,
    videoKind: liveProduct.videoKind || null,
    message:
      status === "hidden_pending_review"
        ? "Listing posted but hidden pending review — we'll WhatsApp you."
        : "Listing is live on Sokoni.",
  };
}

export async function listSellerListings(phone, sessionToken) {
  await loadStore();
  const check = await requireApprovedSeller(phone, sessionToken);
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
      .map((p) => {
        const moderationSummary = summarizeModeration(p.moderation || {}, { inStock: p.inStock });
        return {
          id: p.id,
          productId: p.id,
          status: moderationSummary.status === "hidden" ? "hidden" : "live",
          draft: {
            name: p.name,
            sourcePriceKes: p.sourcePriceKes,
            sellerNetKes: p.sellerNetKes ?? p.sourcePriceKes,
            priceKes: p.priceKes,
            buyerTotalKes: p.priceKes,
          },
          imageUrl: p.imageUrl,
          images: p.images,
          videoUrl: p.videoUrl || null,
          videoKind: p.videoKind || null,
          moderation: p.moderation,
          moderationSummary,
          createdAt: p.publishedAt || null,
        };
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {}

  return { drafts, listings: live };
}

/**
 * Pre-upload a seller phone video so /publish stays under nginx body/time limits.
 * Accepts a Buffer (binary upload) or data-URL / base64 string (legacy JSON path).
 * Returns a durable bot /catalog-images/stage_*.mp4 URL for the publish payload.
 */
export async function stageSellerVideo({ phone, videoBase64 = null, videoBuffer = null, sessionToken }) {
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) return check;

  let buffer = null;
  if (Buffer.isBuffer(videoBuffer) && videoBuffer.length) {
    if (videoBuffer.length > MAX_VIDEO_BYTES) {
      return {
        error: "video_too_large",
        message: `Video must be ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))}MB or smaller.`,
      };
    }
    buffer = videoBuffer;
  } else {
    const raw = String(videoBase64 || "").trim();
    if (!raw) {
      return { error: "missing_video", message: "Choose a video clip first." };
    }
    try {
      buffer = await resolveMediaBuffer(raw, { maxBytes: MAX_VIDEO_BYTES, label: "video" });
    } catch (err) {
      if (err?.code === "media_too_large" || /_too_large$/.test(String(err?.message || ""))) {
        return {
          error: "video_too_large",
          message: `Video must be ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))}MB or smaller.`,
        };
      }
      throw err;
    }
  }
  if (!buffer?.length) {
    return { error: "missing_video", message: "Could not read that video — try another MP4." };
  }

  if (!existsSync(IMAGES_DIR)) await mkdir(IMAGES_DIR, { recursive: true });
  const sellerSlug = String(check.supplier.id || "seller")
    .slice(-8)
    .replace(/[^a-z0-9]/gi, "") || "seller";
  const file = `stage_${sellerSlug}_${Date.now().toString(36)}.mp4`;
  await writeFile(path.join(IMAGES_DIR, file), buffer);
  const base = String(config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  const videoUrl = `${base}/catalog-images/${file}`;
  console.log("[seller-listings] staged seller video", {
    bytes: buffer.length,
    file,
    seller: check.supplier.id,
  });
  return {
    ok: true,
    videoUrl,
    videoKind: "seller",
    bytes: buffer.length,
    message: "Video uploaded — tap Post listing.",
  };
}

export async function getSellerListingMeta() {
  let browseTaxonomy = [];
  try {
    const taxPath = path.join(REPO_ROOT, "scripts", "browse-taxonomy.mjs");
    const mod = await import(pathToFileURL(taxPath).href);
    const raw = mod.BROWSE_TAXONOMY || [];
    browseTaxonomy = typeof mod.sellerBrowseTaxonomy === "function"
      ? mod.sellerBrowseTaxonomy(raw)
      : raw.filter((c) => !c.navOnly);
  } catch {}

  return {
    conditions: VALID_CONDITIONS,
    maxPhotos: MAX_PHOTOS,
    maxVideoBytes: MAX_VIDEO_BYTES,
    maxVideoSeconds: MAX_VIDEO_SECONDS,
    maxTags: MAX_TAGS,
    maxBrands: MAX_BRANDS,
    browseTaxonomy,
    shippingTiers: [],
    platformFeeRate: PLATFORM_FEE_RATE,
    minShippingKes: 0,
    sellerHandlesDispatch: true,
    eras: ["vintage", "80s", "90s", "y2k", "streetwear", "clean-girl", "cyberpunk", "goth-punk", "90s-thrift", "minimalist", "handmade"],
    visionModel: config.catalog.visionModel,
    visionProvider: "openrouter",
    nvidiaVisionEnabled: nvidiaVisionAvailable(),
    geminiVisionEnabled: geminiVisionAvailable(),
    listingVisionOrder: ["openrouter", "nvidia", "gemini"].filter((id) => {
      if (id === "openrouter") return Boolean(config.openai.apiKey);
      if (id === "nvidia") return nvidiaVisionAvailable();
      if (id === "gemini") return geminiVisionAvailable();
      return false;
    }),
    dbEnabled: dbProductsAvailable(),
    instantPublish: true,
    studioEnabled: isStudioConfigured(),
    ...getStudioMeta(),
    note: "Set up your shop (phone + M-Pesa), then list. Listings go live instantly; moderation runs after publish.",
  };
}

export { listFlaggedListings, takedownListing, restoreListing, VALID_CONDITIONS, computeFeeBreakdown };
