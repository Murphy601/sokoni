import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { computeRetailPrice } from "./pricing.js";
import { bindSellerWhatsAppChat } from "./seller-chat-ids.js";
import { shopHandleLookupKeys, shopHandlesMatch } from "../lib/shop-handle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const APPLICATIONS_FILE = path.join(DATA_DIR, "supplier-applications.json");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");
const PUBLIC_CATALOG_SCRIPT = path.join(__dirname, "..", "..", "..", "scripts", "build-site-catalog.mjs");

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

let appStore = { seq: 0, applications: {} };
let supplierStore = { suppliers: {} };
let loadedApps = false;
let loadedSuppliers = false;

function loadApps() {
  if (loadedApps) return;
  loadedApps = true;
  try {
    if (existsSync(APPLICATIONS_FILE)) {
      appStore = { seq: 0, applications: {}, ...JSON.parse(readFileSync(APPLICATIONS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[suppliers] failed to load applications:", err.message);
  }
}

function loadSuppliers() {
  if (loadedSuppliers) return;
  loadedSuppliers = true;
  try {
    if (existsSync(SUPPLIERS_FILE)) {
      supplierStore = { suppliers: {}, ...JSON.parse(readFileSync(SUPPLIERS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[suppliers] failed to load suppliers:", err.message);
  }
}

function persistApps() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(APPLICATIONS_FILE, JSON.stringify(appStore, null, 2));
  } catch (err) {
    console.error("[suppliers] failed to persist applications:", err.message);
  }
}

function persistSuppliers() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SUPPLIERS_FILE, JSON.stringify(supplierStore, null, 2));
  } catch (err) {
    console.error("[suppliers] failed to persist suppliers:", err.message);
  }
}

function slugify(text) {
  return String(text || "supplier")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function listApplications(status = null) {
  loadApps();
  let list = Object.values(appStore.applications);
  if (status) list = list.filter((a) => a.status === status);
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getApplication(id) {
  loadApps();
  return appStore.applications[id] || null;
}

export function createApplication(payload) {
  loadApps();
  appStore.seq += 1;
  const id = `SUP-${new Date().getFullYear()}-${String(appStore.seq).padStart(4, "0")}`;
  const now = Date.now();
  const applicantChatId = payload.applicantChatId ? String(payload.applicantChatId).trim() : null;
  const application = {
    id,
    status: "submitted",
    createdAt: now,
    updatedAt: now,
    applicantChatId,
    business: {
      name: String(payload.businessName || "").trim(),
      contactName: String(payload.contactName || "").trim(),
      phone: String(payload.phone || "").replace(/\D/g, ""),
      email: String(payload.email || "").trim(),
      city: String(payload.city || "").trim(),
      delivers: payload.delivers === true || payload.delivers === "yes",
      deliveryAreas: String(payload.deliveryAreas || "Countrywide").trim(),
      deliveryNote: String(payload.deliveryNote || "").trim(),
    },
    products: (payload.products || []).map((p, i) => normalizeProductDraft(p, i)),
  };

  if (!application.business.name || !application.business.phone) {
    return { error: "missing_business" };
  }
  if (application.products.length === 0) {
    return { error: "missing_products" };
  }

  appStore.applications[id] = application;
  persistApps();
  // Bind WhatsApp chat during apply — DISPATCH works after approval without LINKSELLER.
  if (applicantChatId && application.business.phone) {
    void attachSellerWhatsAppChat(application.business.phone, applicantChatId);
  }
  return { application };
}

/**
 * Persist WhatsApp chatId on the supplier + seller-chat-ids registry.
 * Call from onboarding, OTP, vendor menu, and approval so DISPATCH
 * never needs LINKSELLER for a normal seller journey.
 */
export function attachSellerWhatsAppChat(phone, chatId = null) {
  const p = normalizePhoneDigits(phone);
  if (!p) return null;

  bindSellerWhatsAppChat(chatId, p);

  loadSuppliers();
  const supplier = findSupplierByPhone(p);
  if (!supplier) return null;

  const ids = new Set(
    [...(Array.isArray(supplier.whatsappChatIds) ? supplier.whatsappChatIds : []), `${p}@c.us`].filter(
      Boolean
    )
  );
  if (chatId) {
    ids.add(String(chatId));
    supplier.whatsappChatId = String(chatId);
  }
  supplier.whatsappChatIds = [...ids];
  persistSuppliers();
  return supplier;
}

function normalizeProductDraft(p, index) {
  const supplierPriceKes = Math.max(0, Number(p.supplierPriceKes || p.priceKes) || 0);
  return {
    sku: String(p.sku || `item-${index + 1}`).trim(),
    name: String(p.name || "").trim(),
    category: String(p.category || "home-office").trim(),
    subcategory: String(p.subcategory || "").trim(),
    supplierPriceKes,
    suggestedRetailKes: computeRetailPrice(supplierPriceKes),
    inStock: p.inStock !== false,
    description: String(p.description || "").trim(),
    hasPhoto: p.hasPhoto === true,
    imageStatus: p.hasPhoto ? "supplier_pending" : "sokoni_pending",
  };
}

export function getSupplier(id) {
  loadSuppliers();
  return supplierStore.suppliers[id] || null;
}

/** Persist Paystack transfer recipient on the seller profile (one-time per M-Pesa number). */
export function saveSupplierPaystackRecipient(
  supplierId,
  { recipientCode, phone, createdAt = Date.now() } = {}
) {
  loadSuppliers();
  const supplier = supplierStore.suppliers[supplierId];
  if (!supplier || !recipientCode) return null;
  supplier.paystackRecipientCode = String(recipientCode).trim();
  supplier.paystackRecipientPhone = phone ? normalizePhoneDigits(phone) : supplier.mpesaNumber || null;
  supplier.paystackRecipientAt = createdAt;
  persistSuppliers();
  return supplier;
}

export function listSuppliers() {
  loadSuppliers();
  return Object.values(supplierStore.suppliers);
}

function normalizePhoneDigits(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

function phoneDigitsMatch(a, b) {
  const x = normalizePhoneDigits(a);
  const y = normalizePhoneDigits(b);
  if (!x || !y) return false;
  return x === y || x.slice(-9) === y.slice(-9);
}

/** Approved supplier record for a WhatsApp / M-Pesa phone, if any. */
export function findSupplierByPhone(phone) {
  loadSuppliers();
  const target = normalizePhoneDigits(phone);
  if (!target) return null;
  return (
    Object.values(supplierStore.suppliers).find((s) => {
      if (phoneDigitsMatch(s.phone, target)) return true;
      if (phoneDigitsMatch(s.mpesaNumber, target)) return true;
      return false;
    }) || null
  );
}

export async function approveApplication(applicationId, { retailOverrides = {} } = {}) {
  loadApps();
  loadSuppliers();
  const app = appStore.applications[applicationId];
  if (!app) return { error: "not_found" };
  if (app.status === "approved") return { error: "already_approved" };

  const supplierId = `sup-${slugify(app.business.name)}-${Date.now().toString(36).slice(-4)}`;
  const applicantChatId = app.applicantChatId || null;
  const supplier = {
    id: supplierId,
    applicationId,
    businessName: app.business.name,
    contactName: app.business.contactName,
    phone: app.business.phone,
    email: app.business.email,
    city: app.business.city,
    delivers: app.business.delivers,
    deliveryAreas: app.business.deliveryAreas,
    deliveryNote: app.business.deliveryNote,
    approvedAt: Date.now(),
    productIds: [],
    whatsappChatId: applicantChatId,
    whatsappChatIds: [
      ...new Set(
        [applicantChatId, app.business.phone ? `${normalizePhoneDigits(app.business.phone)}@c.us` : null].filter(
          Boolean
        )
      ),
    ],
  };

  const master = JSON.parse(await readFile(MASTER_CATALOG, "utf-8"));
  const added = [];

  for (const draft of app.products) {
    if (!draft.name || !draft.supplierPriceKes) continue;
    const productId = `${supplierId}-${slugify(draft.sku || draft.name)}`.slice(0, 48);
    const retail =
      retailOverrides[draft.sku] != null
        ? Number(retailOverrides[draft.sku])
        : draft.suggestedRetailKes || computeRetailPrice(draft.supplierPriceKes);

    const product = {
      id: productId,
      name: draft.name,
      category: draft.category,
      subcategory: draft.subcategory || draft.category,
      sourcePriceKes: draft.supplierPriceKes,
      priceKes: retail,
      rating: 4.5,
      reviews: 0,
      source: app.business.name,
      supplierId,
      supplierSku: draft.sku,
      emoji: CATEGORY_EMOJI[draft.category] || "🛍️",
      tags: [],
      scope: "local",
      fulfillment: "store",
      payment: "cod",
      inStock: draft.inStock !== false,
      imageStatus: draft.imageStatus,
      ...(draft.description ? { description: draft.description } : {}),
    };

    const existingIdx = master.findIndex((p) => p.id === productId);
    if (existingIdx >= 0) {
      const { preserveSoldState } = await import("./product-availability.js");
      master[existingIdx] = preserveSoldState(master[existingIdx], product);
    } else {
      master.push(product);
    }

    supplier.productIds.push(productId);
    added.push(product);
  }

  await writeFile(MASTER_CATALOG, JSON.stringify(master, null, 2) + "\n", "utf-8");
  try {
    const { enforceSoldLocksOnMaster } = await import("./product-availability.js");
    await enforceSoldLocksOnMaster();
  } catch (err) {
    console.warn("[suppliers] sold-lock enforce:", err.message);
  }

  supplierStore.suppliers[supplierId] = supplier;
  persistSuppliers();

  app.status = "approved";
  app.supplierId = supplierId;
  app.updatedAt = Date.now();
  app.approvedProductCount = added.length;
  persistApps();

  if (app.business.phone) {
    attachSellerWhatsAppChat(app.business.phone, applicantChatId);
  }

  try {
    const { execSync } = await import("node:child_process");
    execSync("node scripts/build-site-catalog.mjs", {
      cwd: path.join(__dirname, "..", "..", ".."),
      stdio: "pipe",
    });
  } catch (err) {
    console.warn("[suppliers] catalog rebuild failed — run manually:", err.message);
  }

  return { supplier, products: added, application: app };
}

export function createPeerSeller({
  phone,
  shopName,
  shopHandle,
  mpesaNumber,
  nationalId = "",
  kraPin = "",
  whatsappChatId = null,
} = {}) {
  loadSuppliers();
  const normalizedPhone = normalizePhoneDigits(phone);
  const existing = findSupplierByPhone(phone);
  if (existing) {
    if (mpesaNumber) {
      const nextMpesa = normalizePhoneDigits(mpesaNumber);
      if (nextMpesa && existing.mpesaNumber && existing.mpesaNumber !== nextMpesa) {
        existing.paystackRecipientCode = null;
        existing.paystackRecipientPhone = null;
        existing.paystackRecipientAt = null;
      }
      existing.mpesaNumber = nextMpesa || mpesaNumber;
    }
    if (shopHandle) existing.shopHandle = shopHandle;
    if (nationalId) existing.nationalId = nationalId;
    if (kraPin) existing.kraPin = String(kraPin).trim().toUpperCase();
    // Existing live sellers stay approved — no re-friction.
    if (!existing.kycStatus) existing.kycStatus = "approved";
    existing.isSellerVerified = true;
    existing.role = "SELLER";
    persistSuppliers();
    attachSellerWhatsAppChat(normalizedPhone, whatsappChatId);
    return { supplier: existing, existing: true };
  }

  const handle = String(shopHandle || shopName || "shop")
    .replace(/^@/, "")
    .trim();
  const id = `seller-${slugify(handle)}-${Date.now().toString(36).slice(-4)}`;
  const cus = normalizedPhone ? `${normalizedPhone}@c.us` : null;
  const hasKyc = Boolean(String(nationalId || "").trim() || String(kraPin || "").trim());
  const supplier = {
    id,
    businessName: String(shopName || handle).trim(),
    shopHandle: handle ? `@${handle.replace(/^@/, "")}` : null,
    contactName: String(shopName || handle).trim(),
    phone: normalizedPhone,
    mpesaNumber: normalizePhoneDigits(mpesaNumber),
    nationalId: String(nationalId || "").trim() || null,
    kraPin: String(kraPin || "").trim().toUpperCase() || null,
    // Soft KYC: can list immediately; admin queue reviews ID/KRA. Hard gate is opt-in via env.
    kycStatus: hasKyc ? "pending" : "pending",
    isSellerVerified: false,
    role: "SELLER",
    peerSeller: true,
    approvedAt: Date.now(),
    productIds: [],
    city: "",
    delivers: true,
    deliveryAreas: "Countrywide",
    whatsappChatId: whatsappChatId || cus,
    whatsappChatIds: [...new Set([whatsappChatId, cus].filter(Boolean))],
  };

  supplierStore.suppliers[id] = supplier;
  persistSuppliers();
  attachSellerWhatsAppChat(normalizedPhone, whatsappChatId);
  return { supplier, existing: false };
}

/** Soft-update payout / bank details for admin manual rails. Live withdraw uses mpesaNumber. */
export function updatePeerSellerPayoutDetails(
  phone,
  {
    mpesaNumber,
    bankName,
    bankAccountName,
    bankAccountNumber,
    mpesaTill,
    mpesaPaybill,
    paybillAccount,
  } = {}
) {
  loadSuppliers();
  const existing = findSupplierByPhone(phone);
  if (!existing) {
    return { error: "not_found", message: "Seller profile not found." };
  }
  if (mpesaNumber !== undefined) {
    const next = normalizePhoneDigits(mpesaNumber);
    if (next && existing.mpesaNumber && existing.mpesaNumber !== next) {
      existing.paystackRecipientCode = null;
      existing.paystackRecipientPhone = null;
      existing.paystackRecipientAt = null;
    }
    if (next) existing.mpesaNumber = next;
  }
  if (bankName !== undefined) existing.bankName = String(bankName || "").trim().slice(0, 80) || null;
  if (bankAccountName !== undefined) {
    existing.bankAccountName = String(bankAccountName || "").trim().slice(0, 120) || null;
  }
  if (bankAccountNumber !== undefined) {
    existing.bankAccountNumber = String(bankAccountNumber || "").replace(/\s+/g, "").slice(0, 32) || null;
  }
  if (mpesaTill !== undefined) existing.mpesaTill = String(mpesaTill || "").replace(/\D/g, "").slice(0, 12) || null;
  if (mpesaPaybill !== undefined) {
    existing.mpesaPaybill = String(mpesaPaybill || "").replace(/\D/g, "").slice(0, 12) || null;
  }
  if (paybillAccount !== undefined) {
    existing.paybillAccount = String(paybillAccount || "").trim().slice(0, 40) || null;
  }
  persistSuppliers();
  return { supplier: existing };
}

/** Admin KYC queue — peer sellers awaiting ID / KRA review. */
export function listSellerKycQueue({ status = "pending" } = {}) {
  loadSuppliers();
  const wanted = String(status || "pending").toLowerCase();
  return Object.values(supplierStore.suppliers || {})
    .filter((s) => s?.peerSeller)
    .filter((s) => {
      const st = String(s.kycStatus || (s.isSellerVerified ? "approved" : "pending")).toLowerCase();
      if (wanted === "all") return true;
      return st === wanted;
    })
    .map((s) => ({
      id: s.id,
      businessName: s.businessName,
      shopHandle: s.shopHandle,
      phone: s.phone,
      mpesaNumber: s.mpesaNumber,
      nationalId: s.nationalId || null,
      kraPin: s.kraPin || null,
      city: s.city || "",
      kycStatus: s.kycStatus || (s.isSellerVerified ? "approved" : "pending"),
      isSellerVerified: Boolean(s.isSellerVerified),
      shopStatus: s.shopStatus || "live",
      payoutHold: Boolean(s.payoutHold),
      approvedAt: s.approvedAt || null,
      kycReviewedAt: s.kycReviewedAt || null,
      kycNote: s.kycNote || null,
    }))
    .sort((a, b) => (b.approvedAt || 0) - (a.approvedAt || 0));
}

export function reviewSellerKyc(supplierId, { approve = true, note = "" } = {}) {
  loadSuppliers();
  const s = supplierStore.suppliers[supplierId];
  if (!s) return { error: "not_found", message: "Seller not found." };
  s.kycStatus = approve ? "approved" : "rejected";
  s.isSellerVerified = Boolean(approve);
  s.kycReviewedAt = Date.now();
  s.kycNote = String(note || "").trim().slice(0, 280) || null;
  persistSuppliers();
  return { supplier: s };
}

/** Soft-update JSON peer seller identity fields used by seller session auth. */
export function updatePeerSellerProfile(phone, { shopName, shopHandle, city, promoBanner, offerNote } = {}) {
  loadSuppliers();
  const existing = findSupplierByPhone(phone);
  if (!existing) {
    return { error: "not_found", message: "Seller profile not found." };
  }

  if (shopName !== undefined) {
    const name = String(shopName || "").trim();
    if (name) {
      existing.businessName = name;
      existing.contactName = name;
    }
  }
  if (shopHandle !== undefined) {
    const handle = String(shopHandle || "")
      .replace(/^@+/, "")
      .trim();
    existing.shopHandle = handle ? `@${handle}` : existing.shopHandle;
  }
  if (city !== undefined) {
    existing.city = String(city || "").trim();
  }
  if (promoBanner !== undefined) {
    existing.promoBanner = String(promoBanner || "").trim().slice(0, 160);
    existing.promoBannerUpdatedAt = Date.now();
  }
  if (offerNote !== undefined) {
    existing.offerNote = String(offerNote || "").trim().slice(0, 240);
    existing.offerNoteUpdatedAt = Date.now();
  }

  persistSuppliers();
  return { supplier: existing };
}

export function rejectApplication(applicationId, reason = "") {
  loadApps();
  const app = appStore.applications[applicationId];
  if (!app) return { error: "not_found" };
  app.status = "rejected";
  app.rejectionReason = reason;
  app.updatedAt = Date.now();
  persistApps();
  return { application: app };
}

export const SUPPLIER_CATEGORIES = Object.keys(CATEGORY_EMOJI);

const SHOP_STATUSES = new Set(["live", "paused", "under_review", "deactivated"]);

export function getSupplierByHandle(handle) {
  loadSuppliers();
  const keys = shopHandleLookupKeys(handle);
  if (!keys.length) return null;
  const keySet = new Set(keys);
  return (
    Object.values(supplierStore.suppliers || {}).find((s) => {
      const candidates = [s.shopHandle, s.businessName, s.shopName, s.id];
      return candidates.some((c) => {
        if (!c) return false;
        return shopHandleLookupKeys(c).some((k) => keySet.has(k)) || shopHandlesMatch(c, handle);
      });
    }) || null
  );
}

export function isShopPubliclyVisible(supplier) {
  if (!supplier) return true;
  const st = String(supplier.shopStatus || "live").toLowerCase();
  return st === "live";
}

export function sellerPayoutsHeld(supplier) {
  if (!supplier) return false;
  if (supplier.payoutHold) return true;
  const st = String(supplier.shopStatus || "live").toLowerCase();
  return st === "under_review" || st === "deactivated" || st === "paused";
}

/**
 * Admin shop review — pause/deactivate removes public presence + holds M-Pesa withdraws.
 * restore returns shop to live and clears payout hold.
 */
export function setSellerShopStatus(
  supplierId,
  { status = "under_review", note = "", holdPayouts = null } = {}
) {
  loadSuppliers();
  const s = supplierStore.suppliers[supplierId];
  if (!s) return { error: "not_found", message: "Seller not found." };

  const next = String(status || "").trim().toLowerCase();
  if (!SHOP_STATUSES.has(next)) {
    return { error: "invalid_status", message: "Use live, paused, under_review, or deactivated." };
  }

  const prev = String(s.shopStatus || "live").toLowerCase();
  s.shopStatus = next;
  s.shopStatusNote = String(note || "").trim().slice(0, 280) || null;
  s.shopStatusAt = Date.now();
  if (holdPayouts == null) {
    s.payoutHold = next !== "live";
  } else {
    s.payoutHold = Boolean(holdPayouts);
  }
  if (next === "live") {
    s.isSellerVerified = s.kycStatus === "rejected" ? false : true;
    if (!s.kycStatus || s.kycStatus === "pending") s.kycStatus = "approved";
  }
  persistSuppliers();
  return { supplier: s, previousStatus: prev };
}

export function listShopsForAdminReview({ status = "all" } = {}) {
  loadSuppliers();
  const wanted = String(status || "all").toLowerCase();
  return Object.values(supplierStore.suppliers || {})
    .filter((s) => s?.peerSeller || s?.role === "SELLER")
    .filter((s) => {
      const st = String(s.shopStatus || "live").toLowerCase();
      if (wanted === "all") return true;
      if (wanted === "held") return st !== "live" || Boolean(s.payoutHold);
      return st === wanted;
    })
    .map((s) => ({
      id: s.id,
      businessName: s.businessName,
      shopHandle: s.shopHandle,
      phone: s.phone,
      mpesaNumber: s.mpesaNumber,
      city: s.city || "",
      shopStatus: s.shopStatus || "live",
      payoutHold: Boolean(s.payoutHold) || sellerPayoutsHeld(s),
      shopStatusNote: s.shopStatusNote || null,
      shopStatusAt: s.shopStatusAt || null,
      kycStatus: s.kycStatus || (s.isSellerVerified ? "approved" : "pending"),
      nationalId: s.nationalId || null,
      kraPin: s.kraPin || null,
      isSellerVerified: Boolean(s.isSellerVerified),
      verifiedBadge: Boolean(s.verifiedBadge ?? s.isSellerVerified),
      commissionPct:
        s.commissionPct != null
          ? Number(s.commissionPct)
          : s.platformCommissionPct != null
            ? Number(s.platformCommissionPct)
            : null,
    }))
    .sort((a, b) => (b.shopStatusAt || b.approvedAt || 0) - (a.shopStatusAt || a.approvedAt || 0));
}

/**
 * Admin patch for Sellers & Shops desk (badge, commission, payout hold, handle).
 */
export function patchSupplierAdmin(supplierId, patch = {}) {
  loadSuppliers();
  const s = supplierStore.suppliers[supplierId];
  if (!s) return { error: "not_found", message: "Seller not found." };

  if (
    patch.verifiedBadge != null ||
    patch.isSellerVerified != null ||
    patch.isVerifiedStore != null ||
    patch.is_verified_store != null
  ) {
    const v = Boolean(
      patch.verifiedBadge ??
        patch.isSellerVerified ??
        patch.isVerifiedStore ??
        patch.is_verified_store
    );
    s.verifiedBadge = v;
    s.isSellerVerified = v;
    s.isVerifiedStore = v;
    if (v && s.kycStatus !== "approved") s.kycStatus = "approved";
  }

  if (patch.commissionPct != null) {
    const pct = Number(patch.commissionPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 40) {
      return { error: "invalid_commission", message: "commissionPct must be 0–40." };
    }
    s.commissionPct = pct;
    s.platformCommissionPct = pct;
    s.commissionUpdatedAt = Date.now();
  }

  if (patch.payoutHold != null) {
    s.payoutHold = Boolean(patch.payoutHold);
    s.payoutHoldNote = String(patch.payoutHoldNote || patch.note || "").slice(0, 280) || null;
    s.payoutHoldAt = Date.now();
  }

  if (patch.shopHandle != null) {
    const cleaned = String(patch.shopHandle || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 40);
    if (!cleaned || cleaned.length < 3) {
      return { error: "invalid_handle", message: "Handle must be 3–40 letters/numbers/_." };
    }
    const clash = Object.values(supplierStore.suppliers).find((other) => {
      if (other.id === supplierId) return false;
      return (
        String(other.shopHandle || "")
          .replace(/^@/, "")
          .toLowerCase() === cleaned
      );
    });
    if (clash) {
      return { error: "handle_taken", message: `@${cleaned} is already used.` };
    }
    s.shopHandle = `@${cleaned}`;
  }

  if (patch.businessName != null) {
    const name = String(patch.businessName || "").trim().slice(0, 100);
    if (name) s.businessName = name;
  }

  if (patch.phone != null) {
    const phone = String(patch.phone || "").replace(/\D/g, "");
    if (phone.length >= 9) s.phone = phone;
  }

  if (patch.description != null || patch.bio != null) {
    s.description = String(patch.description || patch.bio || "").slice(0, 500);
  }

  persistSuppliers();
  return { ok: true, supplier: s };
}

/** Permanently remove a supplier record (hard delete). */
export function removeSupplierFromStore(supplierId) {
  loadSuppliers();
  const id = String(supplierId || "").trim();
  if (!id || !supplierStore.suppliers[id]) {
    return { ok: false, error: "not_found" };
  }
  delete supplierStore.suppliers[id];
  persistSuppliers();
  return { ok: true, id };
}

/** Remove seller applications matching a phone (frees re-apply). */
export function removeApplicationsForPhone(phone) {
  loadApps();
  const target = normalizePhoneDigits(phone);
  if (!target || target.length < 9) return { ok: true, removed: 0 };
  const tail = target.slice(-9);
  let removed = 0;
  for (const [id, app] of Object.entries(appStore.applications || {})) {
    const p = normalizePhoneDigits(app?.business?.phone || app?.phone || "");
    if (p && (p === target || p.slice(-9) === tail)) {
      delete appStore.applications[id];
      removed += 1;
    }
  }
  if (removed) persistApps();
  return { ok: true, removed };
}
