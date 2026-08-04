/**
 * Derived seller trust badges (Feature 3).
 * Verified = WhatsApp OTP / seller flag (not full KYC yet).
 */

/**
 * @param {{
 *   isSellerVerified?: boolean,
 *   salesCount?: number,
 *   avgDispatchHours?: number|null,
 *   avgRating?: number,
 *   totalReviews?: number,
 * }} stats
 * @returns {{ id: string, label: string, icon: string }[]}
 */
export function deriveSellerBadges(stats = {}) {
  const badges = [];
  const sales = Number(stats.salesCount || 0);
  const reviews = Number(stats.totalReviews || 0);
  const rating = Number(stats.avgRating || 0);
  const dispatchH = stats.avgDispatchHours != null ? Number(stats.avgDispatchHours) : null;

  if (stats.isSellerVerified) {
    badges.push({ id: "verified", label: "Verified seller", icon: "verified" });
  }

  if (Number.isFinite(dispatchH) && dispatchH > 0 && dispatchH <= 4 && sales >= 3) {
    badges.push({ id: "fast_dispatcher", label: "Fast dispatcher", icon: "fast" });
  }

  if (rating >= 4.5 && reviews >= 5) {
    badges.push({
      id: "top_rated",
      label: `★ ${rating.toFixed(1)} (${reviews} reviews)`,
      icon: "rating",
    });
  } else if (rating >= 4.8 && reviews >= 20) {
    badges.push({ id: "top_seller", label: "Top seller", icon: "top" });
  }

  if (sales >= 1) {
    badges.push({
      id: "sales",
      label: `${sales.toLocaleString()} sold`,
      icon: "sales",
    });
  }

  return badges;
}

/**
 * Public payload for shop / product cards.
 */
export function sellerTrustPayload(stats = {}) {
  const salesCount = Number(stats.salesCount || 0);
  const totalReviews = Number(stats.totalReviews || 0);
  const avgRating = Number(stats.avgRating || 0);
  const avgDispatchHours =
    stats.avgDispatchHours != null && Number.isFinite(Number(stats.avgDispatchHours))
      ? Number(stats.avgDispatchHours)
      : null;

  return {
    isSellerVerified: Boolean(stats.isSellerVerified),
    salesCount,
    totalReviews,
    avgRating: totalReviews > 0 ? avgRating : 0,
    avgDispatchHours,
    badges: deriveSellerBadges({
      isSellerVerified: stats.isSellerVerified,
      salesCount,
      avgDispatchHours,
      avgRating,
      totalReviews,
    }),
  };
}
