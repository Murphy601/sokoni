/**
 * Bundles: several items from one seller, negotiated as one price.
 *
 * A bundle is a proposal, not a payment rail. Accepting one turns it into an
 * ordinary multi-line cart order, so escrow, dispatch and payouts behave
 * exactly as they do for anything else -- the only new thing here is the
 * haggling, and the split that makes the agreed price land correctly on each
 * line.
 */

import { isDbEnabled, query, withTransaction } from "../pool.js";
import { apportionBundlePrice, bundleListTotal } from "../../lib/bundle-pricing.js";

/** Items in one bundle. More than this is a shop, not a bundle. */
export const MAX_BUNDLE_ITEMS = 8;
/** A proposal nobody answers stops being an offer. */
export const BUNDLE_TTL_HOURS = 48;

function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function mapBundle(row, items = []) {
  if (!row) return null;
  return {
    id: Number(row.id),
    buyerUserId: Number(row.buyer_user_id),
    sellerUserId: Number(row.seller_user_id),
    amountKes: Math.round(Number(row.amount_kes) || 0),
    listTotalKes: Math.round(Number(row.list_total_kes) || 0),
    savingKes: Math.round((Number(row.list_total_kes) || 0) - (Number(row.amount_kes) || 0)),
    status: row.status,
    lastActor: row.last_actor,
    orderRef: row.order_ref || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    items,
  };
}

async function loadItems(bundleId) {
  const { rows } = await query(
    `SELECT bi.product_id, bi.list_kes, bi.position,
            p.title, p.image_url, p.price_kes
       FROM bundle_items bi
       LEFT JOIN products p ON p.id = bi.product_id
      WHERE bi.bundle_id = $1
      ORDER BY bi.position, bi.product_id`,
    [bundleId]
  );
  return rows.map((r) => ({
    productId: r.product_id,
    listKes: Math.round(Number(r.list_kes) || 0),
    title: r.title || "Item",
    imageUrl: r.image_url || null,
  }));
}

/**
 * Propose a bundle.
 *
 * Prices come from the products table, never from the request. A buyer who
 * could send their own list prices could set the saving to whatever they
 * liked and the seller would see a total that was never true.
 */
export async function createBundle({ buyerUserId, sellerUserId, productIds, amountKes } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const buyer = parseId(buyerUserId);
  const seller = parseId(sellerUserId);
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map(String).filter(Boolean))];

  if (!buyer || !seller) {
    return { error: "invalid_bundle", message: "buyerUserId and sellerUserId are required." };
  }
  if (buyer === seller) {
    return { error: "invalid_bundle", message: "You can't bundle with yourself." };
  }
  if (ids.length < 2) {
    return { error: "bundle_too_small", message: "Pick at least 2 items." };
  }
  if (ids.length > MAX_BUNDLE_ITEMS) {
    return {
      error: "bundle_too_large",
      message: `A bundle can hold up to ${MAX_BUNDLE_ITEMS} items.`,
    };
  }

  const { rows: products } = await query(
    `SELECT id, title, price_kes, seller_user_id, in_stock, is_sold
       FROM products WHERE id = ANY($1::varchar[])`,
    [ids]
  );
  if (products.length !== ids.length) {
    return { error: "product_not_found", message: "One of those items is no longer listed." };
  }
  // Every item has to belong to the seller being haggled with, or the bundle
  // would create lines nobody in this conversation can dispatch.
  const foreign = products.find((p) => Number(p.seller_user_id) !== seller);
  if (foreign) {
    return { error: "mixed_sellers", message: "A bundle can only hold items from one shop." };
  }
  const gone = products.find((p) => p.is_sold || p.in_stock === false);
  if (gone) {
    return { error: "item_unavailable", message: `"${gone.title}" is no longer available.` };
  }

  const lines = products.map((p) => ({ id: p.id, priceKes: Math.round(Number(p.price_kes) || 0) }));
  const listTotal = bundleListTotal(lines);
  const asked = Math.round(Number(amountKes) || 0);
  const split = apportionBundlePrice(lines, asked);
  if (!split.ok) return { error: split.error, message: split.message };

  return withTransaction(async (client) => {
    // One live negotiation per pair: a second pending bundle would leave both
    // sides unsure which price they had agreed. Supersede rather than reject,
    // because the buyer's newest basket is the one they mean.
    await client.query(
      `UPDATE bundles SET status = 'expired', updated_at = NOW()
        WHERE buyer_user_id = $1 AND seller_user_id = $2
          AND status IN ('pending', 'countered')`,
      [buyer, seller]
    );

    const { rows } = await client.query(
      `INSERT INTO bundles (buyer_user_id, seller_user_id, amount_kes, list_total_kes, status, last_actor, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', 'buyer', NOW() + ($5 || ' hours')::interval)
       RETURNING *`,
      [buyer, seller, asked, listTotal, String(BUNDLE_TTL_HOURS)]
    );
    const bundle = rows[0];

    for (let i = 0; i < lines.length; i++) {
      await client.query(
        `INSERT INTO bundle_items (bundle_id, product_id, list_kes, position)
         VALUES ($1, $2, $3, $4)`,
        [bundle.id, lines[i].id, lines[i].priceKes, i]
      );
    }
    return { success: true, bundle: mapBundle(bundle, await loadItems(bundle.id)) };
  });
}

