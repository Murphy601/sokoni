import axios from "axios";
import { config } from "../config.js";
import {
  catalogImageUrlCandidates,
  readCatalogImageBase64,
} from "../lib/catalog-images.js";

/** Normalize phone digits or chatId to WAHA chatId format. */
export function toChatId(phoneOrChatId) {
  if (phoneOrChatId.includes("@")) {
    return phoneOrChatId.replace(/@s\.whatsapp\.net$/, "@c.us");
  }
  const digits = String(phoneOrChatId).replace(/\D/g, "");
  return `${digits}@c.us`;
}

/** Session key + display id from WAHA `from` field (supports @c.us and @lid). */
export function customerKeyFromChatId(chatId) {
  if (!chatId) return "";
  return chatId.replace(/@s\.whatsapp\.net$/, "@c.us");
}

/** Extract phone digits from WAHA chatId when possible. */
export function phoneDigitsFromChatId(chatId) {
  if (!chatId || chatId.includes("@lid")) return null;
  const digits = chatId.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "").replace(/\D/g, "");
  return digits.length >= 9 ? digits : null;
}

/** Extract phone digits from WAHA chatId. */
export function fromChatId(chatId) {
  return customerKeyFromChatId(chatId);
}

export function formatCustomerLabel(meta, fallbackKey) {
  const parts = [];
  if (meta?.displayName) parts.push(meta.displayName);
  const phone = meta?.phone || phoneDigitsFromChatId(meta?.chatId || fallbackKey);
  if (phone) parts.push(`+${phone}`);
  const chatRef = meta?.chatId || fallbackKey;
  if (chatRef && !phone) parts.push(`chat ${chatRef}`);
  return parts.join(" · ") || fallbackKey || "Unknown customer";
}

function wahaHeaders(extra = {}) {
  const headers = { ...extra };
  if (config.waha.apiKey) headers["X-Api-Key"] = config.waha.apiKey;
  return headers;
}

async function callWaha(endpoint, body) {
  if (!config.waha.apiUrl) {
    console.log("[waha:dry-run]", endpoint, JSON.stringify(body, null, 2));
    return { dryRun: true };
  }
  const { data } = await axios.post(`${config.waha.apiUrl}${endpoint}`, body, {
    headers: wahaHeaders({ "Content-Type": "application/json" }),
  });
  return data;
}

/** Download media from WAHA (image/PDF from WhatsApp message). */
export async function downloadWahaMedia(mediaUrl, { messageId, chatId, session } = {}) {
  if (!config.waha.apiUrl) {
    throw new Error("WAHA_API_URL not set");
  }

  const headers = wahaHeaders();
  let url = mediaUrl;

  if (!url && messageId && chatId) {
    const sid = session || config.waha.session;
    const mid = encodeURIComponent(messageId);
    const cid = encodeURIComponent(chatId);
    url = `${config.waha.apiUrl}/api/${sid}/chats/${cid}/messages/${mid}?downloadMedia=true`;
  }

  if (!url) throw new Error("No media URL on message");

  try {
    const { data } = await axios.get(url, { headers, responseType: "arraybuffer", timeout: 90_000 });
    return Buffer.from(data);
  } catch (err) {
    if (url.includes("localhost") && config.waha.apiUrl && !config.waha.apiUrl.includes("localhost")) {
      const fixed = url.replace(/https?:\/\/[^/]+/, config.waha.apiUrl);
      const { data } = await axios.get(fixed, { headers, responseType: "arraybuffer", timeout: 90_000 });
      return Buffer.from(data);
    }
    throw err;
  }
}

/**
 * Because the admin/store owner shares the SAME WhatsApp account as the bot,
 * WAHA delivers the bot's OWN outgoing messages back to the webhook (via
 * message.any). We track what the bot sent so we can ignore those echoes and
 * only react to messages the human actually typed.
 */
const botSentIds = new Set();
const BOT_IDS_MAX = 1000;
const recentSends = new Map(); // normalized chatId -> timestamp
const RECENT_SEND_WINDOW_MS = 6000;

function idStrings(idLike) {
  const out = [];
  if (!idLike) return out;
  if (typeof idLike === "string") out.push(idLike);
  else if (typeof idLike === "object") {
    if (idLike._serialized) out.push(idLike._serialized);
    if (typeof idLike.id === "string") out.push(idLike.id);
  }
  return out;
}

function extractMessageIds(resp) {
  const raw = [
    ...idStrings(resp?.id),
    ...idStrings(resp?.key?.id),
    ...idStrings(resp?._data?.id),
    ...idStrings(resp?.message?.id),
  ];
  if (typeof resp?._serialized === "string") raw.push(resp._serialized);
  const shorts = raw.map((s) => String(s).split("_").pop()).filter(Boolean);
  return [...new Set([...raw, ...shorts])];
}

function rememberSend(resp, to) {
  for (const id of extractMessageIds(resp)) botSentIds.add(id);
  if (botSentIds.size > BOT_IDS_MAX) {
    const arr = [...botSentIds];
    arr.slice(0, arr.length - Math.floor(BOT_IDS_MAX / 2)).forEach((id) => botSentIds.delete(id));
  }
  try {
    recentSends.set(toChatId(to), Date.now());
  } catch {}
}

