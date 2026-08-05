import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { computeRetailPrice } from "./pricing.js";
import { bindSellerWhatsAppChat } from "./seller-chat-ids.js";

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
    if (existingIdx >= 0) master[existingIdx] = product;
    else master.push(product);

    supplier.productIds.push(productId);
    added.push(product);
  }

  await writeFile(MASTER_CATALOG, JSON.stringify(master, null, 2) + "\n", "utf-8");

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
  whatsappChatId = null,
} = {}) {
  loadSuppliers();
  const normalizedPhone = normalizePhoneDigits(phone);
  const existing = findSupplierByPhone(phone);
  if (existing) {
    if (mpesaNumber) existing.mpesaNumber = mpesaNumber;
    if (shopHandle) existing.shopHandle = shopHandle;
    if (nationalId) existing.nationalId = nationalId;
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
  const supplier = {
    id,
    businessName: String(shopName || handle).trim(),
    shopHandle: handle ? `@${handle.replace(/^@/, "")}` : null,
    contactName: String(shopName || handle).trim(),
    phone: normalizedPhone,
    mpesaNumber: normalizePhoneDigits(mpesaNumber),
    nationalId: String(nationalId || "").trim() || null,
    isSellerVerified: true,
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

/** Soft-update JSON peer seller identity fields used by seller session auth. */
export function updatePeerSellerProfile(phone, { shopName, shopHandle, city } = {}) {
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
