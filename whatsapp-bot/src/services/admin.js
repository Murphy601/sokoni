import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import {
  sendText,
  toChatId,
  withAdminReplyCapture,
  customerKeyFromChatId,
  phoneDigitsFromChatId,
  isBotEcho,
  wasRecentBotSend,
} from "./whatsapp.js";
import { sendReviewPrompt } from "./reviews.js";
import { setHumanHandoff } from "./session.js";
import {
  getOrder,
  getOrdersForCustomer,
  updateOrderStatus,
  updateOrderMeta,
  listRecentOrders,
  getAllContacts,
  statusLabel,
  ORDER_STATUSES,
  normalizeStatus,
  extractOrderIdFromText,
  ORDER_ID_CAPTURE,
  ORDER_ID_RE,
  normalizeOrderId,
} from "./orders.js";
import { getSupplier } from "./suppliers.js";
import { planFulfillment, applyFulfillmentPlan } from "./fulfillment.js";
import { canFulfillOrder, isDarajaConfigured } from "./prepaid-checkout.js";
import { applyPostPaymentAutomation, onOrderDelivered } from "./escrow-automation.js";
import {
  scanShipmentAtHub,
  advanceShipmentStatus,
  buildPublicTrackingPayload,
} from "./shipments.js";
import { getPickupPoint } from "./pickupPoints.js";
import {
  buildAdminPaidClaimMessage,
  filterPendingPaymentClaims,
  notifyStorePaymentConfirmed,
  formatShortPaymentReminder,
} from "./payment.js";
import {
  pickupMetaFromPoint,
  formatPickupAssignedMessage,
  formatPickupReadyMessage,
  rankPickupPointsForLocation,
} from "./fulfillment.js";
import { broadcastFooter, OFFER_PERCENT, PROMO_CODE } from "./trust-copy.js";
import { isBroadcastOptedOut } from "./customer-automations.js";
import {
  handleApologCommand,
  handleDamageCommand,
  handleDelayCommand,
  handleOosCommand,
  handleTransitCommand,
  handleRecoverCommand,
} from "./ops-admin.js";
import {
  handleOpsCommand,
  handleSyncCommand,
  handleCatalogCommand,
  handleStockCommand,
  handleFlagsCommand,
  handleDbOpsCommand,
} from "./platform-admin.js";
import { getSettlementSummary, markPayoutPaid, initiateSettlementB2C } from "./settlements.js";
import { markWithdrawalPaid, markWithdrawalPaidByOrderId } from "./seller-withdrawals.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { isB2CReady, b2cMeta } from "./daraja-mpesa.js";

import { phonesMatchKenya, digitsOnly as phoneDigits, normalizeKenyaPhone, isBossPhone, checkIfBoss, extractBossPhoneFromPayload } from "../lib/phone-normalize.js";

function digitsOnly(value) {
  return phoneDigits(value);
}

function phonesMatch(a, b) {
  return phonesMatchKenya(a, b);
}

function isAdminPhone(phone) {
  if (!phone) return false;
  // Hardwired Boss last-9 always wins (even if ADMIN_PHONES env is wrong/empty).
  if (checkIfBoss(phone, config.admin.phones || [])) return true;
  const list = [
    ...(config.admin.phones || []),
    ...(config.admin.matchAliases || []),
  ];
  if (isBossPhone(phone, list)) return true;
  return list.some((p) => phonesMatch(phone, p));
}

/** Public re-export for webhook / PING path. */
export { checkIfBoss };

/** Persisted @lid chat IDs verified for a configured admin phone. */
const adminChatIds = new Map();
let adminIdsLoaded = false;
const ADMIN_IDS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "admin-chat-ids.json");

