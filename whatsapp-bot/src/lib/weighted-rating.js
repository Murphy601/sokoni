/**
 * Rolling-window ratings (last 100) + Sokoni badge tiers.
 *
 * DisplayedRating = sum(last 100 pool entries) / count(up to 100)
 *
 * New profiles start at 5.0 but are UNRATED until MIN_PUBLIC_REVIEWS buyer stars.
 * Penalties/bonuses push a synthetic value into the same pool so they dilute over time.
 */

export const RATING_BOUNDS = { min: 0, max: 5 };
export const ROLLING_WINDOW = 100;
/** Hide numeric score on site until this many buyer star reviews. */
export const MIN_PUBLIC_REVIEWS = 5;
/** Default grace score before any pool entries. */
export const INITIAL_RATING = 5;

export const RATING_DELTAS = Object.freeze({
  COMPLETION_BONUS: 0.05,
  ON_TIME_RIDER: 0.02,
  BUYER_WON_DISPUTE: -0.5,
  SELLER_CANCEL: -0.3,
  RIDER_LATE: -0.2,
});

export const BADGE_DEMOTION_FLOOR = 4.5;
/** Verified merchant/rider minimum displayed rating. */
export const VERIFIED_MIN_RATING = 4.2;

/**
 * @param {number} value
 * @returns {number}
 */
export function clampRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return RATING_BOUNDS.min;
  return Math.round(Math.min(RATING_BOUNDS.max, Math.max(RATING_BOUNDS.min, n)) * 100) / 100;
}

/**
 * Normalize a stored pool to [{ v, kind, at, id? }, ...] (newest last).
 * @param {unknown} raw
 * @returns {{ v: number, kind: string, at: string, id?: string, orderRef?: string }[]}
 */
export function normalizePool(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === "number" && Number.isFinite(item)) {
      out.push({ v: clampRating(item), kind: "star", at: new Date(0).toISOString() });
      continue;
    }
    if (typeof item === "object") {
      const v = Number(item.v ?? item.value ?? item.stars);
      if (!Number.isFinite(v)) continue;
      out.push({
        v: clampRating(v),
        kind: String(item.kind || "star"),
        at: String(item.at || new Date().toISOString()),
        id: item.id ? String(item.id) : undefined,
        orderRef: item.orderRef ? String(item.orderRef) : undefined,
      });
    }
  }
  return out.slice(-ROLLING_WINDOW);
}

/**
 * Mean of last N pool values (up to ROLLING_WINDOW).
 * Empty pool → INITIAL_RATING with unrated=true.
 */
export function scoreFromPool(poolInput) {
  const pool = normalizePool(poolInput);
  const window = pool.slice(-ROLLING_WINDOW);
  const buyerStars = window.filter((e) => e.kind === "star").length;
  if (!window.length) {
    return {
      rating: INITIAL_RATING,
      reviewCount: 0,
      buyerReviewCount: 0,
      unrated: true,
      displayLabel: "UNRATED",
      pool: [],
    };
  }
  const sum = window.reduce((acc, e) => acc + e.v, 0);
  const rating = clampRating(sum / window.length);
  const unrated = buyerStars < MIN_PUBLIC_REVIEWS;
  return {
    rating,
    reviewCount: window.length,
    buyerReviewCount: buyerStars,
    unrated,
    displayLabel: unrated ? "UNRATED" : rating.toFixed(2),
    pool: window,
  };
}

/**
 * Push a buyer star (1–5) into the rolling pool.
 */
export function pushStarToPool(poolInput, stars, meta = {}) {
  const starsN = Number(stars);
  if (!Number.isFinite(starsN) || starsN < 1 || starsN > 5) {
    throw new Error("stars must be between 1 and 5");
  }
  const pool = normalizePool(poolInput);
  pool.push({
    v: clampRating(starsN),
    kind: "star",
    at: new Date().toISOString(),
    id: meta.id || `s_${Date.now()}`,
    orderRef: meta.orderRef,
  });
  const trimmed = pool.slice(-ROLLING_WINDOW);
  return { ...scoreFromPool(trimmed), pool: trimmed };
}

/**
 * Push a system penalty/bonus into the pool as a synthetic rating near current ± delta.
 * Dilutes naturally once 100 newer entries arrive.
 */
export function pushDeltaToPool(poolInput, delta, meta = {}) {
  const current = scoreFromPool(poolInput);
  const synthetic = clampRating(current.rating + Number(delta || 0));
  const pool = normalizePool(poolInput);
  pool.push({
    v: synthetic,
    kind: Number(delta) >= 0 ? "bonus" : "penalty",
    at: new Date().toISOString(),
    id: meta.id || `d_${Date.now()}`,
    orderRef: meta.orderRef,
  });
  const trimmed = pool.slice(-ROLLING_WINDOW);
  return { ...scoreFromPool(trimmed), pool: trimmed };
}

