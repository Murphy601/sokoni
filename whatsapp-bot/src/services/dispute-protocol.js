/**
 * Deterministic fulfillment dispute protocol.
 * Does NOT rely on the LLM — freezes payout, opens DB ticket, alerts seller/admin,
 * and returns the structured buyer follow-up text.
 *
 * Conversation state (AWAITING_DISPUTE_EVIDENCE) is stored in session meta AND
 * mirrored to disk so pm2 restarts / @lid↔@c.us key flips do not send the next
 * photo into visual catalog search.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractOrderIdFromText, getOrder, getOrdersForCustomer } from "./orders.js";
import { openBuyerReturnCase } from "./communication-hub.js";
import { getCustomerMeta, setCustomerMeta, getHumanHandoff } from "./session.js";
import { CATALOG_IMAGES_DIR } from "../lib/catalog-images.js";
import { config } from "../config.js";

const COMPLAINT_RE =
  /\b(refund|damaged|damage|return|money back|wrong item|wrong order|broken|scam|not as described|fake|counterfeit|defective|cracked|torn|missing|not received|never (arrived|received)|didn'?t (arrive|receive)|haijafika|haikufika|imepotea|sivyo)\b/i;

const AWAITING_TTL_MS = 48 * 60 * 60 * 1000;

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const DISPUTE_SESSION_FILE = path.join(DATA_DIR, "dispute-evidence-sessions.json");

/** @type {Record<string, { orderId?: string|null, disputeId?: number|null, at: number, phone?: string }>} */
let diskSessions = {};
let diskLoaded = false;

function loadDiskSessions() {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    if (!existsSync(DISPUTE_SESSION_FILE)) return;
    const raw = JSON.parse(readFileSync(DISPUTE_SESSION_FILE, "utf8"));
    diskSessions = raw && typeof raw === "object" ? raw : {};
    const now = Date.now();
    for (const [k, v] of Object.entries(diskSessions)) {
      if (!v?.at || now - v.at > AWAITING_TTL_MS) delete diskSessions[k];
    }
  } catch {
    diskSessions = {};
  }
}

function writeDiskSessions() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DISPUTE_SESSION_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(diskSessions, null, 2) + "\n");
    renameSync(tmp, DISPUTE_SESSION_FILE);
  } catch (err) {
    console.warn("[dispute-protocol] session persist failed:", err?.message || err);
  }
}