/** True if a webhook message is the bot's own outgoing echo (not human-typed). */
export function isBotEcho(messageId, destinationChatId) {
  if (messageId) {
    const parts = [messageId, String(messageId).split("_").pop()].filter(Boolean);
    if (parts.some((p) => botSentIds.has(p))) return true;
  }
  try {
    const ts = recentSends.get(toChatId(destinationChatId));
    if (ts && Date.now() - ts < RECENT_SEND_WINDOW_MS) return true;
  } catch {}
  return false;
}

export async function sendText(to, text) {
  const resp = await callWaha("/api/sendText", {
    session: config.waha.session,
    chatId: toChatId(to),
    text,
  });
  rememberSend(resp, to);
  return resp;
}

/** Public HTTPS URL for a catalog image (prefers bot server for WhatsApp). */
export function resolvePublicImageUrl(product) {
  const candidates = catalogImageUrlCandidates(product);
  return candidates[0] || null;
}

export async function sendImage(to, { link, data, caption, filename = "product.jpg" }) {
  const file = data
    ? { data, mimetype: "image/jpeg", filename }
    : { url: link, mimetype: "image/jpeg", filename };
  const resp = await callWaha("/api/sendImage", {
    session: config.waha.session,
    chatId: toChatId(to),
    file,
    caption: caption || "",
  });
  rememberSend(resp, to);
  return resp;
}

/** Try local base64 first (always on VM disk), then HTTPS URL(s). */
export async function sendProductImage(to, product, caption) {
  try {
    const data = await readCatalogImageBase64(product);
    if (data) {
      await sendImage(to, { data, caption, filename: `${product.id || "product"}.jpg` });
      console.log("[whatsapp] product image sent via base64:", product.id);
      return true;
    }
  } catch (err) {
    console.warn("[whatsapp] product image base64 failed:", product.id, err.message);
  }

  for (const link of catalogImageUrlCandidates(product)) {
    try {
      await sendImage(to, { link, caption, filename: `${product.id || "product"}.jpg` });
      console.log("[whatsapp] product image sent via URL:", link);
      return true;
    } catch (err) {
      console.warn("[whatsapp] product image URL failed:", link, err.message);
    }
  }

  return false;
}

/**
 * Renders a single product as image + text. WAHA does not support reliable
 * quick-reply buttons, so follow-up actions use numbered text menus instead.
 */
export async function sendProductCard(to, product, affiliateUrl, sourceLabel, { setActions = true } = {}) {
  const { setMenuState } = await import("./session.js");

  if (product.fulfillment === "store") {
    const caption =
      `*${product.name}*\n` +
      `KES ${product.priceKes.toLocaleString()}  ·  💵 Pay on delivery\n` +
      `⭐ ${product.rating} (${product.reviews.toLocaleString()} reviews)`;

    const sent = await sendProductImage(to, product, caption);
    if (!sent) {
      await sendText(to, caption + `\n🛵 ${config.store.deliveryNote}`);
    }

    if (!setActions) return;

    const options = [
      { id: `order_${product.id}`, label: "🛒 Order (pay on delivery)" },
      { id: `ask_ai_${product.id}`, label: "🤖 Ask about it" },
      { id: "menu_main", label: "⬅ Main menu" },
    ];
    setMenuState(to, { type: "product", productId: product.id, options });
    return sendText(
      to,
      `What next?\n\n1. 🛒 Order (pay on delivery)\n2. 🤖 Ask about it\n3. ⬅ Main menu\n\n_Reply with the number (e.g. 1)_`
    );
  }

  const isInternational = product.scope === "international";
  const priceLine = product.priceKes
    ? `KES ${product.priceKes.toLocaleString()}` +
      (product.originalPriceKes ? ` (was KES ${product.originalPriceKes.toLocaleString()})` : "")
    : `$${product.priceUsd} (est. delivery ${product.estDeliveryDays || "10-20 days"})`;

  const dutiesNote = isInternational
    ? "\n_Heads up: Kenya import duty/VAT may apply on arrival, paid by you — not included in this price._\n"
    : "";

  const body =
    `*${product.name}*\n` +
    `${priceLine}\n` +
    `⭐ ${product.rating} (${product.reviews.toLocaleString()} reviews) · ${sourceLabel}\n` +
    `${dutiesNote}\n` +
    `🛒 Buy here: ${affiliateUrl}\n\n` +
    `_Sokoni may earn a small commission on this purchase — it never costs you extra 🙏_`;

  const intlCaption = `*${product.name}*\n${priceLine}\n⭐ ${product.rating} · ${sourceLabel}`;
  const sent = await sendProductImage(to, product, intlCaption);
  if (sent) {
    await sendText(
      to,
      `${dutiesNote}🛒 Buy here: ${affiliateUrl}\n\n_Sokoni may earn a small commission — it never costs you extra 🙏_`
    );
  } else {
    await sendText(to, body);
  }

  if (!setActions) return;

  const options = [
    { id: `ask_ai_${product.id}`, label: "🤖 Ask AI about it" },
    { id: "menu_main", label: "⬅ Main menu" },
  ];
  setMenuState(to, { type: "product", productId: product.id, options });
  return sendText(
    to,
    `What next?\n\n1. 🤖 Ask AI about it\n2. ⬅ Main menu\n\n_Reply with the number (e.g. 1)_`
  );
}
