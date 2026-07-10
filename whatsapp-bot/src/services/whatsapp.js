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

/** WAHA expects @ encoded in chatId path only — not the full message id. */
export function normalizeWahaChatId(chatId) {
  return String(chatId || "").replace(/@s\.whatsapp\.net$/, "@c.us");
}

function wahaChatPath(chatId) {
  return normalizeWahaChatId(chatId).replace(/@/g, "%40");
}

function messageFileKeys(messageId) {
  if (!messageId) return [];
  const id = String(messageId);
  const keys = [id];
  const tail = id.split("_").pop();
  if (tail && tail !== id) keys.push(tail);
  return [...new Set(keys)];
}

function wahaFileUrl(apiBase, sessionId, key, ext = "jpg") {
  if (!key || !apiBase) return null;
  return [
    `${apiBase}/api/files/${key}.${ext}`,
    sessionId ? `${apiBase}/api/files/${sessionId}/${key}.${ext}` : null,
  ].filter(Boolean);
}

function fixMediaUrl(url, apiBase) {
  if (!url || !apiBase) return url;
  try {
    const u = new URL(url);
    const base = new URL(apiBase);
    // Only rewrite docker/localhost hosts — keep path exactly as WAHA sent it.
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "host.docker.internal") {
      u.protocol = base.protocol;
      u.host = base.host;
    }
    return u.toString();
  } catch {
    return url;
  }
}