function phoneDigits(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function sessionKeys(customerKey, phone = "") {
  const keys = new Set();
  if (customerKey) keys.add(String(customerKey));
  const digits = phoneDigits(phone) || phoneDigits(customerKey);
  if (digits && digits.length >= 9) {
    keys.add(digits);
    keys.add(`${digits}@c.us`);
  }
  return [...keys];
}

/** True when the buyer is reporting a fulfillment issue (not seller-ops or policy Q). */
export function isFulfillmentComplaint(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (
    /\b(how (do|does|to)|what is|policy|explain|seller hub|register as|create (a )?listing)\b/i.test(t) &&
    !COMPLAINT_RE.test(t)
  ) {
    return false;
  }
  return COMPLAINT_RE.test(t);
}

/**
 * Pick the best order for an auto-dispute when the buyer omitted SKN-####.
 * Prefers paid / in-transit / delivered within ~21 days.
 */
export function resolveDisputeOrderCandidate({ phone = "", customerKey = "" } = {}) {
  const orders = getOrdersForCustomer(customerKey, phone).filter((o) => {
    if (o.status === "cancelled") return false;
    const paid = o.customerPaymentStatus === "confirmed" || o.paid || o.paymentStatus === "paid";
    return Boolean(paid);
  });

  if (!orders.length) return { orderId: null, candidates: [] };

  const now = Date.now();
  const WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
  const recent = orders.filter((o) => {
    const ts = Number(o.paidAt || o.dispatchedAt || o.createdAt || 0);
    return !ts || now - ts <= WINDOW_MS;
  });
  const pool = recent.length ? recent : orders;

  const rank = (o) => {
    const ship = String(o.shipmentStatus || "").toLowerCase();
    if (/delivered|received|arrived/.test(ship)) return 3;
    if (/dispatch|transit|out_for|rider/.test(ship)) return 2;
    if (/paid|confirmed|processing/.test(String(o.status || ""))) return 1;
    return 0;
  };

  const sorted = [...pool].sort((a, b) => rank(b) - rank(a) || (b.createdAt || 0) - (a.createdAt || 0));
  if (sorted.length === 1) {
    return { orderId: sorted[0].id, candidates: sorted.slice(0, 5) };
  }
  return { orderId: null, candidates: sorted.slice(0, 5) };
}

function formatNeedOrderIdMessage(candidates = []) {
  const lines = (candidates || []).map(
    (o) =>
      `• *${o.id}* — ${o.productName || "item"} · ${o.shipmentStatus || o.status || "paid"}`
  );
  if (lines.length) {
    return (
      `🚨 *Dispute help*\n\n` +
      `I can freeze the seller payout and open a ticket — reply with the order number for the damaged / wrong item:\n\n` +
      `${lines.join("\n")}\n\n` +
      `Example: *SKN-1234 arrived damaged*`
    );
  }
  return (
    `🚨 *Dispute help*\n\n` +
    `I couldn't find a paid order on this WhatsApp yet.\n` +
    `Reply with your *SKN-####* (or older *SK-####*) and what went wrong — e.g. *SKN-1234 wrong item*.\n` +
    `We'll freeze payout, alert the seller, and open a support ticket.`
  );
}

function orderLooksDisputed(order) {
  if (!order) return false;
  return Boolean(
    order.disputeHold ||
      order.adminTakeOver ||
      order.payoutStatus === "held_for_dispute" ||
      order.supportStatus === "ADMIN_TAKE_OVER"
  );
}

/**
 * Resolve whether this chat should treat inbound media as dispute evidence
 * (not catalog search). Checks memory → disk → handoff → disputed orders.
 */
export function resolveDisputeEvidenceContext(customerKey, phone = "") {
  loadDiskSessions();
  const meta = getCustomerMeta(customerKey) || {};
  const now = Date.now();

  const fromMeta =
    meta.awaitingDisputeEvidence || meta.awaitingDamagePhoto
      ? {
          awaiting: true,
          orderId: meta.disputeOrderId || meta.issueOrderId || null,
          disputeId: meta.disputeId != null ? Number(meta.disputeId) || null : null,
          source: "session",
        }
      : null;
  if (fromMeta) {
    const at = Number(meta.awaitingDisputeEvidenceAt || 0);
    if (at && now - at > AWAITING_TTL_MS) {
      clearAwaitingDisputeEvidence(customerKey, phone);
    } else {
      return fromMeta;
    }
  }

  for (const key of sessionKeys(customerKey, phone || meta.phone)) {
    const row = diskSessions[key];
    if (!row?.at || now - row.at > AWAITING_TTL_MS) continue;
    return {
      awaiting: true,
      orderId: row.orderId || null,
      disputeId: row.disputeId != null ? Number(row.disputeId) || null : null,
      source: "disk",
    };
  }

  const handoff = getHumanHandoff(customerKey);
  if (handoff?.orderId) {
    const order = getOrder(handoff.orderId);
    if (orderLooksDisputed(order) || handoff.adminTakeOver) {
      return {
        awaiting: true,
        orderId: handoff.orderId,
        disputeId: null,
        source: "handoff",
      };
    }
  }

  const disputed = getOrdersForCustomer(customerKey, phone || meta.phone)
    .filter((o) => orderLooksDisputed(o) && o.status !== "cancelled")
    .sort((a, b) => (b.disputeFrozenAt || b.adminFlaggedAt || b.createdAt || 0) - (a.disputeFrozenAt || a.adminFlaggedAt || a.createdAt || 0));
  if (disputed.length === 1) {
    return {
      awaiting: true,
      orderId: disputed[0].id,
      disputeId: null,
      source: "order_dispute_hold",
    };
  }
  if (disputed.length > 1) {
    return {
      awaiting: true,
      orderId: null,
      disputeId: null,
      candidates: disputed.slice(0, 5).map((o) => o.id),
      source: "order_dispute_hold_multi",
    };
  }

  return { awaiting: false, orderId: null, disputeId: null, source: null };
}

/** Mark chat as waiting for damage / wrong-item evidence (not catalog search). */
export function markAwaitingDisputeEvidence(customerKey, { orderId = null, disputeId = null, phone = "" } = {}) {
  if (!customerKey && !phone) return;
  const at = Date.now();
  const payload = {
    awaitingDisputeEvidence: true,
    awaitingDamagePhoto: true,
    disputeOrderId: orderId || null,
    issueOrderId: orderId || null,
    disputeId: disputeId != null ? Number(disputeId) || null : null,
    awaitingDisputeEvidenceAt: at,
  };
  if (customerKey) setCustomerMeta(customerKey, payload);

  loadDiskSessions();
  const row = {
    orderId: orderId || null,
    disputeId: disputeId != null ? Number(disputeId) || null : null,
    at,
    phone: phoneDigits(phone) || phoneDigits(getCustomerMeta(customerKey)?.phone) || null,
  };
  for (const key of sessionKeys(customerKey, phone || row.phone)) {
    diskSessions[key] = { ...row };
  }
  writeDiskSessions();
  console.log(
    `[dispute-protocol] state=AWAITING_DISPUTE_EVIDENCE order=${orderId || "(none)"} keys=${sessionKeys(customerKey, phone || row.phone).join(",")}`
  );
}

export function clearAwaitingDisputeEvidence(customerKey, phone = "") {
  if (customerKey) {
    setCustomerMeta(customerKey, {
      awaitingDisputeEvidence: false,
      awaitingDamagePhoto: false,
      disputeOrderId: null,
      issueOrderId: null,
      disputeId: null,
      awaitingDisputeEvidenceAt: null,
    });
  }
  loadDiskSessions();
  let changed = false;
  for (const key of sessionKeys(customerKey, phone || getCustomerMeta(customerKey)?.phone)) {
    if (diskSessions[key]) {
      delete diskSessions[key];
      changed = true;
    }
  }
  if (changed) writeDiskSessions();
}

export function isAwaitingDisputeEvidence(customerKey, phone = "") {
  return Boolean(resolveDisputeEvidenceContext(customerKey, phone).awaiting);
}

/** Hard gate used by image-search — never catalog-match dispute evidence. */
export function shouldBlockCatalogImageSearch(customerKey, phone = "", text = "") {
  if (resolveDisputeEvidenceContext(customerKey, phone).awaiting) return true;
  if (isFulfillmentComplaint(text)) return true;
  return false;
}

function extFromMime(mimetype = "") {
  const m = String(mimetype || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("mp4") || m.includes("video")) return "mp4";
  return "jpg";
}

async function hostEvidenceBuffer(buffer, { orderId = "unknown", mimetype = "image/jpeg" } = {}) {
  await mkdir(CATALOG_IMAGES_DIR, { recursive: true });
  const safeOrder = String(orderId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const file = `dispute_ev_${safeOrder}_${Date.now().toString(36)}.${extFromMime(mimetype)}`;
  await writeFile(path.join(CATALOG_IMAGES_DIR, file), buffer);
  const base = String(config.botPublicUrl || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/catalog-images/${encodeURIComponent(file)}`;
}

async function ensurePayoutFrozen(orderId) {
  const order = orderId ? getOrder(orderId) : null;
  if (!order) return { frozen: false, order: null };
  try {
    const { freezeOrderEscrow } = await import("./disputes.js");
    await freezeOrderEscrow(orderId);
  } catch {
    /* best-effort */
  }
  const { updateOrderMeta } = await import("./orders.js");
  updateOrderMeta(orderId, {
    disputeHold: true,
    escrowStatus: order.escrowStatus === "refunded" ? "refunded" : "held",
    payoutStatus: "held_for_dispute",
    disputeFrozenAt: order.disputeFrozenAt || Date.now(),
  });
  return { frozen: true, order: getOrder(orderId) || order };
}

/** Explicit seller WhatsApp alert — payout frozen (open or evidence). */
export async function sendSellerDisputeAlert(
  orderId,
  { evidenceUrl = null, disputeId = null, issueType = "damaged / wrong item" } = {}
) {
  let order = orderId ? getOrder(orderId) : null;
  if (!order) {
    console.error(`[Dispute Alert] Order ${orderId} not found — seller alert skipped`);
    return false;
  }
  const { sendTextReliable, toChatId } = await import("./whatsapp.js");
  const { getSupplier } = await import("./suppliers.js");
  const { sellerNotifyTargets, ensureOrderSupplier, getOrderPartyChats } = await import(
    "./communication-hub.js"
  );
  const { updateOrderMeta } = await import("./orders.js");

  try {
    order = (await ensureOrderSupplier(order)) || order;
  } catch {
    /* ignore */
  }

  // Product.sellerPhone is often present even when supplierId is missing.
  let productSellerPhone = order.sellerPhone || null;
  try {
    if (order.productId) {
      const { getProductById } = await import("./catalog.js");
      const product = await getProductById(order.productId);
      productSellerPhone =
        productSellerPhone || product?.sellerPhone || product?.seller?.phone || null;
      if (!order.supplierId && product?.supplierId) {
        updateOrderMeta(order.id, {
          supplierId: product.supplierId,
          sellerPhone: productSellerPhone || undefined,
        });
        order = getOrder(order.id) || order;
      } else if (productSellerPhone && !order.sellerPhone) {
        updateOrderMeta(order.id, { sellerPhone: productSellerPhone });
        order = getOrder(order.id) || order;
      }
    }
  } catch (err) {
    console.warn("[Dispute Alert] product seller phone lookup:", err.message);
  }

  const amount = Number(order.priceKes || order.buyerTotalKes || 0);
  const msg =
    `⚠️ *URGENT SOKONI MALL DISPUTE*\n\n` +
    `Buyer reported: *${String(issueType || "issue").toUpperCase()}*\n` +
    `• *Order:* *${order.id}*\n` +
    `• *Item:* ${order.productName || "item"}\n` +
    `• *Payout Status:* 🛑 FROZEN` +
    (amount ? ` (KES ${amount.toLocaleString()})` : "") +
    `\n` +
    (disputeId ? `• *Dispute:* #${disputeId}\n` : "") +
    (evidenceUrl ? `• *Evidence:* ${evidenceUrl}\n` : "") +
    `Please reply with dispatch proof within 24 hours (or open Seller Hub → Disputes).`;

  const targets = new Set();
  const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
  for (const phone of [
    supplier?.phone,
    supplier?.mpesaNumber,
    order.sellerPhone,
    productSellerPhone,
  ].filter(Boolean)) {
    for (const t of sellerNotifyTargets(phone)) targets.add(t);
    const chat = toChatId(phone);
    if (chat) targets.add(chat);
  }
  try {
    const parties = await getOrderPartyChats(order, {
      sellerUserId: order.sellerUserId || null,
    });
    for (const t of parties.seller || []) targets.add(t);
  } catch {
    /* ignore */
  }

  // Last resort: seller_user_id → users.phone
  if (!targets.size && order.sellerUserId) {
    try {
      const { isDbEnabled, query } = await import("../db/pool.js");
      if (isDbEnabled()) {
        const { rows } = await query(`SELECT phone FROM users WHERE id = $1 LIMIT 1`, [
          Number(order.sellerUserId),
        ]);
        const ph = rows[0]?.phone;
        if (ph) {
          for (const t of sellerNotifyTargets(ph)) targets.add(t);
          const chat = toChatId(ph);
          if (chat) targets.add(chat);
        }
      }
    } catch (err) {
      console.warn("[Dispute Alert] seller_user_id phone lookup:", err.message);
    }
  }

  if (!targets.size) {
    console.error(
      `[Dispute Alert] Missing seller phone/chat for Order ${order.id} ` +
        `(supplierId=${order.supplierId || "—"} product=${order.productId || "—"} sellerPhone=${productSellerPhone || "—"})`
    );
    return false;
  }

  console.log(`[Dispute Alert] seller targets for ${order.id}:`, [...targets].join(", "));

  let sent = false;
  for (const to of targets) {
    try {
      const result = await sendTextReliable(to, msg, { label: "Dispute Alert/Seller" });
      if (result?.ok) {
        console.log(`[Dispute Alert] Sent to Seller: ${result.chatId || to}`);
        sent = true;
      } else if (result?.dryRun) {
        console.error(`[Dispute Alert] DRY-RUN (not delivered) → ${to}`);
      }
    } catch (err) {
      console.warn(`[Dispute Alert] Seller send failed → ${to}:`, err.message);
    }
  }
  return sent;
}

/** Explicit admin WhatsApp alert (all ADMIN_PHONES + ADMIN_WHATSAPP_NUMBER). */
export async function sendAdminDisputeAlert(
  orderId,
  {
    evidenceUrl = null,
    disputeId = null,
    phone = "",
    attached = false,
    issueType = "dispute",
    opened = false,
  } = {}
) {
  const admins = [
    ...new Set(
      [...(config.admin.phones || []), config.admin.primary]
        .map((p) => String(p || "").replace(/\D/g, ""))
        .filter((p) => p.length >= 9)
    ),
  ];
  if (!admins.length) {
    console.warn(
      "[Dispute Alert] ADMIN_PHONES / ADMIN_WHATSAPP_NUMBER unset — admin dispute alert skipped"
    );
    return false;
  }
  const { sendTextReliable } = await import("./whatsapp.js");
  const ticket = disputeId ? `#${disputeId}` : orderId || "—";
  const headline = opened
    ? `🚨 *ADMIN ALERT: NEW DISPUTE FILED*`
    : `🚨 *ADMIN ALERT: DISPUTE EVIDENCE*`;
  const msg =
    `${headline}\n\n` +
    `• *Order:* *${orderId || "—"}*\n` +
    `• *Issue:* ${issueType}\n` +
    (disputeId ? `• *Ticket:* ${ticket}\n` : "") +
    `• *Buyer:* ${phone || "—"}\n` +
    `• *Payout:* held_for_dispute (ON HOLD)\n` +
    (evidenceUrl ? `• *Evidence:* ${evidenceUrl}\n` : "") +
    (opened ? "" : `• *DB attach:* ${attached ? "✅" : "relayed / pending"}\n`) +
    `Check Admin Portal → Disputes.`;

  console.log(`[Dispute Alert] admin targets:`, admins.join(", "));

  let sent = false;
  for (const admin of admins) {
    try {
      const result = await sendTextReliable(admin, msg, { label: "Dispute Alert/Admin" });
      if (result?.ok) {
        console.log(`[Dispute Alert] Sent to Admin: ${result.chatId || admin}`);
        sent = true;
      } else if (result?.dryRun) {
        console.error(`[Dispute Alert] DRY-RUN (not delivered) → ${admin}`);
      }
    } catch (err) {
      console.warn(`[Dispute Alert] Admin send failed → ${admin}:`, err.message);
    }
  }

  // Numbered action card (1 refund / 2 release / 3 split / 4 portal)
  try {
    const order = orderId ? (await import("./orders.js")).getOrder(orderId) : null;
    const amountKes =
      Number(order?.buyerTotalKes) ||
      Number(order?.priceKes) + Number(order?.shippingKes || 0) ||
      Number(order?.priceKes) ||
      0;
    const sellerPhone = order?.supplierId
      ? (await import("./suppliers.js")).getSupplier(order.supplierId)?.phone || ""
      : "";
    const { sendDisputeActionCardsToAdmins } = await import("./dispute-admin-actions.js");
    await sendDisputeActionCardsToAdmins(admins, {
      orderId,
      disputeId,
      buyerPhone: phone || order?.phone || "",
      sellerPhone,
      amountKes,
      issueType,
    });
  } catch (err) {
    console.warn("[Dispute Alert] action card skipped:", err.message);
  }

  return sent;
}

/**
 * Run the full protocol for one inbound message.
 * @returns {Promise<{ handled: boolean, ok?: boolean, message: string, orderId?: string|null, disputeId?: number|null, needsOrderId?: boolean }>}
 */
export async function runFulfillmentDisputeProtocol({
  text,
  phone = "",
  customerKey = "",
} = {}) {
  if (!isFulfillmentComplaint(text)) {
    return { handled: false, message: "" };
  }

  let orderId = extractOrderIdFromText(text);
  let candidates = [];
  if (!orderId) {
    const resolved = resolveDisputeOrderCandidate({ phone, customerKey });
    orderId = resolved.orderId;
    candidates = resolved.candidates || [];
  }

  if (!orderId) {
    return {
      handled: true,
      ok: false,
      needsOrderId: true,
      orderId: null,
      disputeId: null,
      candidates,
      message: formatNeedOrderIdMessage(candidates),
    };
  }

  const result = await openBuyerReturnCase({
    orderId,
    phone,
    customerKey,
    reason: String(text || "").slice(0, 400),
  });

  return {
    handled: true,
    ok: Boolean(result.ok),
    orderId: result.orderId || orderId,
    disputeId: result.disputeId || null,
    payoutHeld: Boolean(result.payoutHeld),
    askForEvidence: Boolean(result.askForEvidence),
    needsOrderId: false,
    alerts: result.alerts || null,
    message:
      result.message ||
      `Dispute registered for *${orderId}*. Reply with clear photos of the issue.`,
    error: result.error || null,
  };
}

/**
 * WhatsApp webhook early hook — bypasses the LLM entirely.
 * @returns {Promise<boolean>} true if message was handled
 */
export async function tryHandleFulfillmentDispute(customerKey, text, { phone = "" } = {}) {
  if (!isFulfillmentComplaint(text)) return false;
  const { sendText } = await import("./whatsapp.js");
  const result = await runFulfillmentDisputeProtocol({
    text,
    phone,
    customerKey,
  });
  if (!result.handled || !result.message) return false;
  console.log(
    `[dispute-protocol] ${result.ok ? "opened" : result.needsOrderId ? "needs_order_id" : "failed"}`,
    result.orderId || "(none)",
    result.disputeId ? `dispute#${result.disputeId}` : ""
  );
  markAwaitingDisputeEvidence(customerKey, {
    orderId: result.orderId || null,
    disputeId: result.disputeId || null,
    phone,
  });

  if (result.ok && result.orderId) {
    await ensurePayoutFrozen(result.orderId);
    // Seller/admin WAHA alerts are fired inside openBuyerReturnCase (AI tool + protocol).
    if (result.alerts) {
      console.log(
        `[Dispute Alert] protocol order=${result.orderId} seller=${result.alerts.seller ? "ok" : "FAIL"} admin=${result.alerts.admin ? "ok" : "FAIL"}`
      );
    }
  }

  await sendText(customerKey, result.message);
  return true;
}

/**
 * Inbound photo/video while in dispute evidence context — bypass catalog search.
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleDisputeEvidencePhoto(
  customerKey,
  {
    hasMedia = false,
    mediaUrl = null,
    mediaMimetype = null,
    messageId = null,
    chatId = null,
    session = null,
    text = "",
    phone = "",
  } = {}
) {
  if (!hasMedia || !customerKey) return false;

  const ctx = resolveDisputeEvidenceContext(customerKey, phone);
  // Caption itself is a complaint + media → treat as evidence even without prior state
  const captionComplaint = isFulfillmentComplaint(text);
  if (!ctx.awaiting && !captionComplaint) return false;

  const mime = String(mediaMimetype || "").toLowerCase();
  if (mime && !mime.startsWith("image/") && !mime.startsWith("video/")) return false;

  console.log(
    `[dispute-protocol] Evidence Received (skip catalog search) source=${ctx.source || (captionComplaint ? "caption" : "?")}`
  );

  let orderId =
    ctx.orderId ||
    extractOrderIdFromText(text) ||
    null;
  let disputeId = ctx.disputeId ? Number(ctx.disputeId) : null;

  // Caption complaint with no prior state: open/resolve order first
  if (!orderId && captionComplaint) {
    const resolved = resolveDisputeOrderCandidate({ phone, customerKey });
    orderId = resolved.orderId;
  }

  const { sendText, downloadWahaMedia } = await import("./whatsapp.js");

  if (!orderId) {
    markAwaitingDisputeEvidence(customerKey, { orderId: null, disputeId: null, phone });
    await sendText(
      customerKey,
      "📷 Got your photo — please also reply with the *SKN-####* order number so we can attach it to the dispute (not catalog search)."
    );
    return true;
  }

  // Ensure dispute thread + freeze exist before attaching evidence
  if (captionComplaint || !ctx.awaiting) {
    markAwaitingDisputeEvidence(customerKey, { orderId, disputeId, phone });
  }
  await ensurePayoutFrozen(orderId);

  let buffer;
  try {
    buffer = await downloadWahaMedia(mediaUrl, {
      messageId,
      chatId,
      session,
      mimetype: mediaMimetype || "image/jpeg",
    });
  } catch (err) {
    console.warn("[dispute-protocol] evidence download failed:", err.message);
    await sendText(
      customerKey,
      `Couldn't download that photo for *${orderId}*. Please send it again.`
    );
    return true;
  }

  const publicUrl = await hostEvidenceBuffer(buffer, {
    orderId,
    mimetype: mediaMimetype || "image/jpeg",
  });

  let attached = false;
  let attachError = null;
  try {
    const { isDbEnabled } = await import("../db/pool.js");
    if (isDbEnabled()) {
      const { getOpenDisputeForOrder, addDisputeEvidence } = await import("./disputes.js");
      const { findOrCreateBuyerUserByPhone } = await import("../db/repositories/users.js");
      if (!disputeId) {
        const open = await getOpenDisputeForOrder(orderId);
        disputeId = open?.id || null;
      }
      // No open dispute yet — open return case so evidence has a ticket
      if (!disputeId) {
        const opened = await openBuyerReturnCase({
          orderId,
          phone,
          customerKey,
          reason: String(text || "").trim().slice(0, 400) || `WhatsApp evidence photo for ${orderId}`,
        });
        disputeId = opened?.disputeId || null;
      }
      const buyerPhone =
        phoneDigits(phone) ||
        phoneDigits(getCustomerMeta(customerKey)?.phone);
      const userResult = buyerPhone ? await findOrCreateBuyerUserByPhone(buyerPhone) : null;
      const userId = userResult?.user?.id || null;
      if (disputeId && userId && publicUrl) {
        const added = await addDisputeEvidence({
          disputeId,
          userId,
          kind: mime.startsWith("video/") ? "video" : "photo",
          url: publicUrl,
          note: String(text || "").trim().slice(0, 400) || `WhatsApp evidence for ${orderId}`,
        });
        attached = Boolean(added?.success);
        if (!attached) attachError = added?.error || added?.message || "attach_failed";
      } else if (!disputeId) {
        attachError = "no_open_dispute";
      } else if (!publicUrl) {
        attachError = "no_public_url";
      } else if (!userId) {
        attachError = "no_buyer_user";
      }
    }
  } catch (err) {
    console.warn("[dispute-protocol] evidence attach skipped:", err.message);
    attachError = err.message;
  }

  clearAwaitingDisputeEvidence(customerKey, phone);

  // Always fire explicit seller + admin alerts (even if DB attach failed)
  await sendSellerDisputeAlert(orderId, {
    evidenceUrl: publicUrl,
    disputeId,
    issueType: "evidence photo",
  });
  await sendAdminDisputeAlert(orderId, {
    evidenceUrl: publicUrl,
    disputeId,
    phone: phoneDigits(phone) || phone,
    attached,
    issueType: "evidence photo",
    opened: false,
  });

  await sendText(
    customerKey,
    `✅ *Evidence Received!*\n` +
      `Order *${orderId}* payout has been frozen.` +
      (disputeId ? ` Ticket #${disputeId} is open.` : "") +
      `\nSeller and Admin alerts have been sent.`
  );
  console.log(
    `[dispute-protocol] evidence ${attached ? "attached" : "relayed"}`,
    orderId,
    disputeId ? `dispute#${disputeId}` : "",
    attachError || "alerts_sent"
  );
  return true;
}
