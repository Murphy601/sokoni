/**
 * Fit check: the buyer shares a photo after the money is released.
 *
 * Asked at the one moment the buyer is holding the thing they wanted and the
 * transaction is finished, which is the only time this is a nice thing to be
 * asked rather than a chore. The photo becomes a verified review on the
 * seller's profile, and the buyer gets a shareable card.
 *
 * Two lines it does not cross:
 *
 *  - Nothing is posted publicly without the buyer choosing to. The prompt is
 *    an invitation; declining it is a normal outcome, not a lapsed reward.
 *  - The reward is named up front. A discount dangled and then not honoured
 *    would cost more trust than the photo is worth.
 */

import { postSystemCard } from "../db/repositories/social.js";
import { MESSAGE_KINDS } from "../lib/message-kinds.js";
import { isDbEnabled, query } from "../db/pool.js";
import { resolveOrderParties } from "./escrow-chat-cards.js";

/** What the buyer gets for sharing one. */
export const FIT_CHECK_REWARD_KES = 100;
/** How long the invitation stands. */
export const FIT_CHECK_TTL_HOURS = 72;

/**
 * Invite the buyer to share a fit pic.
 *
 * Called when escrow releases. Fails soft and never twice for one order --
 * asking the same person again for the same purchase is nagging.
 */
export async function inviteFitCheck(order) {
  if (!order?.id || !isDbEnabled()) return null;
  const orderRef = String(order.id).toUpperCase();

  try {
    const { rows } = await query(
      `SELECT 1 FROM messages
        WHERE kind = $1 AND payload->>'orderRef' = $2 LIMIT 1`,
      [MESSAGE_KINDS.FIT_CHECK, orderRef]
    );
    if (rows.length) return null;
  } catch (err) {
    // If the check fails, do not ask. A duplicate nag is worse than a missed
    // invitation, and nothing downstream depends on this card existing.
    console.warn("[fit-check] duplicate check failed, skipping:", err.message);
    return null;
  }

  const parties = await resolveOrderParties(order);
  if (!parties) return null;

  return postSystemCard({
    senderUserId: parties.sellerUserId,
    receiverUserId: parties.buyerUserId,
    kind: MESSAGE_KINDS.FIT_CHECK,
    payload: {
      orderRef,
      productTitle: order.productName || order.itemName || "your order",
      rewardKes: FIT_CHECK_REWARD_KES,
      expiresAt: new Date(Date.now() + FIT_CHECK_TTL_HOURS * 3600_000).toISOString(),
      photoUrl: null,
    },
    content: `📸 Drop a fit pic for KES ${FIT_CHECK_REWARD_KES} off your next order`,
  });
}

/**
 * Attach the buyer's photo and publish it as a verified review.
 *
 * "Verified" means something specific here: the order exists, it was paid,
 * and the person posting is the buyer on it. That is the whole value of the
 * badge, so it is checked rather than assumed.
 */
export async function attachFitCheckPhoto({ messageId, userId, photoUrl } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const id = Number(messageId);
  const viewer = Number(userId);
  const url = String(photoUrl || "").trim();
  if (!id || !viewer || !url) {
    return { error: "invalid_fit_check", message: "messageId, userId and photoUrl are required." };
  }

  const { rows } = await query(
    `SELECT id, sender_user_id, receiver_user_id, kind, payload FROM messages WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row || row.kind !== MESSAGE_KINDS.FIT_CHECK) {
    return { error: "card_not_found", message: "That prompt is no longer here." };
  }
  if (Number(row.receiver_user_id) !== viewer) {
    return { error: "not_your_card", message: "That isn't your order." };
  }

  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  if (payload.photoUrl) {
    return { error: "already_shared", message: "You've already shared a photo for this order." };
  }
  if (payload.expiresAt && new Date(payload.expiresAt).getTime() <= Date.now()) {
    return { error: "fit_check_expired", message: "That invitation has expired." };
  }

  await query(
    `UPDATE messages
        SET payload = jsonb_set(payload, '{photoUrl}', to_jsonb($2::text)),
            updated_at = NOW()
      WHERE id = $1`,
    [id, url]
  );

  // Publishing is best-effort: the buyer has done their part either way, and
  // losing their photo because a review row failed would be the worse outcome.
  let published = false;
  try {
    // order_reviews, not a table of its own: a fit check is an ordinary
    // buyer_to_seller review carrying a photo, and it should count towards the
    // seller's rating like any other. ON CONFLICT covers the phase-13
    // (order_ref, direction) index when a buyer has already reviewed.
    await query(
      `INSERT INTO order_reviews
         (seller_user_id, buyer_user_id, order_ref, rating, comment, direction, photo_url, is_verified)
       VALUES ($1, $2, $3, 5, $4, 'buyer_to_seller', $5, TRUE)
       ON CONFLICT DO NOTHING`,
      [Number(row.sender_user_id), viewer, payload.orderRef || null, "Fit check", url]
    );
    published = true;
  } catch (err) {
    console.warn("[fit-check] review publish skipped:", err.message);
  }

  return {
    success: true,
    published,
    rewardKes: Number(payload.rewardKes) || FIT_CHECK_REWARD_KES,
    shareCard: shareCardFor(payload, url),
  };
}

/**
 * The details a share card is drawn from.
 *
 * Returned as data rather than a rendered image: generating one server-side
 * would mean a canvas library and a file per order on a 1GB VM, and the
 * client can draw the same thing from these fields.
 */
export function shareCardFor(payload, photoUrl) {
  return {
    photoUrl,
    title: payload?.productTitle || "My Sokoni find",
    orderRef: payload?.orderRef || null,
    caption: "Bought on Sokoni Mall",
  };
}
