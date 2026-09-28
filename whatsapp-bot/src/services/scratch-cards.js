/**
 * Scratch cards: a seller-funded discount the buyer has to reveal.
 *
 * The seller picks a perk, the platform checks it cannot produce a price that
 * breaks the payout maths, and the buyer scratches to see it. Revealing
 * starts a 24-hour clock and creates an offer at the discounted price, so
 * accepting goes through the ordinary offer -> STK -> escrow path. Nothing
 * here is a second way to charge someone.
 *
 * The seller funds it, so the seller chooses it -- the platform never
 * discounts on their behalf.
 */

import { sendDirectMessage } from "../db/repositories/social.js";
import { MESSAGE_KINDS } from "../lib/message-kinds.js";
import { isDbEnabled, query } from "../db/pool.js";
import {
  validatePerk,
  isPerkExpired,
  perkMinutesLeft,
  deliveryCostNotice,
  PERK_TYPES,
} from "../lib/scratch-perks.js";

/**
 * Send a scratch card into a thread.
 *
 * The item price is read from the catalogue, never from the request: a seller
 * who could send their own price could make a perk look bigger than it is.
 */
export async function sendScratchCard({ sellerUserId, buyerUserId, productId, perk } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const seller = Number(sellerUserId);
  const buyer = Number(buyerUserId);
  if (!seller || !buyer || seller === buyer) {
    return { error: "invalid_card", message: "sellerUserId and buyerUserId are required." };
  }

  const { rows } = await query(
    `SELECT id, title, price_kes, seller_user_id, in_stock, is_sold
       FROM products WHERE id = $1`,
    [String(productId || "")]
  );
  const product = rows[0];
  if (!product) return { error: "product_not_found", message: "That item is no longer listed." };
  if (Number(product.seller_user_id) !== seller) {
    return { error: "not_your_item", message: "You can only discount your own listings." };
  }
  if (product.is_sold || product.in_stock === false) {
    return { error: "item_unavailable", message: "That item is no longer available." };
  }

  const itemPriceKes = Math.round(Number(product.price_kes) || 0);
  const checked = validatePerk(perk, itemPriceKes);
  if (!checked.ok) return { error: checked.error, message: checked.message };

  const payload = {
    productId: String(product.id),
    productTitle: product.title || "Item",
    itemPriceKes,
    perk: checked.perk,
    discountKes: checked.discountKes,
    finalKes: checked.finalKes,
    // Null until the buyer scratches. The clock starts on reveal, not on send,
    // so a card sent overnight is not already dead by morning.
    revealedAt: null,
  };

  const result = await sendDirectMessage({
    senderUserId: seller,
    receiverUserId: buyer,
    content: "🎁 A deal to scratch",
    kind: MESSAGE_KINDS.SCRATCH_CARD,
    payload,
  });
  if (result.error) return result;
  return { success: true, message: result.message };
}

/**
 * Scratch a card.
 *
 * Only the buyer it was sent to may reveal it, and only once -- a second
 * scratch returns the same perk rather than restarting the clock, because a
 * buyer refreshing a page must not extend their own deadline.
 */
export async function revealScratchCard({ messageId, userId } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const id = Number(messageId);
  const viewer = Number(userId);
  if (!id || !viewer) {
    return { error: "invalid_reveal", message: "messageId and userId are required." };
  }

  const { rows } = await query(
    `SELECT id, sender_user_id, receiver_user_id, kind, payload FROM messages WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row || row.kind !== MESSAGE_KINDS.SCRATCH_CARD) {
    return { error: "card_not_found", message: "Card not found." };
  }
  // The seller sent it; only the buyer can scratch it.
  if (Number(row.receiver_user_id) !== viewer) {
    return { error: "not_your_card", message: "That card isn't yours to scratch." };
  }

  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  if (payload.revealedAt) {
    if (isPerkExpired(payload.revealedAt)) {
      return { error: "perk_expired", message: "That deal has expired." };
    }
    return {
      success: true,
      alreadyRevealed: true,
      perk: payload.perk,
      finalKes: payload.finalKes,
      minutesLeft: perkMinutesLeft(payload.revealedAt),
    };
  }

  const revealedAt = new Date().toISOString();
  await query(
    `UPDATE messages
        SET payload = jsonb_set(payload, '{revealedAt}', to_jsonb($2::text)),
            updated_at = NOW()
      WHERE id = $1`,
    [id, revealedAt]
  );

  // An offer at the discounted price, so accepting uses the path that already
  // works. Free delivery has no item discount, so there is nothing to offer --
  // it is applied at checkout instead.
  let offerId = null;
  if (payload.perk?.type !== PERK_TYPES.FREE_DELIVERY && payload.finalKes > 0) {
    try {
      const { rows: offer } = await query(
        `INSERT INTO offers (product_id, buyer_user_id, seller_user_id, amount_kes, status, expires_at)
         VALUES ($1, $2, $3, $4, 'accepted', NOW() + INTERVAL '24 hours')
         RETURNING id`,
        [payload.productId, viewer, Number(row.sender_user_id), payload.finalKes]
      );
      offerId = offer[0] ? Number(offer[0].id) : null;
      if (offerId) {
        await query(
          `UPDATE messages SET payload = jsonb_set(payload, '{offerId}', to_jsonb($2::bigint)) WHERE id = $1`,
          [id, offerId]
        );
      }
    } catch (err) {
      // The perk is revealed either way; without the offer the buyer can still
      // be helped by the seller directly.
      console.warn("[scratch-cards] offer from perk skipped:", err.message);
    }
  }

  return {
    success: true,
    alreadyRevealed: false,
    perk: payload.perk,
    finalKes: payload.finalKes,
    discountKes: payload.discountKes,
    offerId,
    minutesLeft: perkMinutesLeft(revealedAt),
  };
}

/** The perks a seller may choose, with the warning attached to free delivery. */
export function perkOptions(itemPriceKes) {
  const price = Math.round(Number(itemPriceKes) || 0);
  const presets = [
    { type: PERK_TYPES.FREE_DELIVERY, label: "Free delivery", notice: deliveryCostNotice() },
    { type: PERK_TYPES.PERCENT_OFF, percent: 10, label: "10% off" },
    { type: PERK_TYPES.AMOUNT_OFF, amountKes: 100, label: "KES 100 off" },
  ];
  return presets
    .map((p) => {
      const checked = validatePerk(p, price);
      return { ...p, available: checked.ok, finalKes: checked.ok ? checked.finalKes : null };
    })
    .filter((p) => p.available || p.type === PERK_TYPES.FREE_DELIVERY);
}
