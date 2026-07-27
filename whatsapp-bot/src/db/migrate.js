import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { query, isDbEnabled, closePool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "..", "..", "db", "schema.sql");
const SCHEMA_PHASE2_PATH = path.join(__dirname, "..", "..", "db", "schema-phase2-browse.sql");

export async function runMigrations() {
  if (!isDbEnabled()) {
    throw new Error("DATABASE_URL is not set — cannot run migrations");
  }
  const sql = await readFile(SCHEMA_PATH, "utf-8");
  await query(sql);
  console.log("[db] schema applied:", SCHEMA_PATH);

  try {
    const phase2 = await readFile(SCHEMA_PHASE2_PATH, "utf-8");
    await query(phase2);
    console.log("[db] phase2 browse schema applied:", SCHEMA_PHASE2_PATH);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
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
