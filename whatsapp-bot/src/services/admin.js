import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { sendText, customerKeyFromChatId, phoneDigitsFromChatId } from "./whatsapp.js";
import { relayAdminMessage } from "./handoff.js";
import { setHumanHandoff } from "./session.js";
import {
  getOrder,
  updateOrderStatus,
  listRecentOrders,
  getAllContacts,
  statusLabel,
  ORDER_STATUSES,
} from "./orders.js";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function phonesMatch(a, b) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db.slice(-9)) || db.endsWith(da.slice(-9));
}

function isAdminPhone(phone) {
  if (!phone) return false;
  return config.admin.phones.some((p) => phonesMatch(phone, p));
}

/** Persisted @lid chat IDs verified for a configured admin phone. */
const adminChatIds = new Map();
let adminIdsLoaded = false;
const ADMIN_IDS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "admin-chat-ids.json");

function seedAdminCusIds() {
  for (const p of config.admin.phones) {
    adminChatIds.set(`${p}@c.us`, p);
  }
}

function loadAdminChatIds() {
  if (adminIdsLoaded) return;
  adminIdsLoaded = true;
  adminChatIds.clear();
  seedAdminCusIds();
  try {
    if (existsSync(ADMIN_IDS_FILE)) {
      const raw = JSON.parse(readFileSync(ADMIN_IDS_FILE, "utf-8"));
      if (Array.isArray(raw)) {
        for (const id of raw) {
          if (typeof id === "string" && id.endsWith("@c.us") && isAdminPhone(digitsOnly(id))) {
            adminChatIds.set(id, digitsOnly(id));
          }
        }
      } else if (raw && typeof raw === "object") {
        for (const [id, phone] of Object.entries(raw)) {
          const p = digitsOnly(phone);
          if (id && p && isAdminPhone(p)) adminChatIds.set(id, p);
        }
      }
    }
  } catch {
    /* first run */
  }
  persistAdminChatIds();
}

loadAdminChatIds();

function persistAdminChatIds() {
  try {
    const dir = path.dirname(ADMIN_IDS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ADMIN_IDS_FILE, JSON.stringify(Object.fromEntries(adminChatIds), null, 2));
  } catch (err) {
    console.error("[admin] failed to persist chat ids:", err.message);
  }
}

/** True if a chatId/phone belongs to a configured admin console number. */
export function isAdminSender(chatId, phone = "") {
  loadAdminChatIds();

  if (isAdminPhone(phone)) return true;

  if (chatId && adminChatIds.has(chatId)) {
    const mapped = adminChatIds.get(chatId);
    return isAdminPhone(mapped);
  }

  const digits = digitsOnly(chatId);
  if (!digits || chatId?.includes("@lid")) return false;

  return config.admin.phones.some(
    (p) => digits === p || digits.endsWith(p.slice(-9)) || p.endsWith(digits.slice(-9))
  );
}

export function registerAdminChatId(chatId, phone = "") {
  if (!chatId || !isAdminPhone(phone)) return;
  loadAdminChatIds();
  const p = digitsOnly(phone);
  if (adminChatIds.get(chatId) === p) return;
  adminChatIds.set(chatId, p);
  persistAdminChatIds();
  console.log("[admin] registered chat id", chatId, "for", p);
}

