/**
 * Seller-pinned shop items — slot arithmetic.
 *
 * Kept free of DB calls so the rules are testable on their own. A seller gets
 * three slots on /shop/@handle; the repository layer enforces the same limit
 * with a partial unique index, this layer decides which slot a pin lands in.
 */

export const MAX_SHOP_PINS = 3;

/**
 * @typedef {{ productId: string, rank: number }} Pin
 */

/** Normalise and sort whatever the DB handed back. */
export function normalizePins(pins = []) {
  return (Array.isArray(pins) ? pins : [])
    .map((p) => ({
      productId: String(p?.productId || p?.product_id || "").trim(),
      rank: Number(p?.rank ?? p?.pin_rank),
    }))
    .filter((p) => p.productId && Number.isInteger(p.rank) && p.rank >= 1 && p.rank <= MAX_SHOP_PINS)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Work out the slot a pin should occupy.
 *
 * Re-pinning something already pinned is a move, not a new pin, so it never
 * counts against the limit. An explicit rank that is already taken swaps the
 * two products rather than silently dropping one.
 *
 * @param {{ currentPins?: Pin[], productId: string, requestedRank?: number|null }} input
 * @returns {{ ok: true, rank: number, moves: Pin[] } | { ok: false, error: string, message: string }}
 */
export function resolvePinSlot({ currentPins = [], productId, requestedRank = null } = {}) {
  const id = String(productId || "").trim();
  if (!id) {
    return { ok: false, error: "missing_product", message: "No listing given to pin." };
  }

  const pins = normalizePins(currentPins);
  const existing = pins.find((p) => p.productId === id) || null;

  let rank = null;
  if (requestedRank != null && requestedRank !== "") {
    const asked = Number(requestedRank);
    if (!Number.isInteger(asked) || asked < 1 || asked > MAX_SHOP_PINS) {
      return {
        ok: false,
        error: "bad_rank",
        message: `Pin slot must be 1, 2 or ${MAX_SHOP_PINS}.`,
      };
    }
    rank = asked;
  }

  if (rank == null) {
    if (existing) return { ok: true, rank: existing.rank, moves: [] };
    const taken = new Set(pins.map((p) => p.rank));
    for (let i = 1; i <= MAX_SHOP_PINS; i += 1) {
      if (!taken.has(i)) {
        rank = i;
        break;
      }
    }
    if (rank == null) {
      return {
        ok: false,
        error: "pins_full",
        message: `You already have ${MAX_SHOP_PINS} pinned items. Unpin one first, or pass a slot to replace it.`,
      };
    }
    return { ok: true, rank, moves: [] };
  }

  // Explicit slot: if someone else holds it, swap rather than evict.
  const occupant = pins.find((p) => p.rank === rank && p.productId !== id) || null;
  const moves = [];
  if (occupant) {
    if (existing) {
      moves.push({ productId: occupant.productId, rank: existing.rank });
    } else {
      moves.push({ productId: occupant.productId, rank: 0 });
    }
  }
  return { ok: true, rank, moves };
}

/**
 * Can this listing be pinned at all?
 * Sold or hidden stock on the pinned shelf is worse than an empty shelf.
 *
 * @param {{ isSold?: boolean, inStock?: boolean, stockQuantity?: number }} product
 */
export function isPinnable(product = {}) {
  if (product.isSold === true) {
    return { ok: false, error: "sold", message: "Sold items cannot be pinned." };
  }
  if (product.inStock === false) {
    return { ok: false, error: "out_of_stock", message: "Out-of-stock items cannot be pinned." };
  }
  if (product.stockQuantity != null && Number(product.stockQuantity) <= 0) {
    return { ok: false, error: "out_of_stock", message: "Out-of-stock items cannot be pinned." };
  }
  return { ok: true };
}

/**
 * Renumber to 1..n with no gaps, preserving order. Used after an unpin so the
 * shelf never shows a hole.
 *
 * @param {Pin[]} pins
 * @returns {Pin[]}
 */
export function compactPins(pins = []) {
  return normalizePins(pins).map((p, idx) => ({ productId: p.productId, rank: idx + 1 }));
}
