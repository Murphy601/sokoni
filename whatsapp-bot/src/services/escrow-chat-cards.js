/**
 * Escrow referee cards and the pinned deal ledger.
 *
 * Two jobs, both about the buyer and seller trusting what they are looking at:
 *
 *  - A referee card states what the platform just did ("KES 1,500 locked").
 *    It is is_system, so the client never draws it as something a person said,
 *    and a person cannot post one.
 *  - The ledger is one pinned card holding the agreed terms and the current
 *    escrow state. It is updated in place rather than appended, so there is
 *    exactly one source of truth however long the thread runs.
 *
 * Everything here fails soft. A missing card is a cosmetic problem; throwing
 * back into a payment callback is a money problem.
 */

import { postSystemCard, pinMessage, ensureOrderSellerUserId } from "../db/repositories/social.js";
import { MESSAGE_KINDS, ESCROW_STATES } from "../lib/message-kinds.js";
import { isDbEnabled, query } from "../db/pool.js";

/** Copy per escrow state. Present tense, and no promises about timing. */
const CARD_COPY = {
  awaiting_payment: {
    emoji: "🟡",
    line: (m) => `Awaiting M-Pesa payment of ${m}.`,
  },
  locked: {
    emoji: "🛡️",
    line: (m) =>
      `${m} is safe in Sokoni escrow. The seller is not paid until you confirm receipt, or the 2-hour inspection window ends.`,
  },
  dispatched: {
    emoji: "🏍️",
    line: () => "On the way. Escrow stays locked until delivery is confirmed.",
  },
  delivered: {
    emoji: "⏱️",
    line: () => "Delivered. You have 2 hours to check the item before the funds can be released.",
  },
  released: {
    emoji: "✅",
    line: (m) => `${m} released to the seller. This deal is complete.`,
  },
  refunded: {
    emoji: "↩️",
    line: (m) => `${m} refunded to the buyer.`,
  },
  disputed: {
    emoji: "⚠️",
    line: () => "Escrow frozen while Sokoni reviews this order.",
  },
};

const money = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

/**
 * Both sides of an order as social user ids.
 * @returns {Promise<{buyerUserId:number, sellerUserId:number}|null>}
 */
export async function resolveOrderParties(order) {
  if (!order?.id || !isDbEnabled()) return null;
  try {
    const sellerUserId = Number(await ensureOrderSellerUserId(order)) || null;
    let buyerUserId = Number(order.buyerUserId ?? order.buyer_user_id) || null;

    if (!buyerUserId && order.phone) {
      const { findUserByPhone } = await import("../db/repositories/users.js");
      const user = await findUserByPhone(order.phone);
      buyerUserId = Number(user?.id) || null;
    }
    if (!buyerUserId || !sellerUserId || buyerUserId === sellerUserId) return null;
    return { buyerUserId, sellerUserId };
  } catch (err) {
    console.warn("[escrow-cards] party lookup skipped:", err.message);
    return null;
  }
}

/**
 * Has this exact card already been posted for this order?
 *
 * Safaricom retries STK callbacks, so without this a buyer sees "KES 1,500
 * locked" two or three times -- on the feature whose whole job is looking
 * bulletproof.
 */
async function cardAlreadyPosted(orderRef, state) {
  try {
    const { rows } = await query(
      `SELECT 1
         FROM messages
        WHERE kind = $1
          AND is_system = TRUE
          AND payload->>'orderRef' = $2
          AND payload->>'state' = $3
        LIMIT 1`,
      [MESSAGE_KINDS.ESCROW_STATUS, String(orderRef), String(state)]
    );
    return rows.length > 0;
  } catch (err) {
    // If the check itself fails, post anyway: a duplicate card is a smaller
    // problem than a payment nobody was told about.
    console.warn("[escrow-cards] duplicate check skipped:", err.message);
    return false;
  }
}

/**
 * Post a referee card into the buyer/seller thread and refresh the ledger.
 *
 * @param {object} order
 * @param {string} state one of ESCROW_STATES
 * @returns {Promise<{posted:boolean, reason?:string, messageId?:number}>}
 */
