import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

/** @type {pg.Pool | null} */
let pool = null;

export function isDbEnabled() {
  return Boolean(config.database.url);
}

export function getPool() {
  if (!isDbEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => {
      console.error("[db] pool error:", err.message);
    });
  }
  return pool;
}

/**
 * @param {string} text
 * @param {unknown[]} [params]
 */
export async function query(text, params = []) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  return p.query(text, params);
}

/**
 * Run work on a dedicated pool client inside BEGIN/COMMIT.
 * Callers that need row locks (SELECT … FOR UPDATE) must use `client.query`.
 * @template T
 * @param {(client: import("pg").PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.warn("[db] rollback failed:", rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDb() {
  if (!isDbEnabled()) return { ok: false, reason: "disabled" };
  try {
    await query("SELECT 1 AS ok");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