/** Detect #commands anywhere in the message (not only at the start). */
export function containsAdminCommand(text) {
  const t = text || "";
  if (/#(?:help|orders|status|broadcast)\b/i.test(t)) return true;
  if (/#SK-\d+\s+/i.test(t)) return true;
  if (/^#\s+.+/s.test(t.trim())) return true;
  return false;
}

/** Detect admin commands (#status, #broadcast, etc.) even inside longer text. */
export function isAdminCommandText(text) {
  return containsAdminCommand(text);
}

/** Scan WAHA payload for any string matching a configured admin phone. */
export function findAdminPhoneInPayload(payload, depth = 0) {
  if (!payload || depth > 10) return null;
  if (typeof payload === "string") {
    const d = digitsOnly(payload);
    if (d.length >= 9 && d.length <= 15 && isAdminPhone(d)) return d;
    return null;
  }
  if (typeof payload !== "object") return null;
  for (const v of Object.values(payload)) {
    const found = findAdminPhoneInPayload(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Resolve admin identity from chat id + WAHA payload. Admin ONLY if phone
 * matches ADMIN_PHONES or chat id was previously verified for an admin phone.
 */
export function resolveAdminIdentity(body, parsed) {
  const payloadPhone = findAdminPhoneInPayload(body?.payload);
  const phone = parsed.phone || payloadPhone || "";
  const verified = isAdminSender(parsed.customerKey, phone);
  if (verified && parsed.customerKey?.includes("@lid") && isAdminPhone(phone)) {
    registerAdminChatId(parsed.customerKey, phone);
  }
  return { verified, phone };
}

/**
 * Should this incoming message be handled as admin (not customer)?
 * Strict: only configured admin phone(s) — never trust #commands from customers.
 */
export function shouldRouteIncomingAsAdmin(body, parsed) {
  const { verified } = resolveAdminIdentity(body, parsed);
  if (!verified) return false;

  const text = (parsed.text || "").trim();
  if (/^admin\b/i.test(text)) return true;
  if (containsAdminCommand(parsed.text)) return true;
  if (parsed.quotedText && /new cod order|human help requested|\[chat:/i.test(parsed.quotedText)) {
    return true;
  }
  return false;
}

function isBusinessChat(chatId) {
  const digits = digitsOnly(chatId);
  const business = digitsOnly(config.store.businessNumber);
  return digits === business || digits.endsWith(business.slice(-9));
}

function isAdminRelayAttempt(text, quotedText) {
  const t = normalizeAdminCommand(text || "");
  if (containsAdminCommand(t)) return true;
  if (quotedText && /human help requested|new cod order|\[chat:/i.test(quotedText)) return true;
  return false;
}

const CUSTOMER_STATUS_MESSAGES = {
  confirmed: (o) =>
    `✅ *Order ${o.id} confirmed!*\n\nWe're preparing your *${o.productName}*. You'll pay KES ${o.priceKes.toLocaleString()} on delivery (cash or M-Pesa). Asante! 🙏`,
  packed: (o) =>
    `📦 *Order ${o.id} packed!*\n\nYour *${o.productName}* is ready and waiting for a rider. We'll let you know when it's on the way. 🛵`,
  out_for_delivery: (o) =>
    `🛵 *Order ${o.id} is out for delivery!*\n\nYour rider is on the way with your *${o.productName}*. Please have *KES ${o.priceKes.toLocaleString()}* ready (cash or M-Pesa). Keep your phone on 📞`,
  delivered: (o) =>
    `🎉 *Order ${o.id} delivered!*\n\nEnjoy your *${o.productName}* 💚 Asante for shopping with Sokoni! Type *menu* anytime to shop again.`,
  cancelled: (o) =>
    `❌ *Order ${o.id} was cancelled.*\n\nIf this was a mistake or you'd like to reorder, type *menu* and we'll help you out.`,
};

async function notifyCustomerOfStatus(order) {
  const builder = CUSTOMER_STATUS_MESSAGES[order.status];
  if (!builder) return;
  try {
    await sendText(order.customerKey, builder(order));
  } catch (err) {
    console.error("[admin] failed to notify customer of status:", err.message);
  }
}

function adminHelpText() {
  return (
    `🛠️ *Sokoni admin commands*\n\n` +
    `📋 *#orders* — recent orders\n` +
    `🔄 *#status SK-1042 out* — update status\n` +
    `   (received/confirmed/packed/out/delivered/cancelled)\n` +
    `📣 *#broadcast <message>* — message all customers\n` +
    `💬 *# <message>* — reply to the last customer who asked for help\n` +
    `🆔 *#SK-1042 <message>* — message that order's customer\n` +
    `❓ *#help* — this list`
  );
}

async function handleOrdersCommand(adminChatId) {
  const orders = listRecentOrders(10);
  if (orders.length === 0) {
    return sendText(adminChatId, "No orders yet.");
  }
  const lines = orders.map(
    (o) =>
      `*${o.id}* · ${statusLabel(o.status)}\n${o.productName} — KES ${o.priceKes.toLocaleString()}\n${o.customerName} · ${o.phone}`
  );
  return sendText(adminChatId, `📋 *Recent orders*\n\n${lines.join("\n\n")}\n\nUpdate: #status <id> <status>`);
}

async function handleStatusCommand(adminChatId, args) {
  const [orderId, ...rest] = args.trim().split(/\s+/);
  const statusInput = rest.join(" ");
  if (!orderId || !statusInput) {
    return sendText(
      adminChatId,
      `Usage: #status SK-1042 out\n\nStatuses: ${ORDER_STATUSES.join(", ")}`
    );
  }
  const result = updateOrderStatus(orderId, statusInput);
  if (!result) {
    return sendText(adminChatId, `⚠️ Order *${orderId}* not found. Try #orders.`);
  }
  if (result.error === "invalid_status") {
    return sendText(adminChatId, `⚠️ Unknown status. Use: ${ORDER_STATUSES.join(", ")}`);
  }
  await notifyCustomerOfStatus(result.order);
  return sendText(
    adminChatId,
    `✅ *${result.order.id}* → ${statusLabel(result.status)}\nCustomer notified on WhatsApp.`
  );
}

async function handleBroadcastCommand(adminChatId, message) {
  const text = message.trim();
  if (!text) {
    return sendText(adminChatId, `Usage: #broadcast New arrivals just landed! 🎉`);
  }
  const contacts = getBroadcastRecipients();
  if (contacts.length === 0) {
    return sendText(adminChatId, "No customers to broadcast to yet.");
  }
  let sent = 0;
  let failed = 0;
  for (const contact of contacts) {
    try {
      await sendText(contact.customerKey, `📣 *Sokoni*\n\n${text}\n\n_Type *menu* to shop — pay on delivery 💵_`);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error("[broadcast] failed for", contact.customerKey, err.message);
    }
  }
  const failNote = failed ? `\n⚠️ ${failed} failed to send.` : "";
  return sendText(adminChatId, `📣 Broadcast sent to *${sent}* customer(s).${failNote}`);
}

/** All unique customer chat IDs from contacts + order history. */
function getBroadcastRecipients() {
  const seen = new Set();
  const out = [];

  for (const c of getAllContacts()) {
    if (!c.customerKey || seen.has(c.customerKey)) continue;
    if (isBusinessChat(c.customerKey) || isAdminSender(c.customerKey, c.phone)) continue;
    seen.add(c.customerKey);
    out.push(c);
  }

  for (const o of listRecentOrders(500)) {
    if (!o.customerKey || seen.has(o.customerKey)) continue;
    if (isBusinessChat(o.customerKey) || isAdminSender(o.customerKey, o.phone)) continue;
    seen.add(o.customerKey);
    out.push({
      customerKey: o.customerKey,
      chatId: o.chatId,
      phone: o.phone,
      displayName: o.customerName,
    });
  }

  return out;
}

/** Pull a #command out of longer pasted text (e.g. "Update: #status SK-1002 confirmed"). */
function normalizeAdminCommand(text) {
  const t = (text || "").trim();
  const embedded = t.match(/#(?:help|orders|status|broadcast)\b[\s\S]*/i);
  if (embedded) return embedded[0].trim();
  const sk = t.match(/#SK-\d+\s+[\s\S]+/i);
  if (sk) return sk[0].trim();
  if (/^#\s+.+/s.test(t)) return t;
  return t;
}

async function handleTargetedOrderMessage(adminChatId, orderId, message) {
  const order = getOrder(orderId);
  if (!order) {
    return sendText(adminChatId, `⚠️ Order *${orderId}* not found. Try #orders.`);
  }
  try {
    await sendText(order.customerKey, message.trim());
    setHumanHandoff(order.customerKey, { adminDirect: true, startedAt: Date.now(), ackSent: true });
    return sendText(adminChatId, `✅ Sent to *${order.customerName}* (${order.id}).`);
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed to send: ${err.message}`);
  }
}

/** Parse and run an admin command. Returns true if handled. */
async function runAdminCommand(adminChatId, text, quotedText) {
  const t = text.trim();

  if (/^#help\b/i.test(t)) {
    await sendText(adminChatId, adminHelpText());
    return true;
  }
  if (/^#orders\b/i.test(t)) {
    await handleOrdersCommand(adminChatId);
    return true;
  }
  if (/^#status\b/i.test(t)) {
    await handleStatusCommand(adminChatId, t.replace(/^#status\b/i, ""));
    return true;
  }
  if (/^#broadcast\b/i.test(t)) {
    await handleBroadcastCommand(adminChatId, t.replace(/^#broadcast\b/i, ""));
    return true;
  }

  const targeted = t.match(/^#(SK-\d+)\s+([\s\S]+)/i);
  if (targeted) {
    await handleTargetedOrderMessage(adminChatId, targeted[1].toUpperCase(), targeted[2]);
    return true;
  }

  // Fallback: relay a plain "# message" (or quoted reply) to the last customer.
  await relayAdminMessage({ quotedText, replyText: text, adminChatId });
  return true;
}

/**
 * Handle an INCOMING message from a separate admin console number.
 * The admin manages the shop from their own phone, so their messages arrive
 * as normal incoming messages (not fromMe). Route them to admin commands.
 */
export async function handleAdminIncoming({ customerKey, text, quotedText, phone = "" }) {
  const cmd = normalizeAdminCommand(text);
  console.log("[admin:incoming]", { from: customerKey, phone, cmd: cmd?.slice(0, 80) });

  if (/^admin\b/i.test((text || "").trim())) {
    return sendText(customerKey, adminHelpText());
  }

  if (isAdminRelayAttempt(cmd, quotedText)) {
    return runAdminCommand(customerKey, cmd, quotedText);
  }
  return relayAdminMessage({ quotedText, replyText: cmd, adminChatId: customerKey });
}

/** Handle messages sent by the store owner (fromMe). */
export async function handleAdminOutgoing({ fromChatId, toChatId, text, quotedText }) {
  console.log("[admin:outgoing]", {
    to: toChatId,
    text: text?.slice(0, 60),
    quoted: quotedText?.slice(0, 80),
  });

  if (isAdminRelayAttempt(text, quotedText)) {
    return runAdminCommand(fromChatId || config.admin.primary, text, quotedText);
  }

  if (toChatId && !isBusinessChat(toChatId)) {
    const customerKey = customerKeyFromChatId(toChatId);
    setHumanHandoff(customerKey, { adminDirect: true, startedAt: Date.now(), ackSent: true });
    console.log("[admin:direct-reply]", customerKey);
  }

  return false;
}

export function extractCustomerMeta(payload) {
  const chatId = customerKeyFromChatId(payload.from);
  const displayName =
    payload.pushName ||
    payload._data?.notifyName ||
    payload._data?.pushName ||
    payload.notifyName ||
    "";
  let phone = phoneDigitsFromChatId(chatId);
  if (!phone) {
    const candidates = [
      payload._data?.from?.user,
      payload._data?.author,
      payload.participant,
      payload._data?.participant,
    ];
    for (const c of candidates) {
      const d = digitsOnly(c);
      if (d.length >= 9) {
        phone = d;
        break;
      }
    }
  }
  return { chatId, displayName: displayName.trim(), phone };
}
