/**
 * Cumulative weighted rating + Sokoni badge tiers.
 * NewRating = (current × count + newStars) / (count + 1)
 * Bonuses/penalties are additive deltas (review count unchanged).
 */

export const RATING_BOUNDS = { min: 0, max: 5 };

export const RATING_DELTAS = Object.freeze({
  /** Dispute-free order completion (seller). */
  COMPLETION_BONUS: 0.05,
  /** Rider arrived within delivery window. */
  ON_TIME_RIDER: 0.02,
  /** Buyer-won dispute (seller). */
  BUYER_WON_DISPUTE: -0.5,
  /** Seller cancelled an accepted order. */
  SELLER_CANCEL: -0.3,
  /** Rider late pickup / no-show. */
  RIDER_LATE: -0.2,
});

/** Demote Top Rated / Legend when score falls below this. */
export const BADGE_DEMOTION_FLOOR = 4.5;

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
 * Weighted average for a new 1–5 star review.
 * @param {number} currentRating
 * @param {number} totalReviews
 * @param {number} newStars 1–5
 */
export function applyWeightedStar(currentRating, totalReviews, newStars) {
  const stars = Number(newStars);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    throw new Error("newStars must be between 1 and 5");
  }
  const count = Math.max(0, Math.floor(Number(totalReviews) || 0));
  // First review always starts from 0 pool (ignore legacy default 5.0 with count 0).
  const current = count === 0 ? 0 : Number(currentRating) || 0;
  const next = (current * count + stars) / (count + 1);
  return {
    rating: clampRating(next),
    reviewCount: count + 1,
  };
}

/**
 * Additive bonus/penalty — does not change review count.
 * @param {number} currentRating
 * @param {number} delta
 * @param {number} [totalReviews]
 */
export function applyRatingDelta(currentRating, delta, totalReviews = 0) {
  const count = Math.max(0, Math.floor(Number(totalReviews) || 0));
  const base = count === 0 && !(Number(currentRating) > 0) ? 0 : Number(currentRating) || 0;
  return {
    rating: clampRating(base + Number(delta || 0)),
    reviewCount: count,
  };
}

/**
 * Dispute rate = disputes / completed orders (0 if no completions).
 */
export function disputeRate(disputeCount, completedOrders) {
  const done = Math.max(0, Number(completedOrders) || 0);
  if (done <= 0) return 0;
  return Math.max(0, Number(disputeCount) || 0) / done;
}

/**
 * Badge tier ladder (sellers & riders share the same thresholds).
 * @param {{
 *   completedOrders?: number,
 *   rating?: number,
 *   isVerified?: boolean,
 *   disputeCount?: number,
 *   unresolvedDisputes?: number,
 *   previousTier?: string,
 * }} stats
 */
export function deriveBadgeTier(stats = {}) {
  const completed = Math.max(0, Number(stats.completedOrders) || 0);
  const rating = clampRating(stats.rating || 0);
  const verified = Boolean(stats.isVerified);
  const disputes = Math.max(0, Number(stats.disputeCount) || 0);
  const unresolved = Math.max(0, Number(stats.unresolvedDisputes) || 0);
  const dRate = disputeRate(disputes, completed);
  const previous = String(stats.previousTier || "").toLowerCase().trim();
  const prev = previous;

  /** @type {{ id: string, label: string, icon: string, privileges?: string }[]} */
  const badges = [];
  let tier = "newbie";

  const legendOk =
    completed >= 200 && rating >= 4.9 && unresolved === 0;
  const topOk =
    completed >= 50 && rating >= 4.7 && dRate < 0.02;
  const verifiedOk = completed >= 10 && rating >= 4.0 && verified;

  // Demotion: Top Rated / Legend paused if score < 4.5
  const demoted =
    (prev === "top_rated" || prev === "legend" || prev === "power_seller") &&
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
      privileges: "reduced_commission_priority_search",
    });
  } else if (verifiedOk) {
    tier = "verified";
    badges.push({
      id: "verified",
      label: "Verified",
      icon: "verified",
      privileges: "verified_checkmark",
    });
  } else {
    tier = "newbie";
    badges.push({
      id: "newbie",
      label: "Newbie",
      icon: "newbie",
      privileges: "standard_commission",
    });
  }

  // Always surface sold count when useful
  if (completed >= 1 && tier !== "newbie") {
    badges.push({
      id: "sales",
      label: `${completed.toLocaleString()} sold`,
      icon: "sales",
    });
  } else if (completed >= 1 && !badges.some((b) => b.id === "sales")) {
    badges.push({
      id: "sales",
      label: `${completed.toLocaleString()} sold`,
      icon: "sales",
    });
  }

  const demotionNotice =
    demoted && (prev === "top_rated" || prev === "power_seller" || prev === "legend")
      ? `Alert: Your rating dropped to ${rating.toFixed(1)}. Your ${
          prev === "legend" ? "Sokoni Legend" : "Power Seller"
        } badge has been paused until your score reaches 4.7 again.`
      : null;

  return {
    tier,
    badges,
    demoted: Boolean(demoted),
    demotionNotice,
    rating,
    completedOrders: completed,
    disputeRate: Math.round(dRate * 10000) / 10000,
  };
}

/** @deprecated alias — prefer deriveBadgeTier */
export function deriveTrustBadges(stats) {
  return deriveBadgeTier(stats).badges;
}
