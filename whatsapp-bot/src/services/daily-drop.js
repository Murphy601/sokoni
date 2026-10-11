/**
 * Catalog drip — one live item every 30 minutes (08:00–20:00 EAT) to Status AND Channel.
 * Rotates sellers by last_promoted_at. Off unless DAILY_DROP_ENABLED=true.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const QUEUE_STORE = path.join(DATA_DIR, "promotion-queue.json");

export const DAILY_DROP_HOUR_EAT = Number(config.dailyDrop?.hourEat ?? 8) || 8;
export const DAILY_DROP_END_HOUR_EAT = Number(config.dailyDrop?.endHourEat ?? 20) || 20;
export const DAILY_DROP_INTERVAL_MINUTES = Number(config.dailyDrop?.intervalMinutes ?? 30) || 30;

function popularity(product) {
  if (product.views != null || product.viewCount != null || product.impressions != null) {
    return Number(product.views ?? product.viewCount ?? product.impressions) || 0;
  }
  return Number(product.reviews || 0) * 10 + Number(product.rating || 0);
}

export function pickDailyDropItems(products = [], limit = 5) {
  return (Array.isArray(products) ? products : [])
    .filter((p) => p && p.inStock !== false && !p.isSold && isProductLive(p))
    .sort((a, b) => popularity(b) - popularity(a) || (Number(b.rating) || 0) - (Number(a.rating) || 0))
    .slice(0, Math.min(8, Math.max(1, Number(limit) || 5)));
}

function isProductLive(p) {
  const qty = Number(p.quantity ?? p.stock ?? p.stockQuantity ?? 1);
  return !Number.isFinite(qty) || qty > 0;
}

export function sellerKey(product) {
  return String(
    product?.sellerHandle ||
      product?.shopHandle ||
      product?.supplierId ||
      product?.sellerPhone ||
      product?.sellerUserId ||
      product?.id ||
      ""
  );
}

function promotedAt(product, timestamps = {}) {
  const raw =
    timestamps[product?.id] ?? product?.lastPromotedAt ?? product?.last_promoted_at ?? null;
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isFinite(n) ? n : null;
}

/** Least-recently-promoted seller, then that seller's oldest-unpromoted live item. */
export function pickNextDripItem(products = [], timestamps = {}) {
  const live = (Array.isArray(products) ? products : []).filter(
    (p) => p && p.id && p.inStock !== false && !p.isSold && isProductLive(p)
  );
  if (!live.length) return null;

  const sellerLast = new Map();
  for (const p of live) {
    const key = sellerKey(p);
    const t = promotedAt(p, timestamps);
    if (!sellerLast.has(key)) {
      sellerLast.set(key, t);
      continue;
    }
    const prev = sellerLast.get(key);
    if (t == null) sellerLast.set(key, null);
    else if (prev != null && t > prev) sellerLast.set(key, t);
  }

  return live.slice().sort((a, b) => {
    const sa = sellerLast.get(sellerKey(a));
    const sb = sellerLast.get(sellerKey(b));
    if (sa == null && sb != null) return -1;
    if (sb == null && sa != null) return 1;
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    const ta = promotedAt(a, timestamps);
    const tb = promotedAt(b, timestamps);
    if (ta == null && tb != null) return -1;
    if (tb == null && ta != null) return 1;
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    return 0;
  })[0];
}

export function dailyDropCaption(items = []) {
  const rows = items.slice(0, 5).map((p, i) => {
    const kes = Number(p.priceKes ?? p.price) || 0;
    return `${i + 1}. ${String(p.name || "Item").slice(0, 60)}${kes ? ` — KES ${kes}` : ""}`;
  });
  return (
    `Today's drop — ${rows.length} still available. Prepaid M-Pesa escrow.\n\n` +
    `${rows.join("\n")}\n\n` +
    `Shop on WhatsApp or sokonimall.com. Countrywide Kenya — never pay a rider directly.`
  );
}

export function dripDropCaption(item = {}) {
  const kes = Number(item.priceKes ?? item.price) || 0;
  const name = String(item.name || "Item").slice(0, 80);
  const shop = String(item.sellerHandle || item.shopHandle || "").replace(/^@+/, "");
  const shopLine = shop ? `\nFrom @${shop}` : "";
  return (
    `Today's drop — still available. Prepaid M-Pesa escrow.\n\n` +
    `${name}${kes ? ` — KES ${kes}` : ""}${shopLine}\n\n` +
    `Shop on WhatsApp or sokonimall.com. Countrywide Kenya — never pay a rider directly.`
  );
}

