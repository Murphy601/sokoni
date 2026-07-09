import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const APPLICATIONS_FILE = path.join(DATA_DIR, "pickup-point-applications.json");
const POINTS_FILE = path.join(DATA_DIR, "pickup-points.json");
const WEBSITE_POINTS_FILE = path.join(__dirname, "..", "..", "..", "website", "data", "pickup-points.json");

export const COMMISSION_PER_PARCEL_KES = 50;

export const SHOP_TYPES = [
  "Phone & electronics shop",
  "General store / Duka",
  "Cyber café",
  "Pharmacy",
  "Supermarket",
  "Other retail",
];

export const KENYA_COUNTIES = [
  "Nairobi",
  "Mombasa",
  "Kiambu",
  "Nakuru",
  "Kisumu",
  "Uasin Gishu",
  "Machakos",
  "Kajiado",
  "Meru",
  "Embu",
  "Nyeri",
  "Kakamega",
  "Kilifi",
  "Kwale",
  "Other",
];

let appStore = { seq: 0, applications: {} };
let pointStore = { pickupPoints: {} };
let loadedApps = false;
let loadedPoints = false;

function loadApps() {
  if (loadedApps) return;
  loadedApps = true;
  try {
    if (existsSync(APPLICATIONS_FILE)) {
      appStore = { seq: 0, applications: {}, ...JSON.parse(readFileSync(APPLICATIONS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[pickup-points] failed to load applications:", err.message);
  }
}

function loadPoints() {
  if (loadedPoints) return;
  loadedPoints = true;
  try {
    if (existsSync(POINTS_FILE)) {
      pointStore = { pickupPoints: {}, ...JSON.parse(readFileSync(POINTS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[pickup-points] failed to load pickup points:", err.message);
  }
}

function persistApps() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(APPLICATIONS_FILE, JSON.stringify(appStore, null, 2));
  } catch (err) {
    console.error("[pickup-points] failed to persist applications:", err.message);
  }
}

function persistPoints() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(POINTS_FILE, JSON.stringify(pointStore, null, 2));
    syncWebsitePickupPoints();
  } catch (err) {
    console.error("[pickup-points] failed to persist pickup points:", err.message);
  }
}

function syncWebsitePickupPoints() {
  try {
    const webDir = path.dirname(WEBSITE_POINTS_FILE);
    if (!existsSync(webDir)) mkdirSync(webDir, { recursive: true });
    const publicList = listPickupPoints().map((p) => ({
      id: p.id,
      shopName: p.shopName,
      city: p.city,
      county: p.county,
      address: p.address,
      landmark: p.landmark || "",
      openingHours: p.openingHours || "",
      shopType: p.shopType || "",
    }));
    writeFileSync(
      WEBSITE_POINTS_FILE,
      JSON.stringify({ updatedAt: Date.now(), pickupPoints: publicList }, null, 2)
    );
  } catch (err) {
    console.warn("[pickup-points] could not sync website copy:", err.message);
  }
}

function slugify(text) {
  return String(text || "shop")
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
  const id = `PP-${new Date().getFullYear()}-${String(appStore.seq).padStart(4, "0")}`;
  const now = Date.now();

  const application = {
    id,
    status: "submitted",
    createdAt: now,
    updatedAt: now,
    shop: {
      name: String(payload.shopName || "").trim(),
      contactName: String(payload.contactName || "").trim(),
      phone: String(payload.phone || "").replace(/\D/g, ""),
      email: String(payload.email || "").trim(),
      county: String(payload.county || "").trim(),
      city: String(payload.city || "").trim(),
      address: String(payload.address || "").trim(),
      landmark: String(payload.landmark || "").trim(),
      openingHours: String(payload.openingHours || "").trim(),
      shopType: String(payload.shopType || SHOP_TYPES[0]).trim(),
      hasSecureStorage: payload.hasSecureStorage === true || payload.hasSecureStorage === "yes",
      hasCctv: payload.hasCctv === true || payload.hasCctv === "yes",
      canCollectPayment: payload.canCollectPayment !== false && payload.canCollectPayment !== "no",
      mpesaNumber: String(payload.mpesaNumber || "").replace(/\D/g, ""),
      maxParcelsPerDay: Math.max(0, Number(payload.maxParcelsPerDay) || 0) || null,
      notes: String(payload.notes || "").trim(),
    },
  };

  if (!application.shop.name || !application.shop.phone) {
    return { error: "missing_shop" };
  }
  if (!application.shop.county || !application.shop.city || !application.shop.address) {
    return { error: "missing_location" };
  }

  appStore.applications[id] = application;
  persistApps();
  return { application };
}

export function listPickupPoints() {
  loadPoints();
  return Object.values(pointStore.pickupPoints)
    .filter((p) => p.active !== false)
    .sort((a, b) => (a.county || "").localeCompare(b.county || "") || (a.city || "").localeCompare(b.city || ""));
}

export function getPickupPoint(id) {
  loadPoints();
  return pointStore.pickupPoints[id] || null;
}

export function approveApplication(applicationId) {
  loadApps();
  loadPoints();
  const app = appStore.applications[applicationId];
  if (!app) return { error: "not_found" };
  if (app.status === "approved") return { error: "already_approved" };

  const pointId = `pp-${slugify(app.shop.name)}-${Date.now().toString(36).slice(-4)}`;
  const point = {
    id: pointId,
    applicationId,
    shopName: app.shop.name,
    contactName: app.shop.contactName,
    phone: app.shop.phone,
    email: app.shop.email,
    county: app.shop.county,
    city: app.shop.city,
    address: app.shop.address,
    landmark: app.shop.landmark,
    openingHours: app.shop.openingHours,
    shopType: app.shop.shopType,
    hasSecureStorage: app.shop.hasSecureStorage,
    hasCctv: app.shop.hasCctv,
    canCollectPayment: app.shop.canCollectPayment,
    mpesaNumber: app.shop.mpesaNumber,
    maxParcelsPerDay: app.shop.maxParcelsPerDay,
    notes: app.shop.notes,
    commissionPerParcelKes: COMMISSION_PER_PARCEL_KES,
    approvedAt: Date.now(),
    active: true,
  };

  pointStore.pickupPoints[pointId] = point;
  persistPoints();

  app.status = "approved";
  app.pickupPointId = pointId;
  app.updatedAt = Date.now();
  persistApps();

  return { pickupPoint: point, application: app };
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
