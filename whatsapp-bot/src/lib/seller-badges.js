/**
 * Derived seller trust badges — weighted rating + volume tiers.
 * Rules: Newbie → Verified (≥10, ≥4.0, ID) → Top Rated (≥50, ≥4.7, dispute&lt;2%) → Legend (≥200, ≥4.9).
 */
import { deriveBadgeTier, clampRating } from "./weighted-rating.js";

/**
 * @param {{
 *   isSellerVerified?: boolean,
 *   salesCount?: number,
 *   completedOrders?: number,
 *   avgDispatchHours?: number|null,
 *   avgRating?: number,
 *   totalReviews?: number,
 *   disputeCount?: number,
 *   unresolvedDisputes?: number,
 *   previousTier?: string,
 *   badgeTier?: string,
 * }} stats
 * @returns {{ id: string, label: string, icon: string }[]}
 */
export function deriveSellerBadges(stats = {}) {
  const completed =
    Number(stats.completedOrders ?? stats.salesCount ?? 0) || 0;
  const rating = Number(stats.avgRating || 0);
  const derived = deriveBadgeTier({
    completedOrders: completed,
    rating,
    isVerified: Boolean(stats.isSellerVerified),
    disputeCount: Number(stats.disputeCount || 0),
    unresolvedDisputes: Number(stats.unresolvedDisputes || 0),
    previousTier: stats.previousTier || stats.badgeTier || "",
  });

  // Keep fast_dispatcher as an extra signal when dispatch hours known
  const badges = [...derived.badges];
  const dispatchH =
    stats.avgDispatchHours != null ? Number(stats.avgDispatchHours) : null;
  if (Number.isFinite(dispatchH) && dispatchH > 0 && dispatchH <= 4 && completed >= 3) {
    if (!badges.some((b) => b.id === "fast_dispatcher")) {
      badges.splice(1, 0, {
        id: "fast_dispatcher",
        label: "Fast dispatcher",
        icon: "fast",
      });
    }
  }

  return badges;
}

/**
 * Public payload for shop / product cards.
 */
export function sellerTrustPayload(stats = {}) {
  const salesCount = Number(stats.salesCount ?? stats.completedOrders ?? 0);
  const totalReviews = Number(stats.totalReviews || 0);
  const avgRating = clampRating(Number(stats.avgRating || 0));
  const avgDispatchHours =
    stats.avgDispatchHours != null && Number.isFinite(Number(stats.avgDispatchHours))
      ? Number(stats.avgDispatchHours)
      : null;

  const badges = deriveSellerBadges({
    isSellerVerified: stats.isSellerVerified,
    salesCount,
    completedOrders: salesCount,
    avgDispatchHours,
    avgRating,
    totalReviews,
    disputeCount: stats.disputeCount,
    unresolvedDisputes: stats.unresolvedDisputes,
    previousTier: stats.badgeTier || stats.previousTier,
  });

  return {
    isSellerVerified: Boolean(stats.isSellerVerified),
    salesCount,
    totalReviews,
    avgRating: totalReviews > 0 || avgRating > 0 ? avgRating : 0,
    avgDispatchHours,
    badgeTier: badges[0]?.id || "newbie",
    badges,
  };
}
