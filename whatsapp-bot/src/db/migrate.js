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

async function applySchemaFile(label, filePath) {
  try {
    const sql = await readFile(filePath, "utf-8");
    await query(sql);
    console.log(`[db] ${label} applied:`, filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

export async function runMigrations() {
  if (!isDbEnabled()) {
    throw new Error("DATABASE_URL is not set — cannot run migrations");
  }
  const sql = await readFile(SCHEMA_PATH, "utf-8");
  await query(sql);
  console.log("[db] schema applied:", SCHEMA_PATH);

  await applySchemaFile("phase2 browse schema", SCHEMA_PHASE2_PATH);
  await applySchemaFile("phase5 shipping schema", SCHEMA_PHASE5_PATH);
  await applySchemaFile("phase10 social schema", SCHEMA_PHASE10_PATH);
  await applySchemaFile("phase11 shop reviews", SCHEMA_PHASE11_PATH);
  await applySchemaFile("phase12 depop expansion", SCHEMA_PHASE12_PATH);
  await applySchemaFile("phase13 reviews disputes", SCHEMA_PHASE13_PATH);
}

async function main() {
  try {
    await runMigrations();
    const { rows } = await query("SELECT name, applied_at FROM schema_migrations ORDER BY id");
    console.log("[db] migrations:", rows);
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