/** Every 30 minutes, 08:00-20:30 Africa/Nairobi (cron: star-slash-30 8-20 star star star). */
export function isDripSlot(clock = {}, opts = {}) {
  const start = Number(opts.hourEat ?? opts.startHour ?? config.dailyDrop?.hourEat ?? 8) || 8;
  const end = Number(opts.endHourEat ?? opts.endHour ?? config.dailyDrop?.endHourEat ?? 20) || 20;
  const interval = Number(opts.intervalMinutes ?? config.dailyDrop?.intervalMinutes ?? 30) || 30;
  const hour = Number(clock.hour);
  const minute = Number(clock.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  if (hour < start || hour > end) return false;
  return minute % interval === 0;
}

function loadPromotionStore() {
  try {
    if (!existsSync(QUEUE_STORE)) return {};
    const parsed = JSON.parse(readFileSync(QUEUE_STORE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePromotionStore(store) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(QUEUE_STORE, JSON.stringify(store, null, 2));
}

export function loadPromotionTimestamps() {
  return loadPromotionStore();
}

export function markItemPromoted(productId, at = Date.now()) {
  const id = String(productId || "").trim();
  if (!id) return { ok: false };
  const store = loadPromotionStore();
  store[id] = Number(at) || Date.now();
  savePromotionStore(store);
  return { ok: true, id, lastPromotedAt: store[id] };
}

export async function loadDailyDropItems(limit = 5) {
  const { searchProducts } = await import("./catalog.js");
  const products = await searchProducts({ keywords: "", limit: 40 });
  return pickDailyDropItems(products, limit);
}

export async function loadNextDripItem() {
  try {
    const { isDbEnabled } = await import("../db/pool.js");
    if (isDbEnabled()) {
      const { pickLeastPromotedProduct } = await import("../db/repositories/products.js");
      const row = await pickLeastPromotedProduct();
      if (row?.id) return row;
    }
  } catch (err) {
    console.warn("[daily-drop] db pick skipped:", err.message);
  }
  const { searchProducts } = await import("./catalog.js");
  const products = await searchProducts({ keywords: "", limit: 80 });
  return pickNextDripItem(products, loadPromotionTimestamps());
}

/** Bot /catalog-images first, then catalog Cloudinary — never drop the photo if either is allowed. */
async function resolveDailyDropMedia(items, extras = {}) {
  const { isAllowedOpsMediaUrl } = await import("./ops-desk-actions.js");
  let media = String(extras.media_url || extras.mediaUrl || "").trim();
  const lead = items[0] || {};
  if (!media) {
    try {
      const { catalogImageBotUrl, resolveStorefrontImageUrl, ensureCatalogImageBotUrl } = await import(
        "../lib/catalog-images.js"
      );
      media = catalogImageBotUrl(lead) || "";
      const remote = resolveStorefrontImageUrl(lead) || lead.imageUrl || lead.image || lead.photo || "";
      if (!media && remote && extras.dryRun !== true) {
        media = (await ensureCatalogImageBotUrl(lead, remote)) || remote;
      } else if (!media) {
        media = remote;
      }
    } catch {
      media = lead.image || lead.imageUrl || lead.photo || "";
    }
  }
  media = String(media || "").trim();
  if (media && !isAllowedOpsMediaUrl(media) && extras.dryRun !== true && lead.id) {
    try {
      const { ensureCatalogImageBotUrl } = await import("../lib/catalog-images.js");
      media = (await ensureCatalogImageBotUrl(lead, media)) || media;
    } catch {
      /* keep media */
    }
  }
  const mediaSkipped = Boolean(media) && !isAllowedOpsMediaUrl(media);
  if (mediaSkipped) media = "";
  return { media, mediaSkipped };
}

async function stampPromoted(item, extras = {}) {
  if (!item?.id || extras.dryRun === true) return;
  const at = extras.now || Date.now();
  markItemPromoted(item.id, at);
  try {
    const { isDbEnabled } = await import("../db/pool.js");
    if (isDbEnabled()) {
      const { markProductPromoted } = await import("../db/repositories/products.js");
      await markProductPromoted(item.id, new Date(at));
    }
  } catch (err) {
    console.warn("[daily-drop] stamp skipped:", err.message);
  }
}

export async function runDailyDrop(extras = {}) {
  const items = extras.items || [await loadNextDripItem()].filter(Boolean);
  if (!items.length) {
    return { ok: false, error: "empty_catalog", tool: "daily_drop", message: "No unsold listings to post." };
  }
  const text = extras.text || (items.length === 1 ? dripDropCaption(items[0]) : dailyDropCaption(items));
  const { media, mediaSkipped } = await resolveDailyDropMedia(items, extras);
  const dest = String(extras.destination_type || extras.destination || config.dailyDrop?.destination || "BOTH")
    .trim()
    .toUpperCase();
  const { publishWhatsAppStatusOrChannel } = await import("./ops-desk-actions.js");
  const posted = await publishWhatsAppStatusOrChannel(
    {
      destination_type: dest === "STATUS" || dest === "CHANNEL" ? dest : "BOTH",
      channel_id: extras.channel_id || config.waha?.channelId,
      text,
      media_url: media || undefined,
    },
    extras
  );
  if (posted.ok) await stampPromoted(items[0], extras);
  return {
    ...posted,
    tool: posted.tool || "publish_whatsapp_status_or_channel",
    dailyDrop: true,
    drip: items.length === 1,
    itemCount: items.length,
    mediaSkipped: mediaSkipped || undefined,
    items: items.map((p) => ({ id: p.id, name: p.name, priceKes: p.priceKes, seller: sellerKey(p) })),
  };
}
