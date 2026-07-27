/**
 * Phase 9 — Runtime feature flags (ops-controlled).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FLAGS_FILE = path.join(DATA_DIR, "platform-flags.json");

const DEFAULTS = {
  prepaidOnly: config.store.prepaidOnly !== false,
  catalogSyncOnPublish: true,
  maintenanceMode: false,
  notes: "",
  updatedAt: null,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (existsSync(FLAGS_FILE)) {
      cache = { ...DEFAULTS, ...JSON.parse(readFileSync(FLAGS_FILE, "utf-8")) };
      return cache;
    }
  } catch (err) {
    console.warn("[platform-flags] load failed:", err.message);
  }
  cache = { ...DEFAULTS };
  return cache;
}

function persist(next) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  cache = { ...next, updatedAt: Date.now() };
  writeFileSync(FLAGS_FILE, JSON.stringify(cache, null, 2) + "\n", "utf-8");
  return cache;
}

export function getPlatformFlags() {
  return { ...load() };
}

export function updatePlatformFlags(patch = {}) {
  const current = load();
  const allowed = {};
  if (patch.prepaidOnly != null) allowed.prepaidOnly = Boolean(patch.prepaidOnly);
  if (patch.catalogSyncOnPublish != null) allowed.catalogSyncOnPublish = Boolean(patch.catalogSyncOnPublish);
  if (patch.maintenanceMode != null) allowed.maintenanceMode = Boolean(patch.maintenanceMode);
  if (patch.notes != null) allowed.notes = String(patch.notes).slice(0, 500);
  return persist({ ...current, ...allowed });
}

export function isPrepaidOnlyEffective() {
  const flags = load();
  return flags.prepaidOnly !== false;
}

export function isMaintenanceMode() {
  return load().maintenanceMode === true;
}