/**
 * Remove a pool entry by id and recalc (Boss purge unfair review).
 */
export function purgePoolEntry(poolInput, entryId) {
  const id = String(entryId || "");
  const pool = normalizePool(poolInput).filter((e) => e.id !== id);
  return { ...scoreFromPool(pool), pool, purged: Boolean(id) };
}

/** @deprecated — use pushStarToPool; kept for transitional imports */
export function applyWeightedStar(currentRating, totalReviews, newStars) {
  const count = Math.max(0, Math.floor(Number(totalReviews) || 0));
  const pool = [];
  if (count > 0) {
    const cur = Number(currentRating) || INITIAL_RATING;
    for (let i = 0; i < Math.min(count, ROLLING_WINDOW); i++) pool.push(cur);
  }
  return pushStarToPool(pool, newStars);
}

/** @deprecated — use pushDeltaToPool */
export function applyRatingDelta(currentRating, delta, totalReviews = 0) {
  const count = Math.max(0, Math.floor(Number(totalReviews) || 0));
  const pool = [];
  const cur = count === 0 ? INITIAL_RATING : Number(currentRating) || INITIAL_RATING;
  for (let i = 0; i < Math.min(count, ROLLING_WINDOW); i++) pool.push({ v: cur, kind: "star", at: "" });
  return pushDeltaToPool(pool, delta);
}

export function disputeRate(disputeCount, completedOrders) {
  const done = Math.max(0, Number(completedOrders) || 0);
  if (done <= 0) return 0;
  return Math.max(0, Number(disputeCount) || 0) / done;
}

/**
 * Badge tier ladder.
 */
export function deriveBadgeTier(stats = {}) {
  const completed = Math.max(0, Number(stats.completedOrders) || 0);
  const rating = clampRating(stats.rating || 0);
  const verified = Boolean(stats.isVerified);
  const disputes = Math.max(0, Number(stats.disputeCount) || 0);
  const unresolved = Math.max(0, Number(stats.unresolvedDisputes) || 0);
  const dRate = disputeRate(disputes, completed);
  const prev = String(stats.previousTier || "").toLowerCase().trim();
  const unrated = Boolean(stats.unrated);

  /** @type {{ id: string, label: string, icon: string, privileges?: string }[]} */
  const badges = [];
  let tier = "newbie";

  const effectiveRating = unrated ? 0 : rating;

  const legendOk = completed >= 200 && effectiveRating >= 4.9 && unresolved === 0;
  const topOk = completed >= 50 && effectiveRating >= 4.7 && dRate < 0.02;
  const verifiedOk =
    completed >= 10 && effectiveRating >= VERIFIED_MIN_RATING && verified;

  const demoted =
    (prev === "top_rated" || prev === "legend" || prev === "power_seller") &&
    !unrated &&
    rating < BADGE_DEMOTION_FLOOR;

  if (legendOk && !demoted) {
    tier = "legend";
    badges.push({
      id: "legend",
      label: "Sokoni Legend",
      icon: "legend",
      privileges: "instant_escrow_featured",
    });
  } else if (topOk && !demoted) {
    tier = "top_rated";
    badges.push({
      id: "top_rated",
      label: `Top Rated ★ ${rating.toFixed(1)}`,
      icon: "rating",
      privileges: "reduced_commission_4pct",
    });
  } else if (verifiedOk) {
    tier = "verified";
    badges.push({
      id: "verified",
      label: "Verified",
      icon: "verified",
      privileges: "verified_checkmark_rank_boost",
    });
  } else {
    tier = "newbie";
    badges.push({
      id: "newbie",
      label: "Newbie",
      icon: "newbie",
      privileges: "standard_commission_5pct",
    });
  }

  if (completed >= 1 && !badges.some((b) => b.id === "sales")) {
    badges.push({
      id: "sales",
      label: `${completed.toLocaleString()} sold`,
      icon: "sales",
    });
  }

  const demotionNotice =
    demoted && (prev === "top_rated" || prev === "power_seller" || prev === "legend")
      ? `Alert: Your score dropped to ${rating.toFixed(1)}. Your Top Rated badge has been paused until your rating reaches 4.7 again.`
      : null;

  return {
    tier,
    badges,
    demoted: Boolean(demoted),
    demotionNotice,
    rating,
    unrated,
    completedOrders: completed,
    disputeRate: Math.round(dRate * 10000) / 10000,
  };
}

export function deriveTrustBadges(stats) {
  return deriveBadgeTier(stats).badges;
}
