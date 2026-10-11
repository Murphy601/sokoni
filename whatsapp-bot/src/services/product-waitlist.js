/**
 * Buyer back-in-stock waitlist. Postgres when phase44 is applied; JSON file otherwise.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeJsonAtomic } from "../lib/atomic-json.js";
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";
import { isDbEnabled, query } from "../db/pool.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const FILE = path.join(DATA_DIR, "product-waitlist.json");

const lastNotifyAt = new Map();
const NOTIFY_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export const WAITLIST_RE =
  /\b(notify me|waitlist|wait\s*list|tell me when|when (it'?s|its) back|back in stock|alert me)\b/i;

function loadFile() {
  try {
    if (!existsSync(FILE)) return { rows: [] };
    const raw = JSON.parse(readFileSync(FILE, "utf-8"));
    return { rows: Array.isArray(raw.rows) ? raw.rows : [] };
  } catch {
    return { rows: [] };
  }
}

function saveFile(store) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeJsonAtomic(FILE, store);
}

function digits(phone) {
  return normalizeKenyaPhone(phone) || String(phone || "").replace(/\D/g, "");
}

export function looksLikeWaitlistAsk(text) {
  return WAITLIST_RE.test(String(text || ""));
}

export async function tryHandleWaitlistAsk(customerKey, text, { phone } = {}) {
  if (!looksLikeWaitlistAsk(text)) return false;
  const { getProductContext } = await import("./session.js");
  const product = getProductContext(customerKey);
  if (!product?.id) {
    const { sendText } = await import("./whatsapp.js");
    await sendText(
      customerKey,
      "Which item should I watch? Open it from *menu* first, then say *notify me*."
    );
    return true;
  }
  const joined = await joinWaitlist({
    phone: phone || customerKey,
    productId: product.id,
    productName: product.name,
  });
  const { sendText } = await import("./whatsapp.js");
  await sendText(
    customerKey,
    joined.ok
      ? `I'll text you when *${product.name}* is back. Prepaid escrow still applies — never pay a rider directly.`
      : joined.message || "Could not save that waitlist just now. Try again in a moment."
  );
  return true;
}

export async function joinWaitlist({ phone, productId, productName } = {}) {
  const p = digits(phone);
  const id = String(productId || "").trim();
  if (!p || !id) {
    return { ok: false, error: "missing_lookup", message: "Need a phone and a product to watch." };
  }
  const name = String(productName || id).slice(0, 160);

  if (isDbEnabled()) {
    try {
      await query(
        `INSERT INTO product_waitlist (phone, product_id, product_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (phone, product_id) DO UPDATE SET
           product_name = EXCLUDED.product_name,
           notified_at = NULL`,
        [p, id, name]
      );
      return { ok: true, source: "postgres", phone: p, productId: id, productName: name };
    } catch (err) {
      if (!/product_waitlist|does not exist/i.test(String(err.message || ""))) {
        console.warn("[waitlist] db join failed:", err.message);
      }
    }
  }

  const store = loadFile();
  const existing = store.rows.find((r) => r.phone === p && r.productId === id);
  if (existing) {
    existing.productName = name;
    existing.notifiedAt = null;
  } else {
    store.rows.push({ phone: p, productId: id, productName: name, createdAt: Date.now(), notifiedAt: null });
  }
  saveFile(store);
  return { ok: true, source: "file", phone: p, productId: id, productName: name };
}

export async function hasOpenWaitlistForPhone(phone) {
  const p = digits(phone);
  if (!p) return false;
  if (isDbEnabled()) {
    try {
      const { rows } = await query(
        `SELECT 1 FROM product_waitlist
          WHERE phone = $1 AND notified_at IS NULL
          LIMIT 1`,
        [p]
      );
      return Boolean(rows?.[0]);
    } catch {
      /* file fallback */
    }
  }
  return loadFile().rows.some((r) => r.phone === p && !r.notifiedAt);
}

export async function listOpenWaitlist(productId) {
  const id = String(productId || "").trim();
  if (!id) return [];
  if (isDbEnabled()) {
    try {
      const { rows } = await query(
        `SELECT phone, product_id, product_name
           FROM product_waitlist
          WHERE product_id = $1 AND notified_at IS NULL`,
        [id]
      );
      return (rows || []).map((r) => ({
        phone: r.phone,
        productId: r.product_id,
        productName: r.product_name,
      }));
    } catch {
      /* file fallback */
    }
  }
  return loadFile().rows.filter((r) => r.productId === id && !r.notifiedAt);
}

async function markNotified(productId, phones) {
  const id = String(productId || "").trim();
  if (isDbEnabled()) {
    try {
      await query(
        `UPDATE product_waitlist SET notified_at = NOW()
          WHERE product_id = $1 AND phone = ANY($2::text[]) AND notified_at IS NULL`,
        [id, phones]
      );
      return;
    } catch {
      /* file */
    }
  }
  const store = loadFile();
  const set = new Set(phones);
  for (const row of store.rows) {
    if (row.productId === id && set.has(row.phone)) row.notifiedAt = Date.now();
  }
  saveFile(store);
}

/**
 * When units go from 0 → >0, text waitlisted buyers. Cooldown avoids restock spam.
 */
export async function notifyWaitlistOnRestock(product, { sender } = {}) {
  const id = product?.id;
  const onHand = Math.round(Number(product?.stockQuantity ?? product?.units ?? 0) || 0);
  if (!id || onHand <= 0) return { skipped: true, reason: "no_stock" };

  const prev = lastNotifyAt.get(id) || 0;
  if (Date.now() - prev < NOTIFY_COOLDOWN_MS) return { skipped: true, reason: "cooldown" };

  const watchers = await listOpenWaitlist(id);
  if (!watchers.length) return { skipped: true, reason: "empty" };

  const { sendText, toChatId } = await import("./whatsapp.js");
  const send = sender || sendText;
  const name = product.name || watchers[0].productName || id;
  const text =
    `*${name}* is back.\n\n` +
    `Prepaid M-Pesa escrow still holds until you confirm.\n` +
    `Reply *1* to order, or type *menu*.`;

  const notified = [];
  for (const row of watchers) {
    try {
      await send(toChatId(row.phone), text);
      notified.push(row.phone);
    } catch (err) {
      console.warn("[waitlist] send failed:", row.phone, err.message);
    }
  }
  if (notified.length) {
    await markNotified(id, notified);
    lastNotifyAt.set(id, Date.now());
  }
  return { ok: true, notified: notified.length, productId: id };
}

export function resetWaitlistNotifyCooldown() {
  lastNotifyAt.clear();
}
