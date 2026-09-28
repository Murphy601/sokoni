/**
 * Locked drops: a seller offers previous buyers first look at an item.
 *
 * The card shows a blurred photo and a countdown. When the timer runs out the
 * item unlocks for whoever holds a card, and the seller can then publish it
 * publicly. The exclusivity is real -- the item is not on the public feed
 * during the window -- because a "locked drop" on something already listed is
 * just a banner.
 *
 * Only past buyers can receive one. A drop sent to strangers is a broadcast,
 * and the reason this works is that it rewards people who already bought.
 */

import { sendDirectMessage } from "../db/repositories/social.js";
import { MESSAGE_KINDS } from "../lib/message-kinds.js";
import { isDbEnabled, query } from "../db/pool.js";

/** How long the early window lasts. */
export const DROP_WINDOW_MS = 60 * 60 * 1000;
/** Most people one drop may go to. Beyond this it stops being exclusive. */
export const MAX_DROP_RECIPIENTS = 10;

/**
 * Buyers who have bought from this seller before, newest first.
 *
 * This is the guest list. Derived rather than chosen freely, so a seller
 * cannot use drops to message people who never dealt with them.
 */
export async function eligibleDropRecipients(sellerUserId, limit = 20) {
  if (!isDbEnabled()) return [];
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (o.buyer_user_id) o.buyer_user_id AS id, u.handle, u.display_name, o.created_at
         FROM offers o
         JOIN users u ON u.id = o.buyer_user_id
        WHERE o.seller_user_id = $1 AND o.status = 'accepted'
        ORDER BY o.buyer_user_id, o.created_at DESC
        LIMIT $2`,
      [Number(sellerUserId), Math.min(Math.max(Number(limit) || 20, 1), 50)]
    );
    return rows.map((r) => ({
      userId: Number(r.id),
      handle: r.handle || null,
      name: r.display_name || r.handle || `User #${r.id}`,
    }));
  } catch (err) {
    console.warn("[locked-drops] recipient lookup skipped:", err.message);
    return [];
  }
}

/**
 * Send a drop to a chosen subset of past buyers.
 *
 * @returns {Promise<{success:true, sent:number, unlocksAt:string}|{error:string,message:string}>}
 */
export async function sendLockedDrop({ sellerUserId, productId, buyerUserIds } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const seller = Number(sellerUserId);
  const wanted = [...new Set((Array.isArray(buyerUserIds) ? buyerUserIds : []).map(Number).filter(Boolean))];
  if (!seller) return { error: "invalid_drop", message: "sellerUserId is required." };
  if (!wanted.length) return { error: "no_recipients", message: "Pick at least one buyer." };
  if (wanted.length > MAX_DROP_RECIPIENTS) {
    return {
      error: "too_many_recipients",
      message: `A drop goes to at most ${MAX_DROP_RECIPIENTS} people.`,
    };
  }

  const { rows } = await query(
    `SELECT id, title, image_url, price_kes, seller_user_id, is_sold
       FROM products WHERE id = $1`,
    [String(productId || "")]
  );
  const product = rows[0];
  if (!product) return { error: "product_not_found", message: "That item is no longer listed." };
  if (Number(product.seller_user_id) !== seller) {
    return { error: "not_your_item", message: "You can only drop your own listings." };
  }
  if (product.is_sold) {
    return { error: "item_unavailable", message: "That item is already sold." };
  }

  // Only people who have actually bought from this seller.
  const eligible = new Set((await eligibleDropRecipients(seller, 50)).map((r) => r.userId));
  const recipients = wanted.filter((id) => eligible.has(id));
  if (!recipients.length) {
    return {
      error: "not_past_buyers",
      message: "Drops only go to people who have bought from you before.",
    };
  }

  const unlocksAt = new Date(Date.now() + DROP_WINDOW_MS).toISOString();
  const payload = {
    productId: String(product.id),
    productTitle: product.title || "Item",
    imageUrl: product.image_url || null,
    priceKes: Math.round(Number(product.price_kes) || 0),
    unlocksAt,
  };

  let sent = 0;
  for (const buyer of recipients) {
    const result = await sendDirectMessage({
      senderUserId: seller,
      receiverUserId: buyer,
      content: "🔒 Early access drop",
      kind: MESSAGE_KINDS.LOCKED_DROP,
      payload,
    });
    // One refused recipient must not lose the drop for the rest.
    if (result.error) console.warn(`[locked-drops] ${buyer} skipped:`, result.error);
    else sent += 1;
  }

  if (!sent) return { error: "drop_not_sent", message: "Could not send that drop." };
  return { success: true, sent, unlocksAt };
}

/** Has the early window closed? */
export function isDropUnlocked(unlocksAt, now = Date.now()) {
  const at = new Date(unlocksAt).getTime();
  if (!Number.isFinite(at)) return true;
  return now >= at;
}

/** Whole seconds left, floored at zero. */
export function dropSecondsLeft(unlocksAt, now = Date.now()) {
  const at = new Date(unlocksAt).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.round((at - now) / 1000));
}
