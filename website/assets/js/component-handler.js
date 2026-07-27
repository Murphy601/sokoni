/**
 * MDL-style component upgrade — attaches behaviour to dynamically injected DOM.
 * Call SokoniComponents.upgradeIn(container) after innerHTML renders.
 */
(function (global) {
  "use strict";

  function upgradeProductCard(card) {
    if (!card || card.dataset.sokoniUpgraded === "1") return;
    card.dataset.sokoniUpgraded = "1";
    card.classList.add("card-elevated");
    card.setAttribute("role", "article");

    const title = card.querySelector("h3");
    if (title && !title.id) {
      const slug = (title.textContent || "product")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40);
      title.id = "product-" + slug + "-" + Math.random().toString(36).slice(2, 7);
      card.setAttribute("aria-labelledby", title.id);
    }

    const orderBtn = card.querySelector('a[href*="wa.me"]');
    if (orderBtn) {
      orderBtn.classList.add("btn-whatsapp");
      if (!orderBtn.getAttribute("aria-label") && title) {
        orderBtn.setAttribute("aria-label", "Order " + title.textContent + " on WhatsApp");
      }
    }

    const img = card.querySelector(".product-image");
    if (img && !img.getAttribute("width")) {
      img.setAttribute("width", "320");
      img.setAttribute("height", "320");
    }
  }

  function upgradeCategoryChip(chip) {
    if (!chip || chip.dataset.sokoniUpgraded === "1") return;
    chip.dataset.sokoniUpgraded = "1";
    chip.setAttribute("type", "button");
    const label = chip.querySelector("p");
    if (label && !chip.getAttribute("aria-label")) {
      chip.setAttribute("aria-label", "Filter by " + label.textContent);
    }
  }

  function upgradeIn(root) {
    const el = root && root.querySelectorAll ? root : document;
    el.querySelectorAll(".product-card").forEach(upgradeProductCard);
    el.querySelectorAll(".cat-chip").forEach(upgradeCategoryChip);
  }

  global.SokoniComponents = { upgradeIn, upgradeProductCard, upgradeCategoryChip };
})(typeof window !== "undefined" ? window : globalThis);
