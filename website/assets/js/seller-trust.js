/**
 * Render seller trust badges + rating line from API payload (sellerTrust / stats.trust).
 * Performance tier (🐣/🌟/👑) is separate from 🔷 VERIFIED STORE trust chip.
 */
(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const TIER_EMOJI = {
    newbie: "🐣",
    verified: "🛡️",
    rising: "🛡️",
    top_rated: "🌟",
    legend: "👑",
    verified_store: "🔷",
    fast_dispatcher: "⚡",
    sales: "📦",
  };

  function trustFrom(source) {
    return source?.sellerTrust || source?.trust || source || {};
  }

  function withEmojiLabel(badge) {
    const id = String(badge?.id || "");
    const emoji = badge?.emoji || TIER_EMOJI[id] || "";
    let label = String(badge?.label || "");
    if (emoji && !label.includes(emoji)) label = `${emoji} ${label}`.trim();
    // Canonical trust label
    if (id === "verified_store") label = "🔷 VERIFIED STORE";
    if (id === "newbie" && !/🐣|New Store/i.test(label)) label = "🐣 New Store";
    return label;
  }

  function resolveBadges(source, { max = 4 } = {}) {
    const trust = trustFrom(source);
    let badges = Array.isArray(trust.badges) ? [...trust.badges] : [];

    const verifiedStore = Boolean(
      source?.isSellerVerified ||
        trust.isSellerVerified ||
        trust.isVerifiedStore ||
        source?.isVerifiedStore
    );

    // Ensure VERIFIED STORE chip even for newbies (trust ≠ performance tier)
    if (verifiedStore && !badges.some((b) => b.id === "verified_store")) {
      badges.unshift({
        id: "verified_store",
        label: "🔷 VERIFIED STORE",
        emoji: "🔷",
      });
    }

    if (!badges.length) {
      badges.push({ id: "newbie", label: "🐣 New Store", emoji: "🐣" });
    }

    // Prefer showing verified_store + performance tier first
    const order = ["verified_store", "legend", "top_rated", "verified", "newbie", "fast_dispatcher", "sales"];
    badges.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    return badges.slice(0, max);
  }

  function badgesHtml(source, { max = 4, className = "seller-trust-badges" } = {}) {
    const badges = resolveBadges(source, { max });
    if (!badges.length) return "";
    return `<span class="${escapeHtml(className)}" aria-label="Seller trust">${badges
      .map(
        (b) =>
          `<span class="seller-trust-badge seller-trust-badge--${escapeHtml(b.id || "info")}">${escapeHtml(
            withEmojiLabel(b)
          )}</span>`
      )
      .join("")}</span>`;
  }

  /**
   * ★ 4.8 (42) or ✨ New Joiner / UNRATED — honors explicit unrated:false from Boss override.
   */
  function ratingHtml(source, { className = "seller-rating-line" } = {}) {
    const trust = trustFrom(source);
    const count = Number(trust.totalReviews ?? source?.reviews ?? 0) || 0;
    const avg = Number(trust.avgRating ?? source?.rating) || 0;
    const unrated =
      trust.unrated === true ||
      (trust.unrated !== false && (trust.displayLabel === "UNRATED" || count < 5));

    if (unrated || !(avg > 0)) {
      if (!(trust.unrated === false && avg > 0)) {
        const label =
          count > 0
            ? `✨ UNRATED · ${count.toLocaleString()}`
            : "✨ New Joiner";
        return `<span class="${escapeHtml(className)} seller-rating-line--unrated">${escapeHtml(
          label
        )}</span>`;
      }
    }

    const shownCount = Math.max(count, trust.unrated === false ? 1 : 0);
    return `<span class="${escapeHtml(className)}" aria-label="Seller rating ${avg.toFixed(
      1
    )} from ${shownCount} reviews"><span class="seller-rating-stars">⭐ ${avg.toFixed(
      1
    )}</span> <span class="seller-rating-count">(${shownCount.toLocaleString()})</span></span>`;
  }

  window.SokoniSellerTrust = { resolveBadges, badgesHtml, ratingHtml, withEmojiLabel };
})();
