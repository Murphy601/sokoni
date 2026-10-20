/**
 * Bundle cards in the chat thread.
 *
 * A bundle exists in its own table, but the negotiation happens in the chat,
 * so each move drops a card where the two people are already talking. One
 * card per bundle, updated in place -- a thread showing four cards for the
 * same bundle at four different prices is exactly the confusion the pinned
 * ledger was built to avoid.
 */

import { sendDirectMessage } from "../db/repositories/social.js";
import { MESSAGE_KINDS } from "../lib/message-kinds.js";
import { isDbEnabled, query } from "../db/pool.js";

const money = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

/** One line describing where the bundle stands, for previews and WhatsApp. */
export function bundleText(bundle) {
  const count = bundle?.items?.length || 0;
  const head = `Bundle of ${count} item${count === 1 ? "" : "s"} — ${money(bundle?.amountKes)}`;
  const saving = Number(bundle?.savingKes) || 0;
  const save = saving > 0 ? ` (saves ${money(saving)})` : "";
  switch (bundle?.status) {
    case "accepted":
      return `${head}${save} — accepted`;
    case "declined":
      return `${head} — declined`;
    case "expired":
      return `${head} — expired`;
    case "countered":
      return `Counter: ${head}${save}`;
    default:
      return `${head}${save}`;
  }
}

/**
 * Post or refresh the card for a bundle.
 *
 * Fails soft. A bundle that exists without a card is recoverable -- both
 * sides can still see it in the thread on reload -- whereas throwing here
 * would fail the API call that created the bundle in the first place.
 */
export async function postBundleCard(bundle) {
  if (!bundle?.id || !isDbEnabled()) return null;

  const payload = {
    bundleId: bundle.id,
    productIds: (bundle.items || []).map((i) => i.productId),
    items: (bundle.items || []).map((i) => ({
      productId: i.productId,
      title: i.title,
      imageUrl: i.imageUrl,
      listKes: i.listKes,
    })),
    amountKes: bundle.amountKes,
    listTotalKes: bundle.listTotalKes,
    savingKes: bundle.savingKes,
    status: bundle.status,
    lastActor: bundle.lastActor,
  };
  const content = bundleText(bundle);

  try {
    const { rows } = await query(
      `SELECT id FROM messages
        WHERE kind = $1 AND (payload->>'bundleId')::bigint = $2
        ORDER BY id DESC LIMIT 1`,
      [MESSAGE_KINDS.BUNDLE, bundle.id]
    );

    if (rows[0]) {
      await query(
        `UPDATE messages SET payload = $2::jsonb, content = $3, updated_at = NOW() WHERE id = $1`,
        [Number(rows[0].id), JSON.stringify(payload), content]
      );
      return { id: Number(rows[0].id), updated: true };
    }

    // Sent from whoever moved last, so the card sits on the right side of the
    // thread and reads as their proposal.
    const fromBuyer = bundle.lastActor !== "seller";
    const result = await sendDirectMessage({
      senderUserId: fromBuyer ? bundle.buyerUserId : bundle.sellerUserId,
      receiverUserId: fromBuyer ? bundle.sellerUserId : bundle.buyerUserId,
      content,
      kind: MESSAGE_KINDS.BUNDLE,
      payload,
    });
    if (result.error) {
      console.warn("[bundle-cards] card refused:", result.error);
      return null;
    }
    return { id: result.message.id, updated: false };
  } catch (err) {
    console.warn("[bundle-cards] skipped:", err.message);
    return null;
  }
}
