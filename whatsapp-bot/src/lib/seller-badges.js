/**
 * Derived seller trust badges — rolling-window rating + volume tiers.
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
 *   unrated?: boolean,
 *   disputeCount?: number,
 *   unresolvedDisputes?: number,
 *   previousTier?: string,
 *   badgeTier?: string,
 * }} stats
 */
export function deriveSellerBadges(stats = {}) {
  const completed = Number(stats.completedOrders ?? stats.salesCount ?? 0) || 0;
  const rating = Number(stats.avgRating || 0);
  const derived = deriveBadgeTier({
    completedOrders: completed,
    rating,
    unrated: Boolean(stats.unrated),
    isVerified: Boolean(stats.isSellerVerified),
    disputeCount: Number(stats.disputeCount || 0),
    unresolvedDisputes: Number(stats.unresolvedDisputes || 0),
    previousTier: stats.previousTier || stats.badgeTier || "",
  });

  const badges = [...derived.badges];
  const dispatchH =
    stats.avgDispatchHours != null ? Number(stats.avgDispatchHours) : null;
  if (Number.isFinite(dispatchH) && dispatchH > 0 && dispatchH <= 4 && completed >= 3) {
    if (!badges.some((b) => b.id === "fast_dispatcher")) {
      badges.splice(1, 0, {
        id: "fast_dispatcher",
        label: "⚡ Quick Shipper",
        emoji: "⚡",
        icon: "fast",
      });
    }
  }
  return badges;
}

export function sellerTrustPayload(stats = {}) {
  const salesCount = Number(stats.salesCount ?? stats.completedOrders ?? 0);
  const totalReviews = Number(stats.totalReviews || 0);
  const unrated = Boolean(stats.unrated) || totalReviews < 5;
  const avgRating = clampRating(Number(stats.avgRating || 0));
  const avgDispatchHours =
    stats.avgDispatchHours != null && Number.isFinite(Number(stats.avgDispatchHours))
      ? Number(stats.avgDispatchHours)
      : null;
  const isVerifiedStore = Boolean(stats.isSellerVerified || stats.isVerifiedStore);

  const badges = deriveSellerBadges({
    isSellerVerified: isVerifiedStore,
    salesCount,
    completedOrders: salesCount,
    avgDispatchHours,
    avgRating,
    totalReviews,
    unrated,
    disputeCount: stats.disputeCount,
    unresolvedDisputes: stats.unresolvedDisputes,
    previousTier: stats.badgeTier || stats.previousTier,
  });

  // Performance tier chip (exclude trust / sales / fast for primary tier id)
  const performance = badges.find((b) =>
    ["legend", "top_rated", "verified", "newbie"].includes(b.id)
  );

  return {
    isSellerVerified: isVerifiedStore,
    isVerifiedStore,
    salesCount,
    totalReviews,
    unrated,
    avgRating: unrated ? 0 : avgRating,
    displayLabel: unrated ? "UNRATED" : avgRating.toFixed(1),
    avgDispatchHours,
    badgeTier: performance?.id || "newbie",
    badges,
  };
}
