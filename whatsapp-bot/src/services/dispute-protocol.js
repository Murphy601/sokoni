/**
 * Deterministic fulfillment dispute protocol.
 * Does NOT rely on the LLM — freezes payout, opens DB ticket, alerts seller/admin,
 * and returns the structured buyer follow-up text.
 */
import { extractOrderIdFromText, getOrdersForCustomer } from "./orders.js";
import { openBuyerReturnCase } from "./communication-hub.js";

const COMPLAINT_RE =
  /\b(refund|damaged|damage|return|money back|wrong item|broken|scam|not as described|fake|counterfeit|defective|cracked|torn)\b/i;

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
  await sendText(customerKey, result.message);
  return true;
}