export async function postEscrowCard(order, state) {
  if (!order?.id) return { posted: false, reason: "missing_order" };
  if (!ESCROW_STATES.includes(String(state))) {
    console.warn(`[escrow-cards] unknown state ${state} for ${order.id}`);
    return { posted: false, reason: "unknown_state" };
  }

  const parties = await resolveOrderParties(order);
  if (!parties) return { posted: false, reason: "parties_unresolved" };

  const orderRef = String(order.id).toUpperCase();
  if (await cardAlreadyPosted(orderRef, state)) {
    return { posted: false, reason: "already_posted" };
  }

  const amountKes = Math.round(Number(order.totalKes ?? order.priceKes) || 0);
  const copy = CARD_COPY[state] || { emoji: "ℹ️", line: () => state };
  const content = `${copy.emoji} ${copy.line(money(amountKes))}`;

  const message = await postSystemCard({
    // Sent from the seller's side so it lands in the buyer's thread with them.
    senderUserId: parties.sellerUserId,
    receiverUserId: parties.buyerUserId,
    kind: MESSAGE_KINDS.ESCROW_STATUS,
    payload: { orderRef, state, amountKes },
    content,
  });
  if (!message) return { posted: false, reason: "not_stored" };

  await upsertDealLedger(order, state, parties);
  void relayToSellerWhatsApp(order, orderRef, state, amountKes);
  void relayToBuyerWhatsApp(order, orderRef, state, amountKes);
  return { posted: true, messageId: message.id };
}

/** One line for the pinned ledger, from columns that exist. */
export function sellerTrustLine(row) {
  if (!row) return "";
  const completed = Number(row.completed_orders) || 0;
  const verified = Boolean(row.is_seller_verified);
  if (completed < 1) {
    return verified
      ? "New verified seller. Your money stays in escrow."
      : "New seller. Your money stays in escrow.";
  }
  const rating = Number(row.rating_score);
  const reviews = Number(row.rating_count) || 0;
  const bits = [];
  if (reviews >= 1 && Number.isFinite(rating)) bits.push(`${rating.toFixed(1)} rating`);
  bits.push(`${completed} completed order${completed === 1 ? "" : "s"}`);
  if (verified) bits.push("Verified seller");
  return bits.join(" · ");
}

async function trustLineFor(sellerUserId) {
  try {
    const { rows } = await query(
      `SELECT rating_score, rating_count, completed_orders, is_seller_verified
         FROM users WHERE id = $1`,
      [sellerUserId]
    );
    return sellerTrustLine(rows[0]);
  } catch (err) {
    console.warn("[escrow-cards] trust line skipped:", err.message);
    return "";
  }
}

/**
 * Send the same fact to the seller's WhatsApp.
 *
 * A seller who never opens the website still has to know the money is there,
 * and an escrow card cannot render on native WhatsApp -- so it goes as the
 * plain-text fallback.
 *
 * Deliberately not awaited by the caller: WAHA runs in its own container and
 * can be slow or restarting, and a payment confirmation must not wait on it.
 */
async function relayToSellerWhatsApp(order, orderRef, state, amountKes) {
  const text = whatsappFallback(orderRef, state, amountKes);
  if (!text) return;
  const to = order.sellerPhone || order.supplierPhone || "";
  if (!to) return;
  try {
    const { sendText } = await import("./whatsapp.js");
    await sendText(String(to).includes("@") ? to : `${String(to).replace(/\D/g, "")}@c.us`, text);
  } catch (err) {
    console.warn(`[escrow-cards] WhatsApp relay skipped for ${orderRef}:`, err.message);
  }
}

/**
 * Create or refresh the pinned ledger for an order's thread.
 *
 * Updated in place. Appending a fresh ledger on every state change would give
 * the thread several cards each claiming to be the agreed terms, which is the
 * argument it exists to settle.
 */
