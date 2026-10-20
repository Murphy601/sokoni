/**
 * Phase 8 — Feed event logging (views, saves, clicks, purchases).
 */
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { writeJsonAtomic } from "../lib/atomic-json.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const EVENTS_FILE = path.join(DATA_DIR, "feed-events.json");

const MAX_EVENTS = 8000;

let store = { events: [] };
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(EVENTS_FILE)) {
      store = { events: [], ...JSON.parse(readFileSync(EVENTS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[feed-events] load failed:", err.message);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeJsonAtomic(EVENTS_FILE, store);
  } catch (err) {
    console.error("[feed-events] persist failed:", err.message);
  }
}

const ALLOWED_TYPES = new Set(["view", "click", "save", "unsave", "purchase", "category", "search"]);

/** @param {{ sessionId?: string, type: string, productId?: string, category?: string, query?: string, meta?: object }} evt */
export function logFeedEvent(evt) {
  load();
  const type = String(evt.type || "").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return null;

  const entry = {
    id: `fe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    sessionId: evt.sessionId ? String(evt.sessionId).slice(0, 64) : null,
    productId: evt.productId ? String(evt.productId).slice(0, 64) : null,
    category: evt.category ? String(evt.category).slice(0, 80) : null,
    query: evt.query ? String(evt.query).slice(0, 120) : null,
    meta: evt.meta && typeof evt.meta === "object" ? evt.meta : null,
    at: Date.now(),
  };

  store.events.unshift(entry);
  if (store.events.length > MAX_EVENTS) store.events.length = MAX_EVENTS;
  persist();
  return entry;
}

export function listFeedEvents({ sinceMs = 0, limit = 2000 } = {}) {
  load();
  const since = Number(sinceMs) || 0;
  return store.events.filter((e) => !since || e.at >= since).slice(0, limit);
}

export function eventsForSession(sessionId, limit = 200) {
  if (!sessionId) return [];
  load();
  return store.events.filter((e) => e.sessionId === sessionId).slice(0, limit);
}

export function getFeedEventStats() {
  load();
  const now = Date.now();
  const day = now - 86_400_000;
  const recent = store.events.filter((e) => e.at >= day);
  const byType = {};
  for (const e of recent) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  return { total: store.events.length, last24h: recent.length, byType };
}

/* -------------------------------------------------------------------------
 * Demand signals (urgency tags on product cards)
 *
 * Derived from the events already logged above -- no new storage, no schema.
 * Counts DISTINCT sessions, not raw hits, so one buyer refreshing five times
 * is one viewer. A signal only surfaces once it clears a floor, because
 * "1 person viewed this" reads as dead stock rather than demand.
 * ---------------------------------------------------------------------- */

/** Minimum distinct sessions before a viewer count is worth showing. */
export const DEMAND_MIN_VIEWERS = 3;
/** Minimum saves before the saved tag is worth showing. */
export const DEMAND_MIN_SAVES = 2;
const DEMAND_WINDOW_MS = 60 * 60 * 1000;

/**
 * Demand for one product over a trailing window.
 *
 * @param {string} productId
 * @param {{ windowMs?: number, now?: number }} [opts]
 * @returns {{ productId: string, viewers: number, saves: number, windowMs: number }}
 */
export function getProductDemand(productId, { windowMs = DEMAND_WINDOW_MS, now = Date.now() } = {}) {
  const id = String(productId || "").trim();
  const win = Math.max(60_000, Number(windowMs) || DEMAND_WINDOW_MS);
  if (!id) return { productId: "", viewers: 0, saves: 0, windowMs: win };
  const batch = getProductDemandBatch([id], { windowMs: win, now });
  const hit = batch[id] || { viewers: 0, saves: 0 };
  return { productId: id, viewers: hit.viewers, saves: hit.saves, windowMs: win };
}

/**
 * Demand for many products in a single pass over the log.
 *
 * @param {string[]} productIds
 * @param {{ windowMs?: number, now?: number }} [opts]
 * @returns {Record<string, { viewers: number, saves: number }>}
 */
export function getProductDemandBatch(productIds = [], { windowMs = DEMAND_WINDOW_MS, now = Date.now() } = {}) {
  const wanted = (Array.isArray(productIds) ? productIds : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  /** @type {Record<string, { viewers: number, saves: number }>} */
  const out = {};
  if (!wanted.length) return out;
  load();

  const win = Math.max(60_000, Number(windowMs) || DEMAND_WINDOW_MS);
  const since = now - win;
  /**
   * v      distinct viewer sessions
   * s      sessions whose newest save/unsave was a save
   * settled sessions whose save state is already decided
   * av/as/au anonymous (no sessionId) view / save / unsave counts
   * @type {Map<string, { v: Set<string>, s: Set<string>, settled: Set<string>, av: number, as: number, au: number }>}
   */
  const acc = new Map();
  for (const id of wanted) {
    if (!acc.has(id)) {
      acc.set(id, { v: new Set(), s: new Set(), settled: new Set(), av: 0, as: 0, au: 0 });
    }
  }

  for (const e of store.events) {
    // store.events is newest-first, so the first out-of-window entry ends it.
    if (e.at < since) break;
    const bucket = e.productId ? acc.get(e.productId) : null;
    if (!bucket) continue;

    if (e.type === "view" || e.type === "click") {
      if (e.sessionId) bucket.v.add(e.sessionId);
      else bucket.av += 1;
      continue;
    }

    if (e.type !== "save" && e.type !== "unsave") continue;

    if (!e.sessionId) {
      // Cannot attribute an anonymous unsave to an anonymous save; net the counts.
      if (e.type === "save") bucket.as += 1;
      else bucket.au += 1;
      continue;
    }
    // Newest-first: the first save/unsave seen for a session is its current
    // state. Anything older for that session is already superseded.
    if (bucket.settled.has(e.sessionId)) continue;
    bucket.settled.add(e.sessionId);
    if (e.type === "save") bucket.s.add(e.sessionId);
  }

  for (const [id, b] of acc) {
    out[id] = {
      viewers: b.v.size + b.av,
      saves: b.s.size + Math.max(0, b.as - b.au),
    };
  }
  return out;
}

/**
 * Buyer-facing urgency tags, or [] when the numbers are too thin to mean anything.
 *
 * @param {{ viewers?: number, saves?: number }} demand
 * @returns {{ id: string, emoji: string, label: string }[]}
 */
export function demandTags(demand = {}) {
  const viewers = Math.max(0, Math.round(Number(demand.viewers) || 0));
  const saves = Math.max(0, Math.round(Number(demand.saves) || 0));
  const tags = [];
  if (viewers >= DEMAND_MIN_VIEWERS) {
    tags.push({
      id: "viewers",
      emoji: "👀",
      label: `${viewers} buyers viewed this in the last hour`,
    });
  }
  if (saves >= DEMAND_MIN_SAVES) {
    tags.push({
      id: "saves",
      emoji: "🔥",
      label: `${saves} people have this saved`,
    });
  }
  return tags;
}
