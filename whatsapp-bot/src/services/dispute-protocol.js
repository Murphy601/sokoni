/**
 * Deterministic fulfillment dispute protocol.
 * Does NOT rely on the LLM — freezes payout, opens DB ticket, alerts seller/admin,
 * and returns the structured buyer follow-up text.
 *
 * Also tracks AWAITING_DISPUTE_EVIDENCE in session meta so inbound photos attach to
 * the dispute instead of running visual catalog search.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractOrderIdFromText, getOrdersForCustomer } from "./orders.js";
import { openBuyerReturnCase } from "./communication-hub.js";
import { getCustomerMeta, setCustomerMeta } from "./session.js";
import { CATALOG_IMAGES_DIR } from "../lib/catalog-images.js";
import { config } from "../config.js";

const COMPLAINT_RE =
  /\b(refund|damaged|damage|return|money back|wrong item|broken|scam|not as described|fake|counterfeit|defective|cracked|torn)\b/i;

const AWAITING_TTL_MS = 48 * 60 * 60 * 1000;

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
  // Multiple recent paid orders — do not guess; ask buyer to pick
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

/** Mark chat as waiting for damage / wrong-item evidence (not catalog search). */
export function markAwaitingDisputeEvidence(customerKey, { orderId = null, disputeId = null } = {}) {
  if (!customerKey) return;
  setCustomerMeta(customerKey, {
    awaitingDisputeEvidence: true,
    awaitingDamagePhoto: true, // legacy alias (ops #recover / older soft path)
    disputeOrderId: orderId || null,
    issueOrderId: orderId || null,
    disputeId: disputeId != null ? Number(disputeId) || null : null,
    awaitingDisputeEvidenceAt: Date.now(),
  });
}

export function clearAwaitingDisputeEvidence(customerKey) {
  if (!customerKey) return;
  setCustomerMeta(customerKey, {
    awaitingDisputeEvidence: false,
    awaitingDamagePhoto: false,
    disputeOrderId: null,
    issueOrderId: null,
    disputeId: null,
    awaitingDisputeEvidenceAt: null,
  });
}

export function isAwaitingDisputeEvidence(customerKey) {
  const meta = getCustomerMeta(customerKey) || {};
  if (!meta.awaitingDisputeEvidence && !meta.awaitingDamagePhoto) return false;
  const at = Number(meta.awaitingDisputeEvidenceAt || 0);
  if (at && Date.now() - at > AWAITING_TTL_MS) {
    clearAwaitingDisputeEvidence(customerKey);
    return false;
  }
  return true;
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
  // Always remember we're on a dispute thread so the next photo is not catalog search.
  markAwaitingDisputeEvidence(customerKey, {
    orderId: result.orderId || null,
    disputeId: result.disputeId || null,
  });
  await sendText(customerKey, result.message);
  return true;
}

/**
 * Inbound photo/video while awaiting dispute evidence — bypass catalog search.
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
  if (!isAwaitingDisputeEvidence(customerKey)) return false;

  const mime = String(mediaMimetype || "").toLowerCase();
  if (mime && !mime.startsWith("image/") && !mime.startsWith("video/")) return false;

  const meta = getCustomerMeta(customerKey) || {};
  let orderId =
    meta.disputeOrderId ||
    meta.issueOrderId ||
    extractOrderIdFromText(text) ||
    null;
  let disputeId = meta.disputeId ? Number(meta.disputeId) : null;

  const { sendText, downloadWahaMedia } = await import("./whatsapp.js");

  if (!orderId) {
    await sendText(
      customerKey,
      "📷 Got your photo — please also reply with the *SKN-####* order number so we can attach it to the dispute (not catalog search)."
    );
    // Stay awaiting — do not clear, do not run image search
    return true;
  }

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
      const buyerPhone =
        String(phone || "").replace(/\D/g, "") ||
        String(getCustomerMeta(customerKey)?.phone || "").replace(/\D/g, "");
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
      }
    }
  } catch (err) {
    console.warn("[dispute-protocol] evidence attach skipped:", err.message);
    attachError = err.message;
  }

  clearAwaitingDisputeEvidence(customerKey);

  const admin = config.admin.primary;
  if (admin) {
    try {
      await sendText(
        admin,
        `📸 *Dispute evidence*\n` +
          `Order: *${orderId}*\n` +
          (disputeId ? `Dispute: #${disputeId}\n` : "") +
          `Customer: ${phone || customerKey}\n` +
          (publicUrl ? `URL: ${publicUrl}\n` : "") +
          (attached ? `DB: attached ✅` : `DB: not attached (${attachError || "n/a"})`)
      );
    } catch {
      /* ignore */
    }
  }

  await sendText(
    customerKey,
    attached
      ? `✅ Photo received for *${orderId}* — attached to your dispute ticket. Sokoni admin and the seller have been notified.`
      : `✅ Photo received for *${orderId}*. Support has it — we'll review and update you here.`
  );
  console.log(
    `[dispute-protocol] evidence ${attached ? "attached" : "relayed"}`,
    orderId,
    disputeId ? `dispute#${disputeId}` : "",
    attachError || ""
  );
  return true;
}
