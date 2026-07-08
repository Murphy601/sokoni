import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { computeRetailPrice } from "./pricing.js";

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
  const application = {
    id,
    status: "submitted",
    createdAt: now,
    updatedAt: now,
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
  return { application };
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

export async function approveApplication(applicationId, { retailOverrides = {} } = {}) {
  loadApps();
  loadSuppliers();
  const app = appStore.applications[applicationId];
  if (!app) return { error: "not_found" };
  if (app.status === "approved") return { error: "already_approved" };

  const supplierId = `sup-${slugify(app.business.name)}-${Date.now().toString(36).slice(-4)}`;
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
