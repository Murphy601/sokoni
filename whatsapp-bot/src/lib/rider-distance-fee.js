/**
 * Distance pricing for local boda deliveries.
 *
 * Replaces the seller's flat shipping rate on LOCAL_RIDER orders only.
 * Upcountry courier orders keep the vendor's county tiers — no rider is
 * involved there, so distance means nothing.
 *
 * The fee the buyer pays at checkout is the same number the rider is paid
 * from at dispatch, so escrow always balances. Never price this at dispatch.
 */

/** Charged on every local delivery, however short. */
export const BASE_FEE_KES = 350;
/** Road kilometres covered by the base fee. */
export const INCLUDED_KM = 5;
/** Charged per road kilometre past INCLUDED_KM. */
export const PER_KM_KES = 25;
/**
 * Ceiling. Sits under RIDER_SINGLE_FEE_MANUAL_KES (1500) on purpose: a fee
 * above that drops the payout into NEEDS_APPROVAL and makes ops clear it by
 * hand, which must not happen just because a delivery was long.
 */
export const MAX_FEE_KES = 1200;
/**
 * Straight-line to road distance. Haversine cuts through buildings; Nairobi
 * road distance runs roughly a third longer, and the rider covers the road.
 */
export const ROAD_FACTOR = 1.3;
/** Fees are quoted in round tens — nobody prices a delivery at 487. */
const ROUND_TO = 10;

/** @param {number} straightLineKm @returns {number} road km, 2dp */
export function roadKm(straightLineKm) {
  const km = Number(straightLineKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  return Math.round(km * ROAD_FACTOR * 100) / 100;
}

/**
 * Fee for a delivery of a known road distance.
 * @param {number} km road kilometres; negative or non-finite is treated as 0
 * @returns {number} KES, never below BASE_FEE_KES, never above MAX_FEE_KES
 */
export function feeForRoadKm(km) {
  const d = Number(km);
  const billable = Number.isFinite(d) && d > INCLUDED_KM ? d - INCLUDED_KM : 0;
  const raw = BASE_FEE_KES + billable * PER_KM_KES;
  const rounded = Math.round(raw / ROUND_TO) * ROUND_TO;
  return Math.min(MAX_FEE_KES, Math.max(BASE_FEE_KES, rounded));
}

/**
 * Price one local delivery.
 *
 * Missing or unusable coordinates are not an error: the order still goes
 * through at the minimum. Undercharging a long trip is recoverable (ops can
 * adjust before dispatch); blocking checkout is not.
 *
 * @param {{lat:number,lng:number}|null} pickup seller
 * @param {{lat:number,lng:number}|null} dropoff buyer
 * @param {(a:number,b:number,c:number,d:number)=>number} distanceMeters haversine
 * @returns {{feeKes:number, straightLineKm:number|null, roadKm:number|null, basis:string}}
 */
export function priceLocalDelivery(pickup, dropoff, distanceMeters) {
  const ok = (p) =>
    p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  if (!ok(pickup) || !ok(dropoff) || typeof distanceMeters !== "function") {
    return { feeKes: BASE_FEE_KES, straightLineKm: null, roadKm: null, basis: "MINIMUM_NO_COORDS" };
  }

  const metres = Number(
    distanceMeters(Number(pickup.lat), Number(pickup.lng), Number(dropoff.lat), Number(dropoff.lng))
  );
  if (!Number.isFinite(metres) || metres < 0) {
    return { feeKes: BASE_FEE_KES, straightLineKm: null, roadKm: null, basis: "MINIMUM_NO_COORDS" };
  }

  const straight = Math.round((metres / 1000) * 100) / 100;
  const road = roadKm(straight);
  const feeKes = feeForRoadKm(road);
  return {
    feeKes,
    straightLineKm: straight,
    roadKm: road,
    basis: feeKes === MAX_FEE_KES && road > INCLUDED_KM ? "DISTANCE_CAPPED" : "DISTANCE",
  };
}

/** One line for the buyer at checkout and the rider on the job card. */
export function describeFee(quote) {
  if (!quote || quote.basis === "MINIMUM_NO_COORDS") {
    return `KES ${BASE_FEE_KES} delivery (minimum — no map pin)`;
  }
  return `KES ${quote.feeKes.toLocaleString()} delivery (~${quote.roadKm} km)`;
}
