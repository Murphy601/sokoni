/**
 * Vendor shipping profiles + delivery zones.
 * JSON-first (works without Postgres); mirrors to DB when enabled.
 * Default: no profile → shipping stays 0 (existing seller-handled behaviour).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbEnabled, query } from "../db/pool.js";
import {
  getCounty,
  getTierMeta,
  platformDefaultFeeForCounty,
} from "./kenya-locations.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const STORE_FILE = path.join(DATA_DIR, "vendor-shipping.json");

const SHIPPING_TYPES = new Set(["FLAT_RATE", "TIERED", "CUSTOM_ZONES", "LOCAL_ONLY"]);

function emptyStore() {
  return { profiles: {}, zones: {} };
}

function readStore() {
  try {
    if (!existsSync(STORE_FILE)) return emptyStore();
    const raw = JSON.parse(readFileSync(STORE_FILE, "utf8"));
    return {
      profiles: raw.profiles && typeof raw.profiles === "object" ? raw.profiles : {},
      zones: raw.zones && typeof raw.zones === "object" ? raw.zones : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(store, null, 2) + "\n";
  const tmp = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, payload, "utf8");
  renameSync(tmp, STORE_FILE);
}

export function normalizeVendorKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

/** True when the seller explicitly saved rates (not an auto-created shell). */
export function isConfiguredShippingProfile(profile) {
  if (!profile) return false;
  if (profile.sellerConfigured === true) return true;
  if (profile.sellerConfigured === false) return false;
  // Legacy: getOrCreate writes equal timestamps; a real save bumps updatedAt.
  return Boolean(
    profile.updatedAt && profile.createdAt && profile.updatedAt !== profile.createdAt
  );
}

