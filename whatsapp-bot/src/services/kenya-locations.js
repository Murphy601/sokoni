/**
 * Kenya 47-county location hierarchy + 4 delivery tiers.
 * File-backed seed; mirrors into Postgres when DATABASE_URL is set.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isDbEnabled, query } from "../db/pool.js";

const DATA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "kenya-counties.json"
);

/** @type {{ tiers: Record<string, { label: string, defaultFeeKes: number, estimatedHours: number }>, counties: Array<{ name: string, tier: number, towns: Array<{ name: string, areas: string[] }> }> } | null} */
let cached = null;

export function loadKenyaLocations() {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  return cached;
}

export function listCounties() {
  const data = loadKenyaLocations();
  return data.counties.map((c) => ({
    name: c.name,
    tier: c.tier,
    defaultFeeKes: data.tiers[String(c.tier)]?.defaultFeeKes ?? 0,
    estimatedHours: data.tiers[String(c.tier)]?.estimatedHours ?? 48,
    towns: (c.towns || []).map((t) => t.name),
  }));
}

export function getCounty(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  const data = loadKenyaLocations();
  const hit = data.counties.find((c) => c.name.toLowerCase() === key);
  if (!hit) return null;
  const tierMeta = data.tiers[String(hit.tier)] || {};
  return {
    name: hit.name,
    tier: hit.tier,
    defaultFeeKes: tierMeta.defaultFeeKes ?? 0,
    estimatedHours: tierMeta.estimatedHours ?? 48,
    towns: hit.towns || [],
  };
}

export function listTownsForCounty(countyName) {
  const county = getCounty(countyName);
  if (!county) return [];
  return (county.towns || []).map((t) => ({
    name: t.name,
    areas: t.areas || [],
  }));
}

export function getTierMeta(tierLevel) {
  const data = loadKenyaLocations();
  const t = data.tiers[String(tierLevel)];
  if (!t) return null;
  return { tier: Number(tierLevel), ...t };
}

export function platformDefaultFeeForCounty(countyName) {
  const county = getCounty(countyName);
  return county ? Math.round(Number(county.defaultFeeKes) || 0) : 0;
}

/** Seed counties into Postgres when DB is enabled (idempotent). */
export async function seedCountiesToDb() {
  if (!isDbEnabled()) return { ok: false, reason: "db_disabled" };
  const data = loadKenyaLocations();
  let inserted = 0;
  for (const c of data.counties) {
    const tier = Number(c.tier);
    const fee = data.tiers[String(tier)]?.defaultFeeKes ?? 0;
    const hours = data.tiers[String(tier)]?.estimatedHours ?? 48;
    const { rows } = await query(
      `INSERT INTO counties (name, tier_level, default_delivery_fee_kes, estimated_delivery_hours)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET
         tier_level = EXCLUDED.tier_level,
         default_delivery_fee_kes = EXCLUDED.default_delivery_fee_kes,
         estimated_delivery_hours = EXCLUDED.estimated_delivery_hours
       RETURNING id`,
      [c.name, tier, fee, hours]
    );
    const countyId = rows[0]?.id;
    inserted += 1;
    if (!countyId) continue;
    for (const town of c.towns || []) {
      await query(
        `INSERT INTO county_towns (county_id, name, areas)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (county_id, name) DO UPDATE SET areas = EXCLUDED.areas`,
        [countyId, town.name, JSON.stringify(town.areas || [])]
      );
    }
  }
  return { ok: true, counties: inserted };
}
