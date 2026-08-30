/**
 * Render seller trust badges + rating line from API payload (sellerTrust / stats.trust).
 * Badge rules live on the bot (seller-badges.js) — UI only displays.
 */
(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function trustFrom(source) {
    return source?.sellerTrust || source?.trust || source || {};
  }

  function resolveBadges(source, { max = 3 } = {}) {
    const trust = trustFrom(source);
    const badges = Array.isArray(trust.badges) ? trust.badges : [];
    if (badges.length) return badges.slice(0, max);
    // Lightweight fallback when only a verified flag is present.
    if (source?.isSellerVerified || trust.isSellerVerified) {
      return [{ id: "verified", label: "Verified", icon: "verified" }];
    }
    // Always surface ladder state so cards aren't blank.
    if (trust.badgeTier || source?.sellerHandle || source?.shopHandle) {
      return [{ id: "newbie", label: "Newbie", icon: "newbie" }];
    }
    return [];
  }

  function badgesHtml(source, { max = 3, className = "seller-trust-badges" } = {}) {
    const badges = resolveBadges(source, { max });
    if (!badges.length) return "";
    return `<span class="${escapeHtml(className)}" aria-label="Seller trust">${badges
      .map(
        (b) =>
          `<span class="seller-trust-badge seller-trust-badge--${escapeHtml(b.id || "info")}">${escapeHtml(
            b.label || ""
          )}</span>`
      )
      .join("")}</span>`;
  }

  /**
   * ★ 4.8 (42) or UNRATED / New store — never invent a public score under 5 reviews.
   */
  function ratingHtml(source, { className = "seller-rating-line" } = {}) {
    const trust = trustFrom(source);
    const count = Number(trust.totalReviews ?? source?.reviews ?? 0) || 0;
    const unrated =
      Boolean(trust.unrated) ||
      trust.displayLabel === "UNRATED" ||
      count < 5;
    if (unrated) {
      const label =
        count > 0
          ? `UNRATED · ${count.toLocaleString()} review${count === 1 ? "" : "s"}`
          : "New store · UNRATED";
      return `<span class="${escapeHtml(className)} seller-rating-line--unrated">${escapeHtml(
        label
      )}</span>`;
    }
    const avg = Number(trust.avgRating ?? source?.rating) || 0;
    return `<span class="${escapeHtml(className)}" aria-label="Seller rating ${avg.toFixed(
      1
    )} from ${count} reviews"><span class="seller-rating-stars">★ ${avg.toFixed(
      1
    )}</span> <span class="seller-rating-count">(${count.toLocaleString()})</span></span>`;
  }

  window.SokoniSellerTrust = { resolveBadges, badgesHtml, ratingHtml };
})();
