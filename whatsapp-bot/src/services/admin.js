import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { sendText, customerKeyFromChatId, phoneDigitsFromChatId } from "./whatsapp.js";
import { sendReviewPrompt } from "./reviews.js";
import { setHumanHandoff } from "./session.js";
import {
  getOrder,
  updateOrderStatus,
  updateOrderMeta,
  listRecentOrders,
  getAllContacts,
  statusLabel,
  ORDER_STATUSES,
} from "./orders.js";
import { getSupplier } from "./suppliers.js";
import { getPickupPoint } from "./pickupPoints.js";
import {
  buildAdminPaidClaimMessage,
  filterPendingPaymentClaims,
  notifyStorePaymentConfirmed,
} from "./payment.js";
import { recordDeliveryPayout, getSettlementSummary, markPayoutPaid } from "./settlements.js";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function phonesMatch(a, b) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Kenya: 2547XXXXXXXX vs 07XXXXXXXX — same national number only
  const norm = (d) => {
    if (d.startsWith("254")) return d;
    if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
    if (d.length === 9) return `254${d}`;
    return d;
  };
  return norm(da) === norm(db);
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

  if (chatId && adminChatIds.has(chatId)) {
    return isAdminPhone(adminChatIds.get(chatId));
  }

  const chatDigits = phoneDigitsFromChatId(chatId);
  if (chatDigits && config.admin.phones.some((p) => phonesMatch(chatDigits, p))) {
    if (chatId && chatId.includes("@lid")) {
      registerAdminChatId(chatId, chatDigits);
    }
    return true;
  }

  // WhatsApp @lid ids — register when phone metadata matches ADMIN_PHONES.
  if (chatId?.includes("@lid")) {
    if (isAdminPhone(phone)) {
      registerAdminChatId(chatId, phone);
      return true;
    }
    return false;
  }

  // Metadata phone must match the sender chat id, not a random field in the payload.
  if (isAdminPhone(phone) && chatDigits && phonesMatch(phone, chatDigits)) {
    return true;
  }

  return false;
}

/** Register admin @lid on first verified contact (call early in webhook). */
export function tryRegisterAdminFromMessage(chatId, phone = "", text = "") {
  if (chatId && phone && isAdminPhone(phone)) {
    registerAdminChatId(chatId, phone);
    return isAdminSender(chatId, phone);
  }
  // Bootstrap @lid when the configured admin sends a command (single-admin setup).
  if (
    chatId?.includes("@lid") &&
    config.admin.phones.length === 1 &&
    (containsAdminCommand(text) ||
      /^admin\b/i.test((text || "").trim()) ||
      /^orders?\b/i.test((text || "").trim()))
  ) {
    registerAdminChatId(chatId, config.admin.phones[0]);
    console.log("[admin] bootstrapped @lid for", config.admin.phones[0]);
    return true;
  }
  return isAdminSender(chatId, phone);
}

/** Business WhatsApp owner typing #commands from the store phone (fromMe). */
export function isBusinessOwnerSender(chatId) {
  const digits = digitsOnly(chatId);
  const business = digitsOnly(config.store.businessNumber);
  if (!digits || !business) return false;
  return phonesMatch(digits, business);
}