export async function upsertDealLedger(order, state, partiesIn = null) {
  if (!order?.id) return null;
  const parties = partiesIn || (await resolveOrderParties(order));
  if (!parties) return null;

  const orderRef = String(order.id).toUpperCase();
  const shippingKes = Math.round(Number(order.shippingKes) || 0);
  const payload = {
    orderRef,
    state: String(state),
    itemName: order.productName || order.itemName || "Item",
    itemKes: Math.round(Number(order.priceKes) || 0),
    shippingKes,
    totalKes: Math.round(Number(order.totalKes ?? order.priceKes) || 0),
    // Stated outright, because "2,000 including boda or plus boda" is the
    // argument people actually have.
    shippingPayer: shippingKes > 0 ? "buyer" : "seller",
    inspectionEndsAt: Number(order.inspectionEndsAt) > 0 ? Number(order.inspectionEndsAt) : null,
    sellerTrustLine: await trustLineFor(parties.sellerUserId),
    updatedAt: new Date().toISOString(),
  };

  try {
    const { rows } = await query(
      `SELECT id FROM messages
        WHERE kind = $1
          AND payload->>'orderRef' = $2
          AND ((sender_user_id = $3 AND receiver_user_id = $4)
            OR (sender_user_id = $4 AND receiver_user_id = $3))
        ORDER BY id DESC
        LIMIT 1`,
      [MESSAGE_KINDS.DEAL_LEDGER, orderRef, parties.sellerUserId, parties.buyerUserId]
    );

    if (rows[0]) {
      const id = Number(rows[0].id);
      await query(
        `UPDATE messages SET payload = $2::jsonb, content = $3, updated_at = NOW() WHERE id = $1`,
        [id, JSON.stringify(payload), ledgerText(payload)]
      );
      await pinMessage({ messageId: id, userId: parties.sellerUserId });
      return { id, updated: true };
    }

    const created = await postSystemCard({
      senderUserId: parties.sellerUserId,
      receiverUserId: parties.buyerUserId,
      kind: MESSAGE_KINDS.DEAL_LEDGER,
      payload,
      content: ledgerText(payload),
      pin: true,
    });
    return created ? { id: created.id, updated: false } : null;
  } catch (err) {
    console.warn("[escrow-cards] ledger skipped:", err.message);
    return null;
  }
}

/** The ledger as one line, for previews and for WhatsApp. */
export function ledgerText(p) {
  const bits = [
    `${p.itemName} — ${money(p.itemKes)}`,
    p.shippingKes > 0 ? `delivery ${money(p.shippingKes)}` : "delivery free",
    `total ${money(p.totalKes)}`,
  ];
  return `${p.orderRef}: ${bits.join(" · ")} · ${String(p.state).replace(/_/g, " ")}`;
}

/**
 * The same card as plain text for WhatsApp, where nothing renders.
 *
 * Prefixed so a seller reads it as the platform speaking rather than the buyer
 * typing -- the difference between "Sokoni says the money is there" and
 * "someone in this chat says the money is there".
 */
export function whatsappFallback(orderRef, state, amountKes) {
  const copy = CARD_COPY[state];
  if (!copy) return "";
  return `🤖 *SOKONI ESCROW:* ${copy.line(money(amountKes))} (${orderRef})`;
}

async function relayToBuyerWhatsApp(order, orderRef, state, amountKes) {
  let text = "";
  if (state === "locked") {
    text =
      `🛡️ *SOKONI ESCROW PROTECTION ACTIVE*\n` +
      `*Amount held:* ${money(amountKes)}\n` +
      `*Status:* Safe in Sokoni escrow\n` +
      `The seller does not get paid until you confirm receipt, or your 2-hour inspection window ends.\n` +
      `Order ${orderRef}`;
  } else if (state === "delivered") {
    const { inspectionRemainingLabel } = await import("../agents/inspection-window.js");
    text =
      `⏱️ *${inspectionRemainingLabel(order.inspectionEndsAt)}*\n` +
      `Order ${orderRef}. Check the item.\n` +
      `Reply *YES ${orderRef}* to release funds now.\n` +
      `Reply *HELP ${orderRef}* and send a photo or a short video if something is wrong.`;
  }
  if (!text) return;
  try {
    const { buyerWhatsAppDestination } = await import("./buyer-whatsapp.js");
    const to = await buyerWhatsAppDestination(order);
    if (!to) return;
    const { sendText } = await import("./whatsapp.js");
    await sendText(to, text);
  } catch (err) {
    console.warn(`[escrow-cards] buyer WhatsApp skipped for ${orderRef}:`, err.message);
  }
}
