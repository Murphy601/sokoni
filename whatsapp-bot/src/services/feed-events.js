/**
 * Phase 8 — Feed event logging (views, saves, clicks, purchases).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
    writeFileSync(EVENTS_FILE, JSON.stringify(store, null, 2));
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