export function canRunAdminCommands(chatId, phone = "", { allowBusinessOwner = false } = {}) {
  if (requireAdminSender(chatId, phone)) return true;
  if (allowBusinessOwner && isBusinessOwnerSender(chatId) && config.admin.phones.length > 0) {
    return true;
  }
  return false;
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

/** Detect explicit admin #commands only (no generic "# message" relay). */
export function containsAdminCommand(text) {
  const t = (text || "").trim();
  if (/^#(?:help|orders|status|broadcast|fulfill|payouts|paid|payments|payconfirm|notify-store|pickup)\b/i.test(t)) return true;
  if (/^#SK-\d+\s+/i.test(t)) return true;
  return false;
}

/** Detect admin commands (#status, #broadcast, etc.) even inside longer text. */
export function isAdminCommandText(text) {
  return containsAdminCommand(text);
}

/**
 * Resolve admin identity from the message sender only (never scan whole payload).
 */
export function resolveAdminIdentity(_body, parsed) {
  const phone = parsed.phone || phoneDigitsFromChatId(parsed.customerKey) || "";
  const verified = isAdminSender(parsed.customerKey, phone);
  return { verified, phone };
}

/** Hard gate — admin features only for configured ADMIN_PHONES. */
export function requireAdminSender(chatId, phone = "") {
  if (!isAdminSender(chatId, phone)) {
    return false;
  }
  if (config.admin.phones.length === 0) {
    console.warn("[admin] ADMIN_PHONES not configured — admin console disabled");
    return false;
  }
  return true;
}

/**
 * Route to admin handler only for explicit admin commands — not every admin message.
 * Admin can still type "menu" / shop like a normal customer otherwise.
 */
export function shouldRouteIncomingAsAdmin(body, parsed) {
  tryRegisterAdminFromMessage(parsed.customerKey, parsed.phone, parsed.text);

  if (!canRunAdminCommands(parsed.customerKey, parsed.phone)) return false;

  const text = (parsed.text || "").trim();
  if (/^admin\b/i.test(text)) return true;
  if (/^orders?\b/i.test(text)) return true;
  if (containsAdminCommand(parsed.text)) return true;
  return false;
}

function isBusinessChat(chatId) {
  const digits = digitsOnly(chatId);
  const business = digitsOnly(config.store.businessNumber);
  return digits === business || digits.endsWith(business.slice(-9));
}

function isAdminRelayAttempt(text) {
  const t = normalizeAdminCommand((text || "").trim());
  if (containsAdminCommand(t)) return true;
  if (/^admin\b/i.test(t) || /^orders?\b/i.test(t)) return true;
  return false;
}

const CUSTOMER_STATUS_MESSAGES = {
  confirmed: (o) =>
    `✅ *Order ${o.id} confirmed!*\n\nWe're preparing your *${o.productName}*. You'll pay KES ${o.priceKes.toLocaleString()} on delivery to M-Pesa Till *${config.store.mpesaTill}* (${config.store.mpesaTillName}). Asante! 🙏`,
  packed: (o) =>
    `📦 *Order ${o.id} packed!*\n\nYour *${o.productName}* is ready and waiting for a rider. We'll let you know when it's on the way. 🛵`,
  out_for_delivery: (o) =>
    `🛵 *Order ${o.id} is out for delivery!*\n\nYour order is on the way. Please have *KES ${o.priceKes.toLocaleString()}* ready to pay to M-Pesa Till *${config.store.mpesaTill}* (${config.store.mpesaTillName}) — *not to the rider*. Keep your phone on 📞`,
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
    if (order.status === "delivered") {
      await sendReviewPrompt(order.customerKey, order);
    }
  } catch (err) {
    console.error("[admin] failed to notify customer of status:", err.message);
  }
}

function adminHelpText() {
  return (
    `🛠️ *Sokoni admin commands*\n\n` +
    `📋 *#orders* — recent orders\n` +
    `💰 *#payments* — customer *paid* claims awaiting confirmation\n` +
    `✅ *#payconfirm SK-1042* — confirm customer M-Pesa payment\n` +
    `📦 *#notify-store SK-1042* — tell store/pickup point to release parcel\n` +
    `📍 *#pickup SK-1042 pp-xxxx* — assign pickup point to order\n` +
    `🔄 *#status SK-1042 delivered* — update + payout on delivery\n` +
    `📦 *#fulfill SK-1042* — notify supplier (no customer contact)\n` +
    `📦 *#fulfill SK-1042 share* — supplier delivers (with address)\n` +
    `💰 *#payouts* — supplier amounts owed\n` +
    `✅ *#paid SK-1042* — mark supplier paid\n` +
    `📣 *#broadcast <message>* — message all customers\n` +
    `🆔 *#SK-1042 <message>* — message customer\n` +
    `❓ *#help* — this list`
  );
}

async function handleOrdersCommand(adminChatId) {
  const orders = listRecentOrders(10);
  if (orders.length === 0) {
    return sendText(adminChatId, "No orders yet.");
  }
  const lines = orders.map((o) => {
    const margin = o.marginKes != null ? ` · margin KES ${o.marginKes.toLocaleString()}` : "";
    const sup = o.supplierId ? ` · supplier` : "";
    return (
      `*${o.id}* · ${statusLabel(o.status)}${sup}\n` +
      `${o.productName} — KES ${o.priceKes.toLocaleString()}${margin}\n` +
      `${o.customerName} · ${o.phone}`
    );
  });
  return sendText(
    adminChatId,
    `📋 *Recent orders*\n\n${lines.join("\n\n")}\n\n#fulfill <id> · #status <id> delivered`
  );
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
  if (result.status === "delivered" && result.order.supplierId) {
    const payout = recordDeliveryPayout(result.order);
    updateOrderMeta(result.order.id, { payoutStatus: payout ? "owed" : result.order.payoutStatus });
  }
  const payoutNote =
    result.status === "delivered" && result.order.sourcePriceKes
      ? `\nSupplier owed: KES ${result.order.sourcePriceKes.toLocaleString()} (#payouts)`
      : "";
  return sendText(
    adminChatId,
    `✅ *${result.order.id}* → ${statusLabel(result.status)}\nCustomer notified.${payoutNote}`
  );
}

async function handleFulfillCommand(adminChatId, args) {
  const parts = args.trim().split(/\s+/);
  const orderId = parts[0];
  const share = parts[1]?.toLowerCase() === "share";
  if (!orderId) {
    return sendText(adminChatId, "Usage: #fulfill SK-1042\nOr: #fulfill SK-1042 share (includes customer address)");
  }
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
  if (!supplier?.phone) {
    return sendText(
      adminChatId,
      `⚠️ No supplier phone for this order. Fulfill manually or add supplier on approval.`
    );
  }

  const supplierChat = `${supplier.phone.replace(/\D/g, "")}@c.us`;
  let msg =
    `📦 *Sokoni supply order ${order.id}*\n\n` +
    `Product: *${order.productName}*\n` +
    `Qty: 1\n` +
    `Your payout: KES ${(order.sourcePriceKes || 0).toLocaleString()} (after customer delivery)\n\n`;

  if (share) {
    msg +=
      `*Deliver to customer:*\n` +
      `${order.customerName}\n` +
      `${order.location}\n` +
      `Phone: ${order.phone}\n\n` +
      `_Reply READY when dispatched, or call Sokoni admin if you need a hub pickup instead._`;
    updateOrderMeta(order.id, {
      deliveryMode: "supplier_to_customer",
      shareCustomerContact: true,
      supplierNotified: true,
    });
  } else {
    msg +=
      `*Sokoni hub / rider pickup — customer details not included.*\n` +
      `Reply READY when the item is packed, or tell us if *you can deliver* to the buyer's area.\n\n` +
      `_Sokoni admin will coordinate delivery based on location._`;
    updateOrderMeta(order.id, {
      deliveryMode: "pending_coordination",
      shareCustomerContact: false,
      supplierNotified: true,
    });
  }

  try {
    await sendText(supplierChat, msg);
    updateOrderMeta(order.id, {
      fulfillmentStoreId: supplier.id,
      fulfillmentStoreName: supplier.businessName,
      fulfillmentStorePhone: supplier.phone,
      fulfillmentStoreCity: supplier.city,
    });
    return sendText(
      adminChatId,
      `✅ Supplier *${supplier.businessName}* notified for *${order.id}*${share ? " (with customer address)" : ""}.`
    );
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed to WhatsApp supplier: ${err.message}`);
  }
}

async function handlePayoutsCommand(adminChatId) {
  const summary = getSettlementSummary();
  if (summary.count === 0) {
    return sendText(adminChatId, "💰 No supplier payouts owed right now.");
  }
  const lines = summary.entries.slice(0, 10).map(
    (e) =>
      `*${e.orderId}* · ${e.supplierName}\n` +
      `Pay: KES ${e.payoutAmountKes.toLocaleString()} · ${e.productName}\n` +
      `#paid ${e.orderId} when sent`
  );
  return sendText(
    adminChatId,
    `💰 *Owed to suppliers:* KES ${summary.totalOwedKes.toLocaleString()} (${summary.count})\n\n${lines.join("\n\n")}`
  );
}

async function handlePaymentsCommand(adminChatId) {
  const pending = filterPendingPaymentClaims(listRecentOrders(50));
  if (pending.length === 0) {
    return sendText(adminChatId, "💰 No pending customer payment claims. Customers reply *paid* after paying the till.");
  }
  const lines = pending.slice(0, 10).map((o) => {
    const store = o.pickupPointName || o.fulfillmentStoreName || (o.supplierId ? "supplier" : "not assigned");
    return (
      `*${o.id}* · KES ${o.priceKes.toLocaleString()}\n` +
      `${o.customerName} · ${o.phone}\n` +
      `Store: ${store}\n` +
      `#payconfirm ${o.id} · #notify-store ${o.id}`
    );
  });
  return sendText(
    adminChatId,
    `💰 *Payment claims (${pending.length})*\n\n${lines.join("\n\n")}\n\nConfirm M-Pesa on till ${config.store.mpesaTill} first, then #payconfirm.`
  );
}

async function handlePayconfirmCommand(adminChatId, orderId) {
  if (!orderId) return sendText(adminChatId, "Usage: #payconfirm SK-1042");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  updateOrderMeta(order.id, {
    customerPaymentStatus: "confirmed",
    customerPaidConfirmedAt: Date.now(),
  });

  try {
    await sendText(
      order.customerKey,
      `✅ *Payment confirmed* for *${order.id}*!\n\nWe verified your M-Pesa payment of KES ${order.priceKes.toLocaleString()} to Till *${config.store.mpesaTill}*. Your order will be released shortly. Asante! 🙏`
    );
  } catch (err) {
    console.warn("[admin] customer pay confirm notify failed:", err.message);
  }

  return sendText(
    adminChatId,
    `✅ Payment confirmed for *${order.id}* · KES ${order.priceKes.toLocaleString()}\nCustomer notified.\n\nNext: #notify-store ${order.id}`
  );
}

async function handleNotifyStoreCommand(adminChatId, orderId) {
  if (!orderId) return sendText(adminChatId, "Usage: #notify-store SK-1042");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  if (order.customerPaymentStatus !== "confirmed") {
    return sendText(
      adminChatId,
      `⚠️ Customer payment not confirmed yet for *${order.id}*. Run #payconfirm ${order.id} first.`
    );
  }

  const result = await notifyStorePaymentConfirmed(order);
  if (result.error === "no_store") {
    return sendText(
      adminChatId,
      `⚠️ No store assigned. Use:\n#pickup ${order.id} <pp-id>\nOr fulfill via supplier first.`
    );
  }

  return sendText(
    adminChatId,
    `✅ Store *${result.store.name}* (+${result.store.phone}) notified to release *${order.id}*.`
  );
}

async function handleAssignPickupCommand(adminChatId, args) {
  const parts = args.trim().split(/\s+/);
  const orderId = parts[0];
  const pointId = parts[1];
  if (!orderId || !pointId) {
    return sendText(adminChatId, "Usage: #pickup SK-1042 pp-xxxx");
  }
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const point = getPickupPoint(pointId);
  if (!point) return sendText(adminChatId, `⚠️ Pickup point *${pointId}* not found.`);

  updateOrderMeta(order.id, {
    pickupPointId: point.id,
    pickupPointName: point.shopName,
    pickupPointPhone: point.phone,
    fulfillmentStoreId: point.id,
    fulfillmentStoreName: point.shopName,
    fulfillmentStorePhone: point.phone,
    fulfillmentStoreCity: point.city,
  });

  return sendText(
    adminChatId,
    `✅ *${order.id}* assigned to pickup point *${point.shopName}* (${point.id})\n+${point.phone} · ${point.city}`
  );
}

async function handlePaidCommand(adminChatId, orderId) {
  if (!orderId) return sendText(adminChatId, "Usage: #paid SK-1042");
  const entry = markPayoutPaid(orderId);
  if (!entry) return sendText(adminChatId, `⚠️ No owed payout for *${orderId}*.`);
  updateOrderMeta(orderId, { payoutStatus: "paid" });
  return sendText(
    adminChatId,
    `✅ Marked *${entry.orderId}* paid — KES ${entry.payoutAmountKes.toLocaleString()} to ${entry.supplierName}.`
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
  const embedded = t.match(/#(?:help|orders|status|broadcast|fulfill|payouts|paid|payments|payconfirm|notify-store|pickup)\b[\s\S]*/i);
  if (embedded) return embedded[0].trim();
  const sk = t.match(/#SK-\d+\s+[\s\S]+/i);
  if (sk) return sk[0].trim();
  if (/^orders?\b/i.test(t)) return "#orders";
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
    if (order.status === "delivered" && !order.reviewPromptSent) {
      await sendReviewPrompt(order.customerKey, order);
    }
    return sendText(adminChatId, `✅ Sent to *${order.customerName}* (${order.id}).`);
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed to send: ${err.message}`);
  }
}

/** Parse and run an admin command. Returns true if handled. */
async function runAdminCommand(adminChatId, text, quotedText, { allowBusinessOwner = false } = {}) {
  const phone = phoneDigitsFromChatId(adminChatId) || "";
  if (!canRunAdminCommands(adminChatId, phone, { allowBusinessOwner })) {
    return false;
  }
  const t = normalizeAdminCommand(text.trim());

  if (/^#help\b/i.test(t)) {
    await sendText(adminChatId, adminHelpText());
    return true;
  }
  if (/^#orders?\b/i.test(t) || /^orders?\b/i.test(t)) {
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
  if (/^#fulfill\b/i.test(t)) {
    await handleFulfillCommand(adminChatId, t.replace(/^#fulfill\b/i, ""));
    return true;
  }
  if (/^#payouts\b/i.test(t)) {
    await handlePayoutsCommand(adminChatId);
    return true;
  }
  if (/^#payments\b/i.test(t)) {
    await handlePaymentsCommand(adminChatId);
    return true;
  }
  if (/^#payconfirm\b/i.test(t)) {
    const oid = t.replace(/^#payconfirm\b/i, "").trim().split(/\s+/)[0];
    await handlePayconfirmCommand(adminChatId, oid);
    return true;
  }
  if (/^#notify-store\b/i.test(t)) {
    const oid = t.replace(/^#notify-store\b/i, "").trim().split(/\s+/)[0];
    await handleNotifyStoreCommand(adminChatId, oid);
    return true;
  }
  if (/^#pickup\b/i.test(t)) {
    await handleAssignPickupCommand(adminChatId, t.replace(/^#pickup\b/i, ""));
    return true;
  }
  if (/^#paid\b/i.test(t)) {
    const oid = t.replace(/^#paid\b/i, "").trim().split(/\s+/)[0];
    await handlePaidCommand(adminChatId, oid);
    return true;
  }

  const targeted = t.match(/^#(SK-\d+)\s+([\s\S]+)/i);
  if (targeted) {
    await handleTargetedOrderMessage(adminChatId, targeted[1].toUpperCase(), targeted[2]);
    return true;
  }

  await sendText(adminChatId, adminHelpText());
  return true;
}

/**
 * Handle an INCOMING message from a separate admin console number.
 * The admin manages the shop from their own phone, so their messages arrive
 * as normal incoming messages (not fromMe). Route them to admin commands.
 */
export async function handleAdminIncoming({ customerKey, text, quotedText, phone = "" }) {
  tryRegisterAdminFromMessage(customerKey, phone, text);
  if (!canRunAdminCommands(customerKey, phone)) {
    console.warn("[admin] blocked incoming admin attempt", customerKey, phone);
    return false;
  }

  const cmd = normalizeAdminCommand(text);
  console.log("[admin:incoming]", { from: customerKey, phone, cmd: cmd?.slice(0, 80) });

  if (/^admin\b/i.test((text || "").trim()) || /^orders?\b/i.test((text || "").trim())) {
    return runAdminCommand(customerKey, cmd, quotedText);
  }

  if (isAdminRelayAttempt(cmd)) {
    return runAdminCommand(customerKey, cmd, quotedText);
  }

  return false;
}

/** Handle messages sent by the store owner (fromMe). Admin #commands only from ADMIN_PHONES. */
export async function handleAdminOutgoing({ fromChatId, toChatId, text, quotedText }) {
  console.log("[admin:outgoing]", {
    to: toChatId,
    text: text?.slice(0, 60),
    quoted: quotedText?.slice(0, 80),
  });

  const fromPhone = phoneDigitsFromChatId(fromChatId);
  const allowBusinessOwner = isBusinessOwnerSender(fromChatId);
  const adminCommand =
    canRunAdminCommands(fromChatId, fromPhone, { allowBusinessOwner }) &&
    isAdminRelayAttempt(normalizeAdminCommand(text));

  if (adminCommand) {
    const replyTo = allowBusinessOwner ? fromChatId || config.admin.primary : fromChatId || config.admin.primary;
    return runAdminCommand(replyTo, text, quotedText, { allowBusinessOwner });
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
  const candidates = [
    payload._data?.from?.user,
    payload._data?.from?.server === "c.us" ? payload._data?.from?.user : null,
    payload._data?.author,
    payload._data?.participant,
    payload.participant,
    payload._data?.participant,
    payload._data?.sender?.id?.user,
    payload._data?.id?.participant,
  ];
  if (!phone) {
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