function defaultProfile(vendorKey) {
  return {
    id: randomUUID(),
    vendorKey,
    shippingType: "FLAT_RATE",
    flatLocalRateKes: 200,
    flatUpcountryRateKes: 400,
    tier1RateKes: 200,
    tier2RateKes: 350,
    tier3RateKes: 450,
    tier4RateKes: 750,
    supportedTiers: [1, 2, 3, 4],
    localCounties: [],
    isFreeShippingEnabled: false,
    localExpressEnabled: false,
    sellerConfigured: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function getVendorShippingProfile(vendorKeyRaw) {
  const vendorKey = normalizeVendorKey(vendorKeyRaw);
  if (!vendorKey) return null;
  const store = readStore();
  return store.profiles[vendorKey] || null;
}

export function getOrCreateVendorShippingProfile(vendorKeyRaw) {
  const vendorKey = normalizeVendorKey(vendorKeyRaw);
  if (!vendorKey) return null;
  const existing = getVendorShippingProfile(vendorKey);
  if (existing) return existing;
  const profile = defaultProfile(vendorKey);
  const store = readStore();
  store.profiles[vendorKey] = profile;
  writeStore(store);
  void mirrorProfileToDb(profile).catch(() => {});
  return profile;
}

export function upsertVendorShippingProfile(vendorKeyRaw, patch = {}) {
  const vendorKey = normalizeVendorKey(vendorKeyRaw);
  if (!vendorKey) return { ok: false, error: "vendor_required" };
  const store = readStore();
  const prev = store.profiles[vendorKey] || defaultProfile(vendorKey);
  const shippingType = SHIPPING_TYPES.has(String(patch.shippingType || prev.shippingType))
    ? String(patch.shippingType || prev.shippingType)
    : prev.shippingType;

  const next = {
    ...prev,
    vendorKey,
    shippingType,
    flatLocalRateKes: numOr(patch.flatLocalRateKes, prev.flatLocalRateKes),
    flatUpcountryRateKes: numOr(patch.flatUpcountryRateKes, prev.flatUpcountryRateKes),
    tier1RateKes: numOr(patch.tier1RateKes, prev.tier1RateKes),
    tier2RateKes: numOr(patch.tier2RateKes, prev.tier2RateKes),
    tier3RateKes: numOr(patch.tier3RateKes, prev.tier3RateKes),
    tier4RateKes: numOr(patch.tier4RateKes, prev.tier4RateKes),
    supportedTiers: Array.isArray(patch.supportedTiers)
      ? patch.supportedTiers.map(Number).filter((t) => t >= 1 && t <= 4)
      : prev.supportedTiers || [1, 2, 3, 4],
    localCounties: Array.isArray(patch.localCounties)
      ? patch.localCounties.map((c) => String(c).trim()).filter(Boolean)
      : prev.localCounties || [],
    isFreeShippingEnabled: boolOr(patch.isFreeShippingEnabled, prev.isFreeShippingEnabled),
    localExpressEnabled: boolOr(patch.localExpressEnabled, prev.localExpressEnabled),
    sellerConfigured: true,
    updatedAt: new Date().toISOString(),
  };
  store.profiles[vendorKey] = next;
  writeStore(store);
  void mirrorProfileToDb(next).catch(() => {});
  return { ok: true, profile: next };
}

export function listVendorZones(vendorKeyRaw) {
  const vendorKey = normalizeVendorKey(vendorKeyRaw);
  if (!vendorKey) return [];
  const store = readStore();
  return Object.values(store.zones).filter((z) => z.vendorKey === vendorKey && z.isActive !== false);
}

export function saveVendorZone(vendorKeyRaw, { zoneName, priceKes, boundary, id } = {}) {
  const vendorKey = normalizeVendorKey(vendorKeyRaw);
  if (!vendorKey) return { ok: false, error: "vendor_required" };
  const name = String(zoneName || "").trim().slice(0, 160);
  if (!name) return { ok: false, error: "zone_name_required" };
  const price = Math.max(0, Math.round(Number(priceKes) || 0));
  const geo = normalizePolygon(boundary);
  if (!geo) return { ok: false, error: "invalid_polygon" };

  const store = readStore();
  const zoneId = id && store.zones[id]?.vendorKey === vendorKey ? id : randomUUID();
  const zone = {
    id: zoneId,
    vendorKey,
    zoneName: name,
    priceKes: price,
    boundary: geo,
    isActive: true,
    createdAt: store.zones[zoneId]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.zones[zoneId] = zone;
  writeStore(store);
  void mirrorZoneToDb(zone).catch(() => {});
  return { ok: true, zone };
}

export function deleteVendorZone(vendorKeyRaw, zoneId) {
  const vendorKey = normalizeVendorKey(vendorKeyRaw);
  const store = readStore();
  const zone = store.zones[zoneId];
  if (!zone || zone.vendorKey !== vendorKey) return { ok: false, error: "not_found" };
  zone.isActive = false;
  zone.updatedAt = new Date().toISOString();
  store.zones[zoneId] = zone;
  writeStore(store);
  void softDeleteZoneInDb(zoneId).catch(() => {});
  return { ok: true };
}

function numOr(v, fallback) {
  if (v == null || v === "") return Math.round(Number(fallback) || 0);
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : Math.round(Number(fallback) || 0);
}

function boolOr(v, fallback) {
  if (v === undefined) return Boolean(fallback);
  return Boolean(v);
}

/** Accept GeoJSON Polygon or { type, coordinates }. */
export function normalizePolygon(boundary) {
  if (!boundary) return null;
  let obj = boundary;
  if (typeof boundary === "string") {
    try {
      obj = JSON.parse(boundary);
    } catch {
      return null;
    }
  }
  if (obj.type === "Feature" && obj.geometry) obj = obj.geometry;
  if (obj.type === "FeatureCollection" && obj.features?.[0]?.geometry) {
    obj = obj.features[0].geometry;
  }
  if (obj.type !== "Polygon" || !Array.isArray(obj.coordinates?.[0])) return null;
  const ring = obj.coordinates[0];
  if (ring.length < 4) return null;
  // Ensure closed ring
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Resolve shipping fee for one vendor without requiring a saved profile.
 * Missing profile → fee 0 (preserves current seller-handled / no-shipping checkout).
 */
export function resolveVendorShippingFee({
  vendorKey,
  deliveryMethod = "COUNTY_DROPDOWN",
  buyerCounty,
  buyerTown,
  buyerCoordinates,
  profile: profileIn,
  zones: zonesIn,
} = {}) {
  const key = normalizeVendorKey(vendorKey);
  const rawProfile = profileIn || (key ? getVendorShippingProfile(key) : null);
  const profile = isConfiguredShippingProfile(rawProfile) ? rawProfile : null;
  const zones = zonesIn || (key ? listVendorZones(key) : []);

  if (!profile) {
    return {
      shippingFee: 0,
      methodUsed: "NO_PROFILE",
      estimatedHours: null,
      unsupported: false,
    };
  }

  if (profile.isFreeShippingEnabled) {
    return {
      shippingFee: 0,
      methodUsed: "FREE_SHIPPING",
      estimatedHours: null,
      unsupported: false,
    };
  }

  if (deliveryMethod === "MAP_PIN" && buyerCoordinates?.lat != null && buyerCoordinates?.lng != null) {
    const hit = findZoneForPoint(zones, buyerCoordinates.lng, buyerCoordinates.lat);
    if (hit) {
      return {
        shippingFee: Math.round(Number(hit.priceKes) || 0),
        methodUsed: `ZONE_POLYGON_${slug(hit.zoneName)}`,
        zoneId: hit.id,
        zoneName: hit.zoneName,
        estimatedHours: 4,
        unsupported: false,
      };
    }
    if (profile.localExpressEnabled) {
      const local = Math.round(Number(profile.flatLocalRateKes ?? profile.tier1RateKes) || 0);
      return {
        shippingFee: local,
        methodUsed: "LOCAL_EXPRESS_FALLBACK",
        estimatedHours: 4,
        unsupported: false,
      };
    }
  }

  const county = getCounty(buyerCounty);
  if (!county) {
    return {
      shippingFee: 0,
      methodUsed: "COUNTY_UNKNOWN",
      estimatedHours: null,
      unsupported: true,
      message: "Select a valid Kenyan county.",
    };
  }

  if (profile.shippingType === "LOCAL_ONLY") {
    const allowed = (profile.localCounties || []).map((c) => c.toLowerCase());
    if (allowed.length && !allowed.includes(county.name.toLowerCase())) {
      return {
        shippingFee: 0,
        methodUsed: "LOCAL_ONLY_UNSUPPORTED",
        estimatedHours: null,
        unsupported: true,
        message: `This seller only delivers within: ${(profile.localCounties || []).join(", ")}.`,
      };
    }
  }

  const supported = profile.supportedTiers?.length
    ? profile.supportedTiers.map(Number)
    : [1, 2, 3, 4];
  if (!supported.includes(county.tier)) {
    return {
      shippingFee: 0,
      methodUsed: "TIER_DISABLED",
      estimatedHours: null,
      unsupported: true,
      message: `This seller does not ship to Tier ${county.tier} counties.`,
    };
  }

  let fee = 0;
  let methodUsed = "PLATFORM_DEFAULT";

  if (profile.shippingType === "FLAT_RATE") {
    const isLocal =
      county.tier === 1 ||
      (profile.localCounties || []).some((c) => c.toLowerCase() === county.name.toLowerCase());
    fee = isLocal
      ? Math.round(Number(profile.flatLocalRateKes) || 0)
      : Math.round(Number(profile.flatUpcountryRateKes) || 0);
    methodUsed = isLocal ? "FLAT_LOCAL" : "FLAT_UPCOUNTRY";
  } else if (profile.shippingType === "TIERED" || profile.shippingType === "CUSTOM_ZONES") {
    const keyRate = `tier${county.tier}RateKes`;
    const custom = profile[keyRate];
    if (custom != null && custom !== "") {
      fee = Math.round(Number(custom) || 0);
      methodUsed = `TIER_${county.tier}_CUSTOM`;
    } else {
      fee = platformDefaultFeeForCounty(county.name);
      methodUsed = `TIER_${county.tier}_PLATFORM`;
    }
  } else {
    fee = platformDefaultFeeForCounty(county.name);
    methodUsed = `TIER_${county.tier}_PLATFORM`;
  }

  const tierMeta = getTierMeta(county.tier);
  return {
    shippingFee: Math.max(0, fee),
    methodUsed,
    estimatedHours: tierMeta?.estimatedHours ?? county.estimatedHours,
    county: county.name,
    town: buyerTown || null,
    tier: county.tier,
    unsupported: false,
  };
}

function slug(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

/** Ray-casting point-in-polygon (lng/lat). Avoids hard dep when Turf unavailable. */
export function pointInPolygon(lng, lat, polygon) {
  const ring = polygon?.coordinates?.[0];
  if (!ring || ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findZoneForPoint(zones, lng, lat) {
  for (const z of zones || []) {
    if (z.isActive === false) continue;
    if (pointInPolygon(lng, lat, z.boundary)) return z;
  }
  return null;
}

async function mirrorProfileToDb(profile) {
  if (!isDbEnabled()) return;
  await query(
    `INSERT INTO vendor_shipping_profiles (
      id, vendor_key, shipping_type, flat_local_rate_kes, flat_upcountry_rate_kes,
      tier1_rate_kes, tier2_rate_kes, tier3_rate_kes, tier4_rate_kes,
      supported_tiers, local_counties, is_free_shipping_enabled, local_express_enabled, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,NOW())
    ON CONFLICT (vendor_key) DO UPDATE SET
      shipping_type = EXCLUDED.shipping_type,
      flat_local_rate_kes = EXCLUDED.flat_local_rate_kes,
      flat_upcountry_rate_kes = EXCLUDED.flat_upcountry_rate_kes,
      tier1_rate_kes = EXCLUDED.tier1_rate_kes,
      tier2_rate_kes = EXCLUDED.tier2_rate_kes,
      tier3_rate_kes = EXCLUDED.tier3_rate_kes,
      tier4_rate_kes = EXCLUDED.tier4_rate_kes,
      supported_tiers = EXCLUDED.supported_tiers,
      local_counties = EXCLUDED.local_counties,
      is_free_shipping_enabled = EXCLUDED.is_free_shipping_enabled,
      local_express_enabled = EXCLUDED.local_express_enabled,
      updated_at = NOW()`,
    [
      profile.id,
      profile.vendorKey,
      profile.shippingType,
      profile.flatLocalRateKes,
      profile.flatUpcountryRateKes,
      profile.tier1RateKes,
      profile.tier2RateKes,
      profile.tier3RateKes,
      profile.tier4RateKes,
      JSON.stringify(profile.supportedTiers || [1, 2, 3, 4]),
      JSON.stringify(profile.localCounties || []),
      Boolean(profile.isFreeShippingEnabled),
      Boolean(profile.localExpressEnabled),
    ]
  );
}

async function mirrorZoneToDb(zone) {
  if (!isDbEnabled()) return;
  await query(
    `INSERT INTO vendor_delivery_zones (
      id, vendor_key, zone_name, price_kes, boundary_geojson, is_active, updated_at
    ) VALUES ($1,$2,$3,$4,$5::jsonb,TRUE,NOW())
    ON CONFLICT (id) DO UPDATE SET
      zone_name = EXCLUDED.zone_name,
      price_kes = EXCLUDED.price_kes,
      boundary_geojson = EXCLUDED.boundary_geojson,
      is_active = TRUE,
      updated_at = NOW()`,
    [zone.id, zone.vendorKey, zone.zoneName, zone.priceKes, JSON.stringify(zone.boundary)]
  );
  try {
    await query(
      `UPDATE vendor_delivery_zones
       SET boundary = ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326)
       WHERE id = $1 AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')`,
      [zone.id, JSON.stringify(zone.boundary)]
    );
  } catch {
    /* PostGIS optional */
  }
}

async function softDeleteZoneInDb(zoneId) {
  if (!isDbEnabled()) return;
  await query(`UPDATE vendor_delivery_zones SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [
    zoneId,
  ]);
}