function uniqueChatIds(...ids) {
  const out = [];
  for (const id of ids) {
    const n = normalizeWahaChatId(id);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Download media from WAHA (image/PDF from WhatsApp message). Retries when WAHA is still saving. */
export async function downloadWahaMedia(
  mediaUrl,
  { messageId, chatId, fromChatId, toChatId, session, mimetype } = {}
) {
  if (!config.waha.apiUrl) {
    throw new Error("WAHA_API_URL not set");
  }

  const headers = wahaHeaders();
  const sid = session || config.waha.session;
  const apiBase = config.waha.apiUrl.replace(/\/$/, "");
  const chatCandidates = uniqueChatIds(chatId, fromChatId, toChatId);

  async function fetchBuffer(url) {
    const { data, status, headers: respHeaders } = await axios.get(url, {
      headers,
      responseType: "arraybuffer",
      timeout: 120_000,
      validateStatus: (s) => s === 200,
    });
    if (!data?.byteLength) throw new Error(`Empty media file (${status})`);
    const ct = String(respHeaders["content-type"] || "");
    if (ct.includes("application/json")) {
      const json = JSON.parse(Buffer.from(data).toString("utf8"));
      if (json?.media?.url) return fetchBuffer(fixMediaUrl(json.media.url, apiBase));
      throw new Error("WAHA returned JSON without media");
    }
    return Buffer.from(data);
  }

  async function fetchMessageJson(cid) {
    const url = `${apiBase}/api/${sid}/chats/${wahaChatPath(cid)}/messages/${messageId}?downloadMedia=false`;
    const { data } = await axios.get(url, { headers, timeout: 60_000 });
    return data;
  }

  async function tryGlobalMessagesLookup(cid) {
    const url = `${apiBase}/api/messages?session=${encodeURIComponent(sid)}&chatId=${wahaChatPath(cid)}&limit=80`;
    const { data } = await axios.get(url, { headers, timeout: 60_000 });
    const list = Array.isArray(data) ? data : data?.messages || data?.data || [];
    const hit = list.find((m) => {
      const id = typeof m.id === "string" ? m.id : m.id?._serialized || m.id?.id || "";
      return id === messageId;
    });
    if (hit?.media?.url) return fixMediaUrl(hit.media.url, apiBase);
    return null;
  }

  async function pollForMediaUrl(maxMs = 60_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      for (const cid of chatCandidates) {
        try {
          const msg = await fetchMessageJson(cid);
          if (msg?.media?.url) return fixMediaUrl(msg.media.url, apiBase);
        } catch (err) {
          const status = err.response?.status;
          if (status && status !== 404) {
            console.warn("[waha] message lookup:", cid, status, err.message);
          }
        }
        try {
          const fromList = await tryGlobalMessagesLookup(cid);
          if (fromList) return fromList;
        } catch (err) {
          console.warn("[waha] messages list lookup:", cid, err.message);
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return null;
  }

  async function tryMessageDownload(cid) {
    const url = `${apiBase}/api/${sid}/chats/${wahaChatPath(cid)}/messages/${messageId}?downloadMedia=true`;
    const resp = await axios.get(url, {
      headers,
      timeout: 120_000,
      responseType: "arraybuffer",
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const ct = String(resp.headers["content-type"] || "");
    if (resp.data?.byteLength && (ct.includes("image") || ct.includes("octet-stream") || ct.includes("pdf"))) {
      return Buffer.from(resp.data);
    }
    if (resp.data?.byteLength) {
      try {
        const json = JSON.parse(Buffer.from(resp.data).toString("utf8"));
        if (json?.media?.url) return fetchBuffer(fixMediaUrl(json.media.url, apiBase));
      } catch {
        /* binary */
      }
    }
    return null;
  }

  const exts = ["jpeg", "jpg", "png", "webp"];
  if (String(mimetype || "").includes("png")) exts.unshift("png");

  const urls = [];
  if (mediaUrl) urls.push(fixMediaUrl(mediaUrl, apiBase));

  if (messageId) {
    for (const key of messageFileKeys(messageId)) {
      for (const ext of exts) urls.push(...wahaFileUrl(apiBase, sid, key, ext));
    }
  }

  if (!messageId && urls.length === 0) throw new Error("No media URL on message");

  let lastError = null;

  // Album child messages often arrive before WAHA finishes saving the file.
  if (!mediaUrl && messageId && chatCandidates.length) {
    const polled = await pollForMediaUrl(45_000);
    if (polled) urls.unshift(polled);
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const cid of chatCandidates) {
      try {
        const viaMessage = await tryMessageDownload(cid);
        if (viaMessage?.byteLength) return viaMessage;
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        if (status !== 404) console.warn("[waha] message download:", cid, status || err.message);
      }
    }

    for (const url of [...new Set(urls.filter(Boolean))]) {
      try {
        return await fetchBuffer(url);
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        console.warn("[waha] file download failed:", url, status || err.message);
      }
    }

    if (attempt < 7) {
      const fresh = await pollForMediaUrl(12_000);
      if (fresh && !urls.includes(fresh)) urls.unshift(fresh);
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
    }
  }

  throw new Error(
    lastError?.response?.status
      ? `Request failed with status code ${lastError.response.status}`
      : lastError?.message || "download failed"
  );
}

export function parseWahaCatalogPrice(price, currency = "KES") {
  let n = Number(String(price ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const cur = String(currency || "KES").toUpperCase();
  // WhatsApp catalog stores price in minor units (often ×1000 for KES).
  if (cur === "KES" && n >= 5000) n = Math.round(n / 1000);
  else if (n >= 100000) n = Math.round(n / 1000);
  else if (n >= 10000 && n % 100 === 0) n = Math.round(n / 100);
  return Math.round(n);
}

function normalizeWahaCatalogProducts(data) {
  const list =
    data?.products ||
    data?.data?.products ||
    data?.catalog?.products ||
    (Array.isArray(data) ? data : []);
  if (!Array.isArray(list)) return [];

  return list
    .map((p) => {
      const name = String(p.name || p.title || "").trim();
      const description = String(p.description || "").trim();
      const sourcePriceKes = parseWahaCatalogPrice(p.price ?? p.salePrice, p.currency);
      const imageUrl =
        p.image ||
        p.imageUrl ||
        (Array.isArray(p.images) ? p.images[0] : null) ||
        (Array.isArray(p.media) ? p.media[0]?.url : null);
      return { name, description, sourcePriceKes, imageUrl, retailerId: p.retailerId || p.id || null };
    })
    .filter((p) => p.name.length > 1 && p.sourcePriceKes > 0);
}

/** Product card shared from a WhatsApp Business catalog (webhook _data). */
export function extractWahaProductMessage(payload) {
  const roots = [payload?._data?.message, payload?._data, payload].filter(Boolean);
  for (const root of roots) {
    const pm = root.productMessage || root.product_message;
    if (!pm) continue;
    const p = pm.product || pm;
    const name = String(p.title || p.name || pm.title || "").trim();
    if (!name) continue;
    const sourcePriceKes = parseWahaCatalogPrice(
      p.priceAmount1000 ?? p.priceAmount ?? p.price,
      p.currencyCode || p.currency || "KES"
    );
    const owner = String(pm.businessOwnerJid || pm.businessOwner || "").replace(/\D/g, "");
    return {
      name,
      description: String(p.description || "").trim(),
      sourcePriceKes,
      retailerId: String(p.productId || p.retailerId || "").trim() || null,
      businessOwnerDigits: owner,
      imageUrl: p.productImage?.url || p.image?.url || null,
    };
  }
  return null;
}

export function isWahaCatalogApiMissing(err) {
  const status = err?.response?.status;
  const msg = String(err?.message || "");
  return status === 404 || /catalog API not found/i.test(msg);
}

/** Fetch another WhatsApp Business catalog via WAHA (not available on all WAHA builds). */
export async function fetchWahaBusinessCatalog(businessPhoneOrUrl, session) {
  if (!config.waha.apiUrl) throw new Error("WAHA_API_URL not set");

  const raw = String(businessPhoneOrUrl || "").trim();
  const urlMatch = raw.match(/wa\.me\/c\/(\d+)/i);
  const digits = urlMatch ? urlMatch[1] : raw.replace(/\D/g, "");
  if (!digits || digits.length < 9) throw new Error("Invalid business phone or wa.me/c/ link");

  const chatId = normalizeWahaChatId(`${digits}@c.us`);
  const headers = wahaHeaders();
  const sid = session || config.waha.session;
  const apiBase = config.waha.apiUrl.replace(/\/$/, "");

  const attempts = [
    {
      label: "get-business-profiles-products (query)",
      run: () =>
        axios.get(`${apiBase}/api/${sid}/get-business-profiles-products`, {
          headers,
          params: { phone: chatId },
          timeout: 120_000,
        }),
    },
    {
      label: "get-business-profiles-products (digits)",
      run: () =>
        axios.get(`${apiBase}/api/${sid}/get-business-profiles-products`, {
          headers,
          params: { phone: digits },
          timeout: 120_000,
        }),
    },
    {
      label: "get-business-profiles-products (POST)",
      run: () =>
        axios.post(`${apiBase}/api/${sid}/get-business-profiles-products`, { phone: chatId }, { headers, timeout: 120_000 }),
    },
    {
      label: "get-products (digits)",
      run: () =>
        axios.get(`${apiBase}/api/${sid}/get-products`, {
          headers,
          params: { phone: digits, qnt: 200 },
          timeout: 120_000,
        }),
    },
    {
      label: "get-products (chatId)",
      run: () =>
        axios.get(`${apiBase}/api/${sid}/get-products`, {
          headers,
          params: { phone: chatId, qnt: 200 },
          timeout: 120_000,
        }),
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const { data } = await attempt.run();
      const products = normalizeWahaCatalogProducts(data);
      if (products.length) {
        console.log(`[waha] catalog import via ${attempt.label}: ${products.length} products`);
        return { chatId, products };
      }
    } catch (err) {
      lastError = err;
      console.warn(`[waha] catalog ${attempt.label} failed:`, err.response?.status || err.message);
    }
  }

  if (isWahaCatalogApiMissing(lastError)) {
    const e = new Error("WAHA catalog API not available on this WAHA build (HTTP 404)");
    e.code = "WAHA_CATALOG_API_MISSING";
    throw e;
  }
  throw new Error(lastError?.message || "Could not fetch business catalog from WAHA");
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
