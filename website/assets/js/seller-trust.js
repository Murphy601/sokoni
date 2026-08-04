/**
 * Render seller trust badges from API payload (sellerTrust / stats.trust).
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

  function resolveBadges(source, { max = 3 } = {}) {
    const trust = source?.sellerTrust || source?.trust || source || {};
    const badges = Array.isArray(trust.badges) ? trust.badges : [];
    if (badges.length) return badges.slice(0, max);
    // Lightweight fallback when only a verified flag is present.
    if (source?.isSellerVerified || trust.isSellerVerified) {
      return [{ id: "verified", label: "Verified seller", icon: "verified" }];
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

  window.SokoniSellerTrust = { resolveBadges, badgesHtml };
})();
