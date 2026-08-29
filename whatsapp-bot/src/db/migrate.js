import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { query, isDbEnabled, closePool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "..", "..", "db", "schema.sql");
const SCHEMA_PHASE2_PATH = path.join(__dirname, "..", "..", "db", "schema-phase2-browse.sql");
const SCHEMA_PHASE5_PATH = path.join(__dirname, "..", "..", "db", "schema-phase5-shipping.sql");
const SCHEMA_PHASE10_PATH = path.join(__dirname, "..", "..", "db", "schema-phase10-social.sql");
const SCHEMA_PHASE11_PATH = path.join(__dirname, "..", "..", "db", "schema-phase11-shop-reviews.sql");
const SCHEMA_PHASE12_PATH = path.join(__dirname, "..", "..", "db", "schema-phase12-depop-expansion.sql");
const SCHEMA_PHASE13_PATH = path.join(__dirname, "..", "..", "db", "schema-phase13-reviews-disputes.sql");
const SCHEMA_PHASE14_PATH = path.join(__dirname, "..", "..", "db", "schema-phase14-account-auth.sql");
const SCHEMA_PHASE15_PATH = path.join(__dirname, "..", "..", "db", "schema-phase15-hybrid-logistics.sql");
const SCHEMA_PHASE16_PATH = path.join(__dirname, "..", "..", "db", "schema-phase16-pgvector-knowledge.sql");
const SCHEMA_PHASE17_PATH = path.join(__dirname, "..", "..", "db", "schema-phase17-compare-at-price.sql");
const SCHEMA_PHASE19_PATH = path.join(__dirname, "..", "..", "db", "schema-phase19-boda-fleet.sql");
const SCHEMA_PHASE20_PATH = path.join(__dirname, "..", "..", "db", "schema-phase20-boda-otp-safeguards.sql");
const SCHEMA_PHASE21_PATH = path.join(__dirname, "..", "..", "db", "schema-phase21-boda-payout-hold.sql");
const SCHEMA_PHASE22_PATH = path.join(__dirname, "..", "..", "db", "schema-phase22-rider-b2c.sql");
const SCHEMA_PHASE23_PATH = path.join(__dirname, "..", "..", "db", "schema-phase23-rider-payout-split.sql");
const SCHEMA_PHASE24_PATH = path.join(__dirname, "..", "..", "db", "schema-phase24-boda-ops-safeguards.sql");
const SCHEMA_PHASE25_PATH = path.join(__dirname, "..", "..", "db", "schema-phase25-upcountry-waybill.sql");
const SCHEMA_PHASE26_PATH = path.join(__dirname, "..", "..", "db", "schema-phase26-platform-rider-pin.sql");
const SCHEMA_PHASE27_PATH = path.join(__dirname, "..", "..", "db", "schema-phase27-dispatch-radius.sql");
const SCHEMA_PHASE28_PATH = path.join(__dirname, "..", "..", "db", "schema-phase28-atomic-accept.sql");

async function applySchemaFile(label, filePath, { required = false } = {}) {
  try {
    const sql = await readFile(filePath, "utf-8");
    await query(sql);
    console.log(`[db] ${label} applied:`, filePath);
    return { ok: true, label };
  } catch (err) {
    if (err.code === "ENOENT") {
      if (required) throw err;
      console.warn(`[db] ${label} skipped (file missing):`, filePath);
      return { ok: true, label, skipped: true };
    }
    console.error(`[db] ${label} FAILED:`, err.message);
    return { ok: false, label, error: err.message };
  }
}

export async function runMigrations() {
  if (!isDbEnabled()) {
    throw new Error("DATABASE_URL is not set — cannot run migrations");
  }
  const results = [];

  const base = await applySchemaFile("phase1 base schema", SCHEMA_PATH, { required: true });
  results.push(base);
  if (!base.ok) throw new Error(base.error || "base schema failed");

  const phases = [
    ["phase2 browse schema", SCHEMA_PHASE2_PATH],
    ["phase5 shipping schema", SCHEMA_PHASE5_PATH],
    ["phase10 social schema", SCHEMA_PHASE10_PATH],
    ["phase11 shop reviews", SCHEMA_PHASE11_PATH],
    ["phase12 depop expansion", SCHEMA_PHASE12_PATH],
    ["phase13 reviews disputes", SCHEMA_PHASE13_PATH],
    ["phase14 account auth", SCHEMA_PHASE14_PATH],
    ["phase15 hybrid logistics", SCHEMA_PHASE15_PATH],
    ["phase17 compare_at_price", SCHEMA_PHASE17_PATH],
    ["phase19 boda fleet", SCHEMA_PHASE19_PATH],
    ["phase20 boda otp safeguards", SCHEMA_PHASE20_PATH],
    ["phase21 boda payout hold", SCHEMA_PHASE21_PATH],
    ["phase22 rider b2c payouts", SCHEMA_PHASE22_PATH],
    ["phase23 rider payout fee split", SCHEMA_PHASE23_PATH],
    ["phase24 boda ops safeguards", SCHEMA_PHASE24_PATH],
    ["phase25 upcountry waybill", SCHEMA_PHASE25_PATH],
    ["phase26 platform rider pin", SCHEMA_PHASE26_PATH],
    ["phase27 dispatch radius engine", SCHEMA_PHASE27_PATH],
    ["phase28 atomic accept pickup sla", SCHEMA_PHASE28_PATH],
  ];

  for (const [label, filePath] of phases) {
    results.push(await applySchemaFile(label, filePath));
  }

  // Phase16 (pgvector) is optional — many hosts lack CREATE EXTENSION vector.
  const phase16 = await applySchemaFile("phase16 pgvector knowledge", SCHEMA_PHASE16_PATH);
  if (!phase16.ok) {
    console.warn(
      "[db] phase16 pgvector skipped — keyword RAG over knowledge/*.md still works:",
      phase16.error
    );
    results.push({ ok: true, label: "phase16 pgvector knowledge", skipped: true, error: phase16.error });
  } else {
    results.push(phase16);
  }

  try {
    const { seedCountiesToDb } = await import("../services/kenya-locations.js");
    const seeded = await seedCountiesToDb();
    if (seeded.ok) console.log("[db] kenya counties seeded:", seeded.counties);
    else console.log("[db] kenya counties seed:", seeded.reason || seeded);
  } catch (err) {
    console.warn("[db] county seed skipped:", err.message);
    results.push({ ok: false, label: "county seed", error: err.message });
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    const summary = failed.map((f) => `${f.label}: ${f.error}`).join("; ");
    throw new Error(`${failed.length} migration step(s) failed — ${summary}`);
  }
  return results;
}

async function main() {
  try {
    await runMigrations();
    const { rows } = await query("SELECT name, applied_at FROM schema_migrations ORDER BY id");
    console.log("[db] migrations:", rows);
    console.log("[db] all migration steps OK");
  } finally {
    await closePool();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[db] migrate failed:", err.message);
    process.exit(1);
  });
}