/** One bundle, with its items. */
export async function getBundle(bundleId) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const id = parseId(bundleId);
  if (!id) return { error: "invalid_bundle", message: "bundleId is required." };
  const { rows } = await query(`SELECT * FROM bundles WHERE id = $1`, [id]);
  if (!rows[0]) return { error: "bundle_not_found", message: "Bundle not found." };
  return { ok: true, bundle: mapBundle(rows[0], await loadItems(id)) };
}

/**
 * Accept, counter or decline.
 *
 * Only the side that did not move last may act, so neither party can accept
 * their own price. Countering keeps the same bundle and flips whose turn it
 * is rather than starting a new negotiation.
 */
export async function respondToBundle({ bundleId, userId, action, amountKes } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const id = parseId(bundleId);
  const actor = parseId(userId);
  if (!id || !actor) {
    return { error: "invalid_bundle", message: "bundleId and userId are required." };
  }
  if (!["accepted", "countered", "declined"].includes(String(action))) {
    return { error: "invalid_action", message: "action must be accepted, countered or declined." };
  }

  return withTransaction(async (client) => {
    // Locked: two taps of Accept must not both succeed.
    const { rows } = await client.query(`SELECT * FROM bundles WHERE id = $1 FOR UPDATE`, [id]);
    const row = rows[0];
    if (!row) return { error: "bundle_not_found", message: "Bundle not found." };

    const isBuyer = Number(row.buyer_user_id) === actor;
    const isSeller = Number(row.seller_user_id) === actor;
    if (!isBuyer && !isSeller) {
      return { error: "not_in_bundle", message: "You are not part of this bundle." };
    }
    if (!["pending", "countered"].includes(row.status)) {
      return { error: "bundle_closed", message: `This bundle is already ${row.status}.` };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE bundles SET status = 'expired', updated_at = NOW() WHERE id = $1`, [id]);
      return { error: "bundle_expired", message: "That bundle offer has expired." };
    }

    const side = isBuyer ? "buyer" : "seller";
    if (row.last_actor === side && action !== "declined") {
      // Declining your own proposal is withdrawing it, which is fine.
      return { error: "not_your_turn", message: "Waiting for the other side to respond." };
    }

    if (action === "countered") {
      const items = await loadItems(id);
      const split = apportionBundlePrice(
        items.map((i) => ({ id: i.productId, priceKes: i.listKes })),
        Math.round(Number(amountKes) || 0)
      );
      if (!split.ok) return { error: split.error, message: split.message };

      const { rows: updated } = await client.query(
        `UPDATE bundles SET amount_kes = $2, status = 'countered', last_actor = $3, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id, split.totalKes, side]
      );
      return { success: true, bundle: mapBundle(updated[0], items) };
    }

    const { rows: updated } = await client.query(
      `UPDATE bundles SET status = $2, last_actor = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, action, side]
    );
    return { success: true, bundle: mapBundle(updated[0], await loadItems(id)) };
  });
}

/**
 * The agreed price split across the items, ready for cart lines.
 *
 * Read at checkout rather than stored at acceptance: the split is derived
 * from frozen list prices and the agreed total, so recomputing it always
 * gives the same answer and there is no second copy to fall out of step.
 */
export async function bundleCartLines(bundleId) {
  const found = await getBundle(bundleId);
  if (found.error) return found;
  const { bundle } = found;
  if (bundle.status !== "accepted") {
    return { error: "bundle_not_accepted", message: "That bundle has not been accepted." };
  }
  const split = apportionBundlePrice(
    bundle.items.map((i) => ({ id: i.productId, priceKes: i.listKes })),
    bundle.amountKes
  );
  if (!split.ok) return { error: split.error, message: split.message };
  return { ok: true, bundle, lines: split.lines };
}
