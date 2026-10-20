/**
 * Scratch-card perks.
 *
 * The seller funds the discount, so the seller picks it. The platform's job
 * is to make sure the perk they pick cannot produce a price that breaks the
 * payout maths, and to be honest with them about what free delivery costs.
 *
 * Three rules, agreed up front:
 *
 *  1. Floor. The discounted price can never fall below KES 100, so a perk
 *     can never produce a zero or negative payout.
 *  2. Expiry. A revealed perk lasts 24 hours. Past that it is gone, so
 *     discounts cannot be hoarded.
 *  3. Free delivery is the seller's money. It comes off their escrow payout
 *     at the real distance-based rate, so they see the range before they send.
 */

import { BASE_FEE_KES, MAX_FEE_KES } from "./rider-distance-fee.js";

/** No discounted price may land below this. */
export const PRICE_FLOOR_KES = 100;
/** How long a revealed perk stays usable. */
export const PERK_TTL_MS = 24 * 60 * 60 * 1000;

export const PERK_TYPES = Object.freeze({
  FREE_DELIVERY: "free_delivery",
  PERCENT_OFF: "percent_off",
  AMOUNT_OFF: "amount_off",
});

/**
 * The most a perk may take off, given the item price.
 * Never negative: an item already at or below the floor simply has no room.
 */
export function maxDiscountFor(itemPriceKes) {
  const price = Math.round(Number(itemPriceKes) || 0);
  return Math.max(0, price - PRICE_FLOOR_KES);
}

/**
 * What the seller is told free delivery will cost them.
 *
 * A range rather than a number, because the fee depends on the distance to a
 * buyer who has not chosen yet. Quoting one figure would be a guess presented
 * as a fact.
 */
export function deliveryCostNotice() {
  return (
    `Free delivery is paid from your escrow payout. It costs ` +
    `KES ${BASE_FEE_KES.toLocaleString("en-US")}–${MAX_FEE_KES.toLocaleString("en-US")} ` +
    `depending on how far the rider goes.`
  );
}

/**
 * Check a perk a seller is about to send.
 *
 * @param {{type:string, percent?:number, amountKes?:number}} perk
 * @param {number} itemPriceKes
 * @returns {{ok:true, perk:object, discountKes:number, finalKes:number}
 *          |{ok:false, error:string, message:string}}
 */
export function validatePerk(perk, itemPriceKes) {
  const price = Math.round(Number(itemPriceKes) || 0);
  if (price <= 0) {
    return { ok: false, error: "no_price", message: "That item has no price." };
  }

  const type = String(perk?.type || "");
  const room = maxDiscountFor(price);

  if (type === PERK_TYPES.FREE_DELIVERY) {
    // Costs the seller, not the buyer's item price, so the floor does not
    // apply and there is nothing to cap here.
    return {
      ok: true,
      perk: { type, label: "Free delivery" },
      discountKes: 0,
      finalKes: price,
    };
  }

  if (room <= 0) {
    return {
      ok: false,
      error: "no_room",
      message: `This item is only KES ${price.toLocaleString("en-US")} — too low to discount. Offer free delivery instead.`,
    };
  }

  if (type === PERK_TYPES.PERCENT_OFF) {
    const pct = Math.round(Number(perk?.percent) || 0);
    if (pct < 1 || pct > 90) {
      return { ok: false, error: "bad_percent", message: "Pick between 1% and 90%." };
    }
    // Rounded down, so a percentage can never take a shilling more than it says.
    const wanted = Math.floor((price * pct) / 100);
    const discountKes = Math.min(wanted, room);
    return {
      ok: true,
      perk: { type, percent: pct, label: `${pct}% off` },
      discountKes,
      finalKes: price - discountKes,
      capped: discountKes < wanted,
    };
  }

  if (type === PERK_TYPES.AMOUNT_OFF) {
    const amount = Math.round(Number(perk?.amountKes) || 0);
    if (amount < 1) {
      return { ok: false, error: "bad_amount", message: "Enter an amount to take off." };
    }
    if (amount > room) {
      return {
        ok: false,
        error: "below_floor",
        message: `Most you can take off this item is KES ${room.toLocaleString("en-US")} — the price can't drop below KES ${PRICE_FLOOR_KES}.`,
      };
    }
    return {
      ok: true,
      perk: { type, amountKes: amount, label: `KES ${amount.toLocaleString("en-US")} off` },
      discountKes: amount,
      finalKes: price - amount,
    };
  }

  return { ok: false, error: "unknown_perk", message: "Pick one of the offered perks." };
}

/** Has a revealed perk run out? Unrevealed cards do not expire. */
export function isPerkExpired(revealedAt, now = Date.now()) {
  if (!revealedAt) return false;
  const at = new Date(revealedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return now - at > PERK_TTL_MS;
}

/** Time left on a revealed perk, in whole minutes. Zero once gone. */
export function perkMinutesLeft(revealedAt, now = Date.now()) {
  if (!revealedAt) return Math.round(PERK_TTL_MS / 60000);
  const at = new Date(revealedAt).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.round((PERK_TTL_MS - (now - at)) / 60000));
}