function seedAdminCusIds() {
  for (const p of config.admin.phones) {
    const n = normalizeKenyaPhone(p) || digitsOnly(p);
    if (!n) continue;
    adminChatIds.set(`${n}@c.us`, n);
    // Also seed national-zero form if someone stored that historically
    if (n.startsWith("254") && n.length >= 12) {
      const national = `0${n.slice(3)}`;
      adminChatIds.set(`${national}@c.us`, n);
    }
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

  const chatDigits = phoneDigitsFromChatId(chatId);
  const incoming = digitsOnly(phone) || chatDigits || "";
  if (process.env.ADMIN_PHONE_DEBUG === "1" || process.env.ADMIN_PHONE_DEBUG === "true") {
    console.log("[admin] Incoming Phone:", phone || "(empty)", "chatId:", chatId, "digits:", incoming);
  }

  if (chatId && adminChatIds.has(chatId)) {
    return isAdminPhone(adminChatIds.get(chatId));
  }

  if (chatDigits && isAdminPhone(chatDigits)) {
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
  // Relaxed: if chatDigits missing (some WAHA payloads), still trust isAdminPhone(phone).
  if (isAdminPhone(phone)) {
    if (!chatDigits || phonesMatch(phone, chatDigits)) {
      return true;
    }
  }

  return false;
}

/** Register admin @lid on first verified contact (call early in webhook). */
export function tryRegisterAdminFromMessage(chatId, phone = "", text = "") {
  if (chatId && phone && isAdminPhone(phone)) {
    registerAdminChatId(chatId, phone);
    return isAdminSender(chatId, phone);
  }
  // Bootstrap @lid when hardwired Boss / single ADMIN_PHONES sends PING or a command.
  const looksBossProbe =
    /^\s*ping\s*$/i.test(String(text || "")) ||
    containsAdminCommand(text) ||
    /^\s*OVERRIDE\s*:/i.test((text || "").trim()) ||
    /^admin\b/i.test((text || "").trim()) ||
    /^orders?\b/i.test((text || "").trim());
  if (chatId?.includes("@lid") && looksBossProbe) {
    if (phone && checkIfBoss(phone)) {
      registerAdminChatId(chatId, phone);
      console.log("[admin] bootstrapped @lid for Boss phone", phone);
      return true;
    }
    if (config.admin.phones.length === 1 && looksBossProbe) {
      registerAdminChatId(chatId, config.admin.phones[0]);
      console.log("[admin] bootstrapped @lid for", config.admin.phones[0]);
      return true;
    }
    // PING from @lid with no phone yet — still map to hardwired Boss if only one hardwire
    if (/^\s*ping\s*$/i.test(String(text || "")) && config.admin.phones[0]) {
      registerAdminChatId(chatId, config.admin.phones[0]);
      console.log("[admin] PING bootstrap @lid →", config.admin.phones[0]);
      return true;
    }
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
  if (/^\s*OVERRIDE\s*:/i.test(t)) return true;
  if (/^\s*![a-z][\w-]*/i.test(t)) return true;
  if (/^\s*FORCE_PAYOUT\b/i.test(t)) return true;
  if (/^#(?:help|orders|status|broadcast|fulfill|payouts|payb2c|paid|payments|payconfirm|notify-store|pickup|nearby|scan|ops|sync|catalog|stock|flags|db|apolog|wrong|damage|recover|delay|oos|transit|resolve|done)\b/i.test(t)) return true;
  if (new RegExp(`^#${ORDER_ID_CAPTURE}\\s+`, "i").test(t)) return true;
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
export async function shouldRouteIncomingAsAdmin(body, parsed) {
  tryRegisterAdminFromMessage(parsed.customerKey, parsed.phone, parsed.text);

  const text = (parsed.text || "").trim();
  const looksLikeStaffCmd =
    /^\s*OVERRIDE\s*:/i.test(text) ||
    /^\s*![a-z][\w-]*/i.test(text) ||
    /^\s*FORCE_PAYOUT\b/i.test(text) ||
    /^admin\b/i.test(text) ||
    /^orders?\b/i.test(text) ||
    /^[1-4]$/.test(text) ||
    containsAdminCommand(parsed.text);

  if (!looksLikeStaffCmd) return false;

  if (canRunAdminCommands(parsed.customerKey, parsed.phone)) return true;

  try {
    const { resolveStaffRole } = await import("./staff-roles.js");
    const staff = await resolveStaffRole(parsed.phone || phoneDigitsFromChatId(parsed.customerKey));
    return Boolean(staff);
  } catch {
    return false;
  }
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
    `✅ *Order ${o.id} confirmed!*\n\nWe're preparing your *${o.productName}*. Payment secured in Sokoni escrow — nothing more to pay on delivery. Asante! 🙏`,
  packed: (o) =>
    o.deliveryMode === "pickup_point" && o.pickupPointName
      ? `📦 *Order ${o.id} packed!*\n\nYour *${o.productName}* is ready at pickup partner *${o.pickupPointName}*. We'll send the shop address in the next message 📍`
      : `📦 *Order ${o.id} packed!*\n\nYour *${o.productName}* is ready and waiting for a rider. We'll let you know when it's on the way. 🛵`,
  out_for_delivery: (o) =>
    o.deliveryMode === "pickup_point" && o.pickupPointName
      ? `📍 *Order ${o.id} is ready for collection!*\n\nCollect your *${o.productName}* from *${o.pickupPointName}*. Already paid — show order ID *${o.id}* at the shop.`
      : `🛵 *Order ${o.id} is out for delivery!*\n\nYour rider is on the way with *${o.productName}*. Already paid upfront — inspect on arrival. Keep your phone on 📞`,
  delivered: (o) =>
    o.deliveryMode === "pickup_point"
      ? `🎉 *Order ${o.id} collected!*\n\nEnjoy your *${o.productName}* 💚 Asante for shopping with Sokoni Mall! Type *menu* anytime.`
      : `🎉 *Order ${o.id} delivered!*\n\nEnjoy your *${o.productName}* 💚 Asante for shopping with Sokoni Mall! Type *menu* anytime.`,
  cancelled: (o) =>
    `❌ *Order ${o.id} was cancelled.*\n\nPrepaid orders are refunded if payment was taken. Type *menu* to reorder or find alternatives.`,
};

async function notifyCustomerPickupDetails(order, { force = false } = {}) {
  if (order.deliveryMode !== "pickup_point" || !order.pickupPointName) return;
  if (!force && order.customerPickupNotifiedAt) return;

  const packedReady = ["packed", "out_for_delivery", "delivered"].includes(order.status);
  const msg = packedReady ? formatPickupReadyMessage(order) : formatPickupAssignedMessage(order);
  if (!msg) return;

  try {
    await sendText(order.customerKey, msg);
    if (packedReady) {
      updateOrderMeta(order.id, { customerPickupNotifiedAt: Date.now() });
    }
  } catch (err) {
    console.error("[fulfillment] pickup notify failed:", err.message);
  }
}

async function notifyCustomerOfStatus(order) {
  const builder = CUSTOMER_STATUS_MESSAGES[order.status];
  if (!builder) return;
  try {
    await sendText(order.customerKey, builder(order));
    if (
      ["packed", "out_for_delivery"].includes(order.status) &&
      order.customerPaymentStatus !== "confirmed"
    ) {
      const reminder = formatShortPaymentReminder(order);
      if (reminder) await sendText(order.customerKey, reminder);
    }
    if (["packed", "out_for_delivery"].includes(order.status)) {
      await notifyCustomerPickupDetails(order);
    }
    if (order.status === "delivered") {
      await sendReviewPrompt(order.customerKey, order);
    }
  } catch (err) {
    console.error("[admin] failed to notify customer of status:", err.message);
  }
}

const QUICK_STATUS_WORDS = new Set(["confirmed", "packed", "out_for_delivery", "delivered", "cancelled"]);

/** Status keywords admins sometimes type in a customer chat (e.g. "confirmed"). */
export function isAdminQuickStatusText(text) {
  const status = normalizeStatus(String(text || "").trim());
  return Boolean(status && QUICK_STATUS_WORDS.has(status));
}

async function tryQuickStatusOnCustomerReply({ fromChatId, toChatId, text, quotedText, fromPhone, allowBusinessOwner }) {
  if (!toChatId || isBusinessChat(toChatId)) return false;
  if (!isAdminQuickStatusText(text)) return false;
  if (!canRunAdminCommands(fromChatId, fromPhone, { allowBusinessOwner })) return false;

  const statusInput = String(text || "").trim();
  let orderId = extractOrderIdFromText(quotedText || "");
  if (!orderId) {
    const customerKey = customerKeyFromChatId(toChatId);
    const orders = getOrdersForCustomer(customerKey);
    const active = orders.find((o) => !["delivered", "cancelled"].includes(o.status));
    orderId = active?.id;
  }
  if (!orderId) {
    console.warn("[admin:quick-status] no order for", toChatId, statusInput);
    return false;
  }

  const replyTo = fromChatId || config.admin.primary;
  await handleStatusCommand(replyTo, `${orderId} ${statusInput}`);
  console.log("[admin:quick-status]", orderId, statusInput, "→", toChatId);
  return true;
}

export function adminHelpText() {
  return (
    `🛠️ *Sokoni admin commands*\n\n` +
    `Type *admin* or *#help* anytime for this menu.\n` +
    `Customers: *menu* · Suppliers: *vendor menu*\n` +
    `_IDs: *SKN-####* / *SKN-####-n* (cart) · older *SK-####* still works_\n\n` +
    `📋 *#orders* — recent orders\n` +
    `💰 *#payments* — unpaid prepaid orders (or manual *paid* claims)\n` +
    `✅ *#payconfirm SKN-1002-1* — manual payment verify (Daraja auto-confirms when live)\n` +
    `📦 *#notify-store SKN-1002-1* — tell store/pickup point to release parcel\n` +
    `📍 *#pickup SKN-1002-1 pp-xxxx* — assign / override pickup point\n` +
    `🔎 *#nearby SKN-1002-1* — suggest pickup partners near customer\n` +
    `📦 *#scan SKN-1002-1* — hub drop-off scan (advances shipment status)\n` +
    `   _Or #scan SKN-1002-1 in_transit hub:Umoja · #scan SK-1042 delivered_\n` +
    `🔄 *#status SKN-1002-1 delivered* — update status + notify customer\n` +
    `   _(or *#SKN-1002-1 confirmed* — same as #status)_\n\n` +
    `🙏 *Customer issue commands*\n` +
    `• *#apolog SKN-1002-1* — wrong-item apology (customer replies REPLACE/CANCEL)\n` +
    `• *#wrong SKN-1002-1 ordered:sandals received:perfume* — same as #apolog with details\n` +
    `• *#damage SKN-1002-1* — damaged/wrong variant return at door\n` +
    `• *#recover SKN-1002-1* — post-delivery damage (ask for photo)\n` +
    `• *#delay SKN-1002-1 later today* — delivery delay apology\n` +
    `• *#oos SKN-1002-1* — out of stock → cancel + notify customer\n` +
    `• *#transit SKN-1002-1 rider:John phone:0712… eta:2 hours* — rider on the way alert\n\n` +
    `📦 *#fulfill SKN-1002-1* — notify supplier (no customer contact)\n` +
    `📦 *#fulfill SKN-1002-1 share* — supplier delivers (with address)\n` +
    `💰 *#payouts* — supplier amounts owed / B2C status\n` +
    `💸 *#payb2c SKN-1002-1* — send seller payout via M-Pesa B2C\n` +
    `✅ *#paid SKN-1002-1* — mark supplier paid (manual transfer)\n` +
    `✅ *#paid WD-2026-0004* — mark a queued withdrawal paid (all its orders)\n` +
    `🖥️ *Command Center* — sokonimall.com/admin-command.html (escrow tank, disputes, hub stats)\n\n` +
    `📣 *Customer comms & offers*\n` +
    `• *#broadcast <message>* — message all customers (adds ${OFFER_PERCENT}% offer footer + STOP opt-out)\n` +
    `• Promo code *${PROMO_CODE}* (${OFFER_PERCENT}% off) — customers say *discount* or *punguza bei*\n` +
    `• Auto-replies: *referral*, *scam*, *survey*, *vendor*, *gift wrap*, *weekend delivery*, etc.\n` +
    `• Customers opt out of broadcasts: *STOP* · opt back in: *START*\n\n` +
    `🆔 *#SKN-1002-1 <message>* — message buyer/seller (starts ADMIN_TAKE_OVER / silent bot)\n` +
    `✅ *#done SKN-1002-1* — end dispute/help takeover, resume bot\n` +
    `   _(alias: *#resolve SKN-1002-1* · or *#done* alone if only one open thread)_\n` +
    `   _(buyer/seller can also reply *DONE* on WhatsApp)_\n` +
    `🖥️ Support ops desk — https://sokonimall.com/admin-support.html (inbox + all #commands)\n` +
    `🏪 Seller listings — https://sokonimall.com/admin-seller-listings.html?token=...\n` +
    `🏪 Sellers & Shops desk — https://sokonimall.com/admin-sellers-shops.html?token=...\n` +
    `   · GET /admin/suppliers/shops-desk?q=&status=\n` +
    `   · GET /admin/suppliers/shops/:id/items\n` +
    `   · POST …/shops/:id/{freeze|verify|commission|payout-hold|handle|edit}\n` +
    `   · GET /admin/suppliers/seller-listings/flagged?token=...\n` +
    `   · POST …/seller-listings/:productId/takedown?token=…\n` +
    `   · POST …/seller-listings/:productId/restore?token=…\n\n` +
    `🛠️ *Platform ops (Phase 9)*\n` +
    `• *#ops* — catalog pause/live, DB, flags\n` +
    `• *#catalog live* · *#catalog pause* · *#sync* · *#sync push*\n` +
    `• *#stock prod_abc in|out* · *#flags prepaid on|off*\n` +
    `• *#db migrate* · *#db seed* · REST \`/admin/ops/status?token=...\`\n\n` +
    `⚡ *Master palette* (ADMIN_PHONES / MASTER_ADMIN_SECRET)\n` +
    `• *!force-release SKN-####* · *!override-state SKN-#### STATUS*\n` +
    `• *!ban-user / !unban-user +254…* · *!agent-mode MUTE|ACTIVE +254…*\n` +
    `• *!system-pause* / *!system-resume* · *OVERRIDE: …* · *!help*\n\n` +
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
    const fulfill =
      o.deliveryMode === "pickup_point" && o.pickupPointName
        ? ` · 📍 ${o.pickupPointName}`
        : o.deliveryMode === "home_delivery"
          ? " · 🛵 delivery"
          : " · ⏳ assign";
    return (
      `*${o.id}* · ${statusLabel(o.status)}${sup}${fulfill}\n` +
      `${o.productName} — KES ${o.priceKes.toLocaleString()}${margin}\n` +
      `${o.customerName} · ${o.phone} · ${o.location}`
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
      `Usage: #status SKN-1002-1 out\n\nStatuses: ${ORDER_STATUSES.join(", ")}`
    );
  }
  const order = getOrder(orderId);
  if (!order) {
    return sendText(adminChatId, `⚠️ Order *${orderId}* not found. Try #orders.`);
  }
  const next = normalizeStatus(statusInput);
  if (
    next &&
    ["confirmed", "packed", "out_for_delivery", "delivered"].includes(next) &&
    !canFulfillOrder(order)
  ) {
    return sendText(
      adminChatId,
      `⚠️ *${order.id}* — payment not confirmed. Run #payconfirm ${order.id} first.`
    );
  }
  const result = updateOrderStatus(orderId, statusInput);
  if (!result) {
    return sendText(adminChatId, `⚠️ Order *${orderId}* not found. Try #orders.`);
  }
  if (result.error === "invalid_status") {
    return sendText(adminChatId, `⚠️ Unknown status. Use: ${ORDER_STATUSES.join(", ")}`);
  }
  if (result.unchanged) {
    return sendText(
      adminChatId,
      `ℹ️ *${result.order.id}* is already ${statusLabel(result.status)}. Customer was not re-notified.`
    );
  }
  await notifyCustomerOfStatus(result.order);
  if (result.status === "delivered") {
    advanceShipmentStatus(result.order.id, "delivered", { actor: "admin_status", note: "#status delivered" });
    onOrderDelivered(getOrder(result.order.id) || result.order);
  }
  const holdDays = Number(config.mpesa?.escrowHoldBusinessDays);
  const payoutNote =
    result.status === "delivered" && result.order.sourcePriceKes
      ? holdDays > 0
        ? `\nSeller payout scheduled (${holdDays} business day hold). Check #payouts.`
        : `\nSeller wallet credited → Ready for M-Pesa. Check #payouts.`
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
    return sendText(adminChatId, "Usage: #fulfill SKN-1002-1\nOr: #fulfill SK-1042 share (includes customer address)");
  }
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  if (!canFulfillOrder(order)) {
    return sendText(
      adminChatId,
      `⚠️ *${order.id}* — customer has not paid yet.\nRun #payconfirm ${order.id} after verifying M-Pesa, then #fulfill.`
    );
  }

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
  const b2c = b2cMeta();
  const b2cLine = b2c.ready
    ? `B2C: ready · ${b2c.auto ? "auto after hold" : "manual #payb2c"} · shortcode ${b2c.shortcode}`
    : "B2C: not configured (set MPESA_INITIATOR_NAME + SECURITY_CREDENTIAL)";

  const parts = [`💰 *Supplier payouts*\n${b2cLine}`];

  if (summary.scheduledCount > 0) {
    parts.push(`⏳ Scheduled (escrow hold): ${summary.scheduledCount} · KES ${summary.totalScheduledKes.toLocaleString()}`);
  }
  if (summary.disbursingCount > 0) {
    const lines = (summary.disbursing || []).slice(0, 5).map(
      (e) => `*${e.orderId}* · KES ${e.payoutAmountKes.toLocaleString()} · waiting M-Pesa result`
    );
    parts.push(`📤 Disbursing (${summary.disbursingCount})\n${lines.join("\n")}`);
  }
  if (summary.failedCount > 0) {
    const lines = (summary.failed || []).slice(0, 5).map(
      (e) =>
        `*${e.orderId}* · KES ${e.payoutAmountKes.toLocaleString()}\n` +
        `${e.b2c?.resultDesc || e.b2c?.lastMessage || "failed"} · #payb2c ${e.orderId}`
    );
    parts.push(`⚠️ B2C failed (${summary.failedCount})\n${lines.join("\n\n")}`);
  }

  if (summary.queuedCount > 0) {
    const lines = (summary.queued || []).slice(0, 8).map(
      (e) =>
        `*${e.orderId}* · ${e.supplierName}\n` +
        `KES ${e.payoutAmountKes.toLocaleString()} · ${e.withdrawId || "queued"}\n` +
        `#paid ${e.withdrawId || e.orderId}`
    );
    parts.push(
      `🕐 Admin queue (send M-Pesa by hand): ${summary.queuedCount} · KES ${(summary.totalQueuedKes || 0).toLocaleString()}\n\n${lines.join("\n\n")}`
    );
  }
  if (summary.count === 0 && summary.disbursingCount === 0 && summary.failedCount === 0 && !summary.queuedCount) {
    parts.push("No supplier payouts owed right now.");
    return sendText(adminChatId, parts.join("\n\n"));
  }

  if (summary.count > 0) {
    const lines = summary.entries.slice(0, 10).map(
      (e) =>
        `*${e.orderId}* · ${e.supplierName}\n` +
        `Pay: KES ${e.payoutAmountKes.toLocaleString()} · ${e.productName}\n` +
        (b2c.ready ? `#payb2c ${e.orderId}` : `#paid ${e.orderId} when sent`)
    );
    parts.push(
      `🟢 Owed: KES ${summary.totalOwedKes.toLocaleString()} (${summary.count})\n\n${lines.join("\n\n")}`
    );
  }

  return sendText(adminChatId, parts.join("\n\n"));
}

async function handlePayB2CCommand(adminChatId, orderId) {
  if (!orderId) return sendText(adminChatId, "Usage: #payb2c SKN-1002-1");
  if (!isB2CReady()) {
    return sendText(
      adminChatId,
      "⚠️ B2C not configured. Set MPESA_INITIATOR_NAME + MPESA_SECURITY_CREDENTIAL (or INITIATOR_PASSWORD + CERT_PATH) + MPESA_B2C_SHORTCODE, then restart the bot."
    );
  }
  const out = await initiateSettlementB2C(orderId);
  if (out.skipped) {
    return sendText(adminChatId, `ℹ️ *${orderId}* — ${out.message}`);
  }
  if (out.error) {
    return sendText(adminChatId, `⚠️ *${orderId}* — ${out.message || out.error}`);
  }
  const amt = out.entry?.payoutAmountKes;
  return sendText(
    adminChatId,
    `✅ B2C submitted for *${orderId}*${amt != null ? ` · KES ${Number(amt).toLocaleString()}` : ""}.\nWaiting for Safaricom ResultURL — check #payouts.`
  );
}

async function handlePaymentsCommand(adminChatId) {
  if (isDarajaConfigured()) {
    const awaiting = listRecentOrders(50).filter(
      (o) => o.status === "awaiting_payment" && o.customerPaymentStatus !== "confirmed"
    );
    if (awaiting.length === 0) {
      return sendText(
        adminChatId,
        "💰 No unpaid prepaid orders. Daraja STK auto-confirms payment — no #payconfirm needed."
      );
    }
    const lines = awaiting.slice(0, 10).map(
      (o) => `*${o.id}* · KES ${o.priceKes.toLocaleString()} · ${o.customerName} · STK ${o.paymentStatus || "pending"}`
    );
    return sendText(
      adminChatId,
      `💰 *Awaiting M-Pesa (${awaiting.length})*\n\n${lines.join("\n")}\n\nPayments confirm automatically via Daraja callback.`
    );
  }

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
  if (!orderId) return sendText(adminChatId, "Usage: #payconfirm SKN-1002-1");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  if (order.customerPaymentStatus === "confirmed") {
    return sendText(adminChatId, `ℹ️ *${order.id}* is already paid.`);
  }

  const result = await applyPostPaymentAutomation(order, {
    mpesaReceiptNumber: "manual-admin",
    phoneNumber: order.phone,
    amount: orderBuyerTotal(order),
  });

  if (result?.skipped) {
    return sendText(adminChatId, `ℹ️ *${order.id}* already paid.`);
  }

  const note = isDarajaConfigured()
    ? "Manual fallback — Daraja normally auto-confirms."
    : "Manual till verify — set MPESA_* for auto STK.";

  return sendText(
    adminChatId,
    `✅ Payment confirmed for *${order.id}* · KES ${orderBuyerTotal(order).toLocaleString()} · escrow held\nCustomer + seller notified.\n\n${note}\n\nNext: #notify-store ${order.id} or #fulfill ${order.id}`
  );
}

async function handleScanCommand(adminChatId, args) {
  const orderId = extractOrderIdFromText(args);
  if (!orderId) {
    return sendText(
      adminChatId,
      "Usage: #scan SKN-1002-1\nOr: #scan SKN-1002-1 in_transit hub:Umoja\nOr: #scan SK-1042 delivered"
    );
  }

  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const tail = args.replace(ORDER_ID_RE, "").trim();
  const forceMatch = tail.match(/\b(label_ready|dropped_off|in_transit|at_pickup_point|delivered)\b/i);
  const hubMatch = tail.match(/\bhub:(\S+)/i);
  const courierMatch = tail.match(/\bcourier:(\S+)/i);

  const result = forceMatch
    ? advanceShipmentStatus(orderId, forceMatch[1].toLowerCase(), {
        hubName: hubMatch?.[1]?.replace(/_/g, " "),
        courierName: courierMatch?.[1]?.replace(/_/g, " "),
        actor: "admin_scan",
      })
    : scanShipmentAtHub(orderId, {
        hubName: hubMatch?.[1]?.replace(/_/g, " "),
        courierName: courierMatch?.[1]?.replace(/_/g, " "),
        actor: "admin_scan",
      });

  if (result.error === "no_next_status") {
    return sendText(adminChatId, `ℹ️ *${orderId}* shipment already at final step (${order.shipmentStatus}).`);
  }
  if (result.error) {
    return sendText(adminChatId, `⚠️ Scan failed: ${result.error}`);
  }

  const tracking = buildPublicTrackingPayload(result.order);

  return sendText(
    adminChatId,
    `✅ *${orderId}* → ${tracking.shipmentStatusLabel}\nCustomer notified.\n\n` +
      `${tracking.shipmentTimeline.map((s) => `${s.done ? "✅" : s.active ? "🔵" : "⚪"} ${s.label}`).join("\n")}`
  );
}

function renderShipmentTimelineFromPayload(tracking) {
  return (tracking.shipmentTimeline || [])
    .map((s) => `${s.done ? "✅" : s.active ? "🔵" : "⚪"} ${s.label}`)
    .join("\n");
}

async function handleNotifyStoreCommand(adminChatId, orderId) {
  if (!orderId) return sendText(adminChatId, "Usage: #notify-store SKN-1002-1");
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

async function handleNearbyCommand(adminChatId, orderId) {
  if (!orderId) return sendText(adminChatId, "Usage: #nearby SKN-1002-1");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const suggestions = rankPickupPointsForLocation(order.location, 5);
  if (!suggestions.length) {
    return sendText(
      adminChatId,
      `🔎 No pickup partners match *${order.location}* yet.\n\nApprove more partners or use home delivery / #fulfill.`
    );
  }

  const lines = suggestions.map(
    (s, i) =>
      `${i + 1}. *${s.point.shopName}* (${s.point.id})\n   ${s.point.city}, ${s.point.county} · score ${s.score}\n   #pickup ${order.id} ${s.point.id}`
  );
  return sendText(
    adminChatId,
    `🔎 *Pickup partners near ${order.location}*\n\n${lines.join("\n\n")}`
  );
}

async function handleAssignPickupCommand(adminChatId, args) {
  const parts = args.trim().split(/\s+/);
  const orderId = parts[0];
  const pointId = parts[1];
  if (!orderId || !pointId) {
    return sendText(adminChatId, "Usage: #pickup SKN-1002-1 pp-xxxx");
  }
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const point = getPickupPoint(pointId);
  if (!point) return sendText(adminChatId, `⚠️ Pickup point *${pointId}* not found.`);

  updateOrderMeta(order.id, pickupMetaFromPoint(point));
  const fresh = getOrder(order.id);

  try {
    await notifyCustomerPickupDetails(fresh, { force: true });
  } catch (err) {
    console.warn("[admin] pickup assign customer notify failed:", err.message);
  }

  return sendText(
    adminChatId,
    `✅ *${order.id}* assigned to pickup point *${point.shopName}* (${point.id})\n+${point.phone} · ${point.city}\nCustomer notified.`
  );
}

async function handlePaidCommand(adminChatId, orderId) {
  if (!orderId) return sendText(adminChatId, "Usage: #paid SKN-1002-1  or  #paid WD-2026-0004");
  const id = String(orderId || "").trim();
  if (/^WD-\d{4}-\d+/i.test(id)) {
    const out = markWithdrawalPaid(id);
    if (out.error === "not_found") return sendText(adminChatId, `⚠️ ${out.message}`);
    if (out.skipped) return sendText(adminChatId, `ℹ️ *${out.request.id}* — ${out.message}`);
    const req = out.request;
    await notifySellerWithdrawalPaid(req);
    return sendText(
      adminChatId,
      `✅ Marked *${req.id}* paid — KES ${req.amountKes.toLocaleString()} to ${req.mpesaNumber}.\n` +
        `Orders: ${(req.orderIds || []).join(", ")}`
    );
  }
  const entry = markPayoutPaid(id);
  if (!entry) return sendText(adminChatId, `⚠️ No owed / queued payout for *${id}*.`);
  updateOrderMeta(id, { payoutStatus: "paid", isPaidOut: true, paidOutAt: Date.now(), payoutRail: "admin" });
  const done = markWithdrawalPaidByOrderId(id);
  if (done?.ok && done.request) await notifySellerWithdrawalPaid(done.request);
  return sendText(
    adminChatId,
    `✅ Marked *${entry.orderId}* paid — KES ${entry.payoutAmountKes.toLocaleString()} to ${entry.supplierName}.` +
      (done?.ok ? `\nWithdrawal *${done.request.id}* closed.` : "")
  );
}

async function notifySellerWithdrawalPaid(request) {
  try {
    const supplier = getSupplier(request.supplierId);
    const phone = supplier?.phone || request.phone;
    if (!phone) return;
    const { toChatId } = await import("./whatsapp.js");
    await sendText(
      toChatId(phone),
      `✅ Withdrawal *${request.id}* paid — KES ${Number(request.amountKes || 0).toLocaleString()} sent to your M-Pesa.`
    );
  } catch (err) {
    console.warn("[admin] seller withdraw notify failed:", err?.message || err);
  }
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
    if (isBroadcastOptedOut(contact.customerKey)) continue;
    try {
      await sendText(contact.customerKey, `📣 *Sokoni Mall*\n\n${text}${broadcastFooter()}`);
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
  const embedded = t.match(
    /(?:^|\n)\s*#(?:help|orders|status|broadcast|fulfill|payouts|paid|payments|payconfirm|notify-store|pickup|nearby|scan|ops|sync|catalog|stock|flags|db|resolve|done)\b[\s\S]*/i
  );
  if (embedded) return embedded[0].trim();
  const sk = t.match(new RegExp(`#${ORDER_ID_CAPTURE}\\s+[\\s\\S]+`, "i"));
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
    const body = `🛡️ *[Sokoni Support]:* ${message.trim()}`;
    const {
      recordAdminOutbound,
      notifyOrderParties,
      getOrderPartyChats,
    } = await import("./communication-hub.js");
    const parties = await getOrderPartyChats(order);
    await notifyOrderParties(order, {
      buyerMessage: parties.buyer.length ? body : null,
      sellerMessage: parties.seller.length ? body : null,
    });
    if (order.customerKey) {
      setHumanHandoff(order.customerKey, {
        adminDirect: true,
        adminTakeOver: true,
        orderId: order.id,
        startedAt: Date.now(),
        ackSent: true,
      });
    }
    recordAdminOutbound(order.id, message.trim(), { setTakeOver: true });
    if (order.status === "delivered" && !order.reviewPromptSent && order.customerKey) {
      await sendReviewPrompt(order.customerKey, order);
    }
    const who = [
      parties.buyer.length ? "buyer" : null,
      parties.seller.length ? "seller" : null,
    ]
      .filter(Boolean)
      .join(" + ");
    return sendText(
      adminChatId,
      `✅ Sent to *${who || "no chats"}* (${order.id}). Bot is silent on those chats.\nEnd: *#done ${order.id}*`
    );
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed to send: ${err.message}`);
  }
}

function listOpenTakeOverOrders(limit = 20) {
  return listRecentOrders(200)
    .filter((o) => o?.adminTakeOver || o?.supportStatus === "ADMIN_TAKE_OVER")
    .slice(0, limit);
}

/**
 * Admin ends HELP/dispute takeover and resumes the bot.
 * Accepts: #done SK-1042 · #resolve SK-1042 · #done (if exactly one open thread)
 */
async function handleResolveSupportCommand(adminChatId, rest, { via = "done" } = {}) {
  const raw = String(rest || "").trim();
  let orderId = extractOrderIdFromText(raw);
  if (!orderId && !raw) {
    const open = listOpenTakeOverOrders();
    if (open.length === 1) {
      orderId = open[0].id;
    } else if (open.length === 0) {
      return sendText(adminChatId, "No open support/dispute takeovers. Usage: *#done SKN-1002-1* (or older *#done SK-1042*)");
    } else {
      const lines = open.slice(0, 10).map((o) => `• *#done ${o.id}* — ${o.productName || "order"}`);
      return sendText(
        adminChatId,
        `Several takeovers are open — pick one:\n${lines.join("\n")}` +
          (open.length > 10 ? `\n…+${open.length - 10} more` : "")
      );
    }
  } else if (!orderId) {
    return sendText(adminChatId, "Usage: *#done SKN-1002-1* (or *#resolve SK-1042*)");
  }

  const { resolveAdminTakeOver } = await import("./communication-hub.js");
  const result = await resolveAdminTakeOver(orderId, { note: `resolved via #${via}` });
  if (result.error) {
    return sendText(adminChatId, `⚠️ ${result.message || result.error}`);
  }
  const hold = result.order?.disputeHold
    ? "\n⚠️ Escrow still on dispute hold until the in-app dispute is resolved."
    : "";
  return sendText(adminChatId, `✅ Support closed for *${orderId}*. Bot resumed.${hold}`);
}

/**
 * Admin chat id used when the support dashboard runs #commands
 * (must match ADMIN_PHONES so canRunAdminCommands passes).
 */
export function dashboardAdminChatId() {
  const phone = config.admin.phones[0] || config.admin.primary;
  if (!phone) return "";
  return toChatId(phone);
}

/**
 * Run the same WhatsApp admin #command path from the web desk.
 * Captures admin reply texts (does not ping admin WA); customer/seller sends still go out.
 */
export async function executeAdminCommandFromDashboard(text, quotedText = "") {
  const adminChatId = dashboardAdminChatId() || "dashboard-admin@c.us";
  const cmd = String(text || "").trim();
  if (!cmd) {
    return { ok: false, error: "missing_command", message: "Enter a #command.", replies: [] };
  }
  // REST route is already gated by X-Admin-Token — do not re-require ADMIN_PHONES match.
  let handled = false;
  const replies = await withAdminReplyCapture(adminChatId, async () => {
    handled = await runAdminCommand(adminChatId, cmd, quotedText, {
      allowBusinessOwner: false,
      skipSenderAuth: true,
    });
  });
  if (!handled) {
    return {
      ok: false,
      error: "unhandled",
      message: "Command was not handled.",
      replies,
    };
  }
  return { ok: true, command: cmd, replies };
}

/** Parse and run an admin command. Returns true if handled. */
export async function runAdminCommand(
  adminChatId,
  text,
  quotedText,
  { allowBusinessOwner = false, skipSenderAuth = false } = {}
) {
  const phone = phoneDigitsFromChatId(adminChatId) || "";
  if (!skipSenderAuth && !canRunAdminCommands(adminChatId, phone, { allowBusinessOwner })) {
    return false;
  }
  const t = normalizeAdminCommand(text.trim());

  if (
    /^\s*OVERRIDE\s*:/i.test(t) ||
    /^\s*OVERRIDE\s*:/i.test(text) ||
    /^\s*![a-z][\w-]*/i.test(t) ||
    /^\s*![a-z][\w-]*/i.test(text) ||
    /^\s*FORCE_PAYOUT\b/i.test(t) ||
    /^\s*FORCE_PAYOUT\b/i.test(text)
  ) {
    const { executeMasterAdminCommand } = await import("./admin-override.js");
    const result = await executeMasterAdminCommand(text, {
      adminLabel: phone || phoneDigitsFromChatId(adminChatId) || "boss",
      actorPhone: phone || phoneDigitsFromChatId(adminChatId) || "",
    });
    await sendText(adminChatId, result.reply || "Override processed.");
    return true;
  }

  if (/^admin\b/i.test(t) || /^#help\b/i.test(t)) {
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
  if (/^#payb2c\b/i.test(t)) {
    const oid = t.replace(/^#payb2c\b/i, "").trim().split(/\s+/)[0];
    await handlePayB2CCommand(adminChatId, oid);
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
  if (/^#nearby\b/i.test(t)) {
    const oid = t.replace(/^#nearby\b/i, "").trim().split(/\s+/)[0];
    await handleNearbyCommand(adminChatId, oid);
    return true;
  }
  if (/^#paid\b/i.test(t)) {
    const oid = t.replace(/^#paid\b/i, "").trim().split(/\s+/)[0];
    await handlePaidCommand(adminChatId, oid);
    return true;
  }
  if (/^#(apolog|wrong)\b/i.test(t)) {
    await handleApologCommand(adminChatId, t.replace(/^#(apolog|wrong)\b/i, ""));
    return true;
  }
  if (/^#damage\b/i.test(t)) {
    await handleDamageCommand(adminChatId, t.replace(/^#damage\b/i, ""));
    return true;
  }
  if (/^#recover\b/i.test(t)) {
    await handleRecoverCommand(adminChatId, t.replace(/^#recover\b/i, ""));
    return true;
  }
  if (/^#delay\b/i.test(t)) {
    await handleDelayCommand(adminChatId, t.replace(/^#delay\b/i, ""));
    return true;
  }
  if (/^#oos\b/i.test(t)) {
    await handleOosCommand(adminChatId, t.replace(/^#oos\b/i, ""));
    return true;
  }
  if (/^#transit\b/i.test(t)) {
    await handleTransitCommand(adminChatId, t.replace(/^#transit\b/i, ""));
    return true;
  }
  if (/^#scan\b/i.test(t)) {
    await handleScanCommand(adminChatId, t.replace(/^#scan\b/i, ""));
    return true;
  }
  if (/^#ops\b/i.test(t)) {
    await handleOpsCommand(adminChatId);
    return true;
  }
  if (/^#sync\b/i.test(t)) {
    await handleSyncCommand(adminChatId, t.replace(/^#sync\b/i, ""));
    return true;
  }
  if (/^#catalog\b/i.test(t)) {
    await handleCatalogCommand(adminChatId, t.replace(/^#catalog\b/i, ""));
    return true;
  }
  if (/^#stock\b/i.test(t)) {
    await handleStockCommand(adminChatId, t.replace(/^#stock\b/i, ""));
    return true;
  }
  if (/^#flags\b/i.test(t)) {
    await handleFlagsCommand(adminChatId, t.replace(/^#flags\b/i, ""));
    return true;
  }
  if (/^#db\b/i.test(t)) {
    await handleDbOpsCommand(adminChatId, t.replace(/^#db\b/i, ""));
    return true;
  }

  if (/^#(?:done|resolve)\b/i.test(t)) {
    const via = /^#done\b/i.test(t) ? "done" : "resolve";
    await handleResolveSupportCommand(adminChatId, t.replace(/^#(?:done|resolve)\b/i, ""), { via });
    return true;
  }

  const targeted = t.match(new RegExp(`^#${ORDER_ID_CAPTURE}\\s+([\\s\\S]+)`, "i"));
  if (targeted) {
    const orderId = normalizeOrderId(targeted[1]);
    const msg = targeted[2].trim();
    if (isAdminQuickStatusText(msg)) {
      await handleStatusCommand(adminChatId, `${orderId} ${msg}`);
      return true;
    }
    await handleTargetedOrderMessage(adminChatId, orderId, msg);
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
    // Staff table may have roles not in ADMIN_PHONES — allow if resolveStaffRole hits
    try {
      const { resolveStaffRole } = await import("./staff-roles.js");
      const staff = await resolveStaffRole(phone || phoneDigitsFromChatId(customerKey));
      if (!staff) {
        console.warn("[admin] blocked incoming admin attempt", customerKey, phone);
        return false;
      }
    } catch {
      console.warn("[admin] blocked incoming admin attempt", customerKey, phone);
      return false;
    }
  }

  // Numbered dispute action card (1–4)
  try {
    const { tryHandleDisputeAdminChoice } = await import("./dispute-admin-actions.js");
    const choice = await tryHandleDisputeAdminChoice(customerKey, text, { phone });
    if (choice.handled) {
      if (choice.reply) await sendText(customerKey, choice.reply);
      return true;
    }
  } catch (err) {
    console.warn("[admin] dispute card choice skipped:", err.message);
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
export async function handleAdminOutgoing({ fromChatId, toChatId, text, quotedText, messageId = null }) {
  console.log("[admin:outgoing]", {
    to: toChatId,
    text: text?.slice(0, 60),
    quoted: quotedText?.slice(0, 80),
  });

  // Bot API sends also arrive as fromMe — never treat those as human handoff.
  if (isBotEcho(messageId, toChatId) || wasRecentBotSend(toChatId)) {
    return false;
  }

  const fromPhone = phoneDigitsFromChatId(fromChatId);
  const allowBusinessOwner = isBusinessOwnerSender(fromChatId);
  const adminCommand =
    canRunAdminCommands(fromChatId, fromPhone, { allowBusinessOwner }) &&
    isAdminRelayAttempt(normalizeAdminCommand(text));

  if (adminCommand) {
    const replyTo = allowBusinessOwner ? fromChatId || config.admin.primary : fromChatId || config.admin.primary;
    return runAdminCommand(replyTo, text, quotedText, { allowBusinessOwner });
  }

  if (
    await tryQuickStatusOnCustomerReply({
      fromChatId,
      toChatId,
      text,
      quotedText,
      fromPhone,
      allowBusinessOwner,
    })
  ) {
    return true;
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
    // WAHA / Baileys LID → PN hints
    payload._data?.senderPn,
    payload._data?.sender_pn,
    payload._data?.remoteJidAlt,
    payload._data?.remote_jid_alt,
    payload.senderPn,
    payload.remoteJidAlt,
    payload._data?.peerRecipientPn,
    payload._data?.recipientPn,
    typeof payload._data?.senderPn === "object" ? payload._data?.senderPn?.user : null,
  ];
  if (!phone) {
    for (const c of candidates) {
      const raw = typeof c === "string" ? c : c?.user || c?.id || "";
      const d = digitsOnly(String(raw).replace(/@.*/g, ""));
      if (d.length >= 9) {
        phone = d;
        break;
      }
    }
  }
  // Last resort when WAHA hid the PN behind @lid: scan payload for Boss last-9
  if (!phone) {
    const scanned = extractBossPhoneFromPayload(payload);
    if (scanned) phone = scanned;
  }
  if (phone) phone = normalizeKenyaPhone(phone) || phone;
  return { chatId, displayName: displayName.trim(), phone };
}
