import { animate } from "framer-motion";
import { markEnhanced, prefersReducedMotion, safeAnimate } from "../lib/motion.js";

/**
 * Phase 6 — category / filter pills.
 * Glide a shared underline/pill using transform (no layout thrash).
 */
function ensurePill(container) {
  let pill = container.querySelector("[data-sokoni-motion-pill]");
  if (!pill) {
    pill = document.createElement("span");
    pill.setAttribute("data-sokoni-motion-pill", "1");
    pill.setAttribute("aria-hidden", "true");
    Object.assign(pill.style, {
      position: "absolute",
      left: "0",
      top: "0",
      height: "2px",
      width: "24px",
      borderRadius: "999px",
      background: "#25D366",
      pointerEvents: "none",
      zIndex: "0",
      transform: "translate3d(0,0,0)",
      transition: "none",
    });
    const cs = getComputedStyle(container);
    if (cs.position === "static") container.style.position = "relative";
    container.appendChild(pill);
  }
  return pill;
}

function movePillTo(container, active) {
  if (!active || prefersReducedMotion()) return;
  const pill = ensurePill(container);
  const cRect = container.getBoundingClientRect();
  const aRect = active.getBoundingClientRect();
  const x = aRect.left - cRect.left + container.scrollLeft;
  const y = aRect.bottom - cRect.top - 4;
  const w = Math.max(20, aRect.width * 0.55);
  pill.style.width = `${w}px`;
  safeAnimate(pill, { x, y }, { type: "spring", stiffness: 380, damping: 32 });
}

function wireTabGroup(container, itemSelector, activeSelector) {
  if (!markEnhanced(container, "tabs")) return;
  const items = () => Array.from(container.querySelectorAll(itemSelector));

  const sync = () => {
    const active =
      container.querySelector(activeSelector) ||
      items().find((el) => el.getAttribute("aria-selected") === "true" || el.classList.contains("is-active"));
    if (active) movePillTo(container, active);
  };

  container.addEventListener(
    "click",
    (ev) => {
      const item = ev.target.closest(itemSelector);
      if (!item || !container.contains(item)) return;
      // slight press on chip
      if (!prefersReducedMotion()) {
        animate(item, { scale: [1, 0.96, 1] }, { duration: 0.18 });
      }
      requestAnimationFrame(sync);
    },
    true
  );

  const mo = new MutationObserver(() => requestAnimationFrame(sync));
  mo.observe(container, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "aria-selected"] });
  sync();
}

export function enhanceTabs() {
  const groups = [
    ["#depop-promo-dots", ".depop-promo-dot", ".depop-promo-dot.is-active"],
    [".depop-hero-dots", ".depop-hero-dot", ".depop-hero-dot.is-active"],
    ["#browse-filter-bar", "button, a, [role='tab']", ".is-active, [aria-selected='true']"],
    ["#depop-cat-strip", "button, a", ".is-active, [aria-selected='true']"],
    [".depop-brands-row", ".depop-brand-chip", ".is-active"],
    ["#sokoni-category-rail-list", "button, a", ".is-active, [aria-current='true']"],
  ];

  groups.forEach(([rootSel, itemSel, activeSel]) => {
    document.querySelectorAll(rootSel).forEach((root) => wireTabGroup(root, itemSel, activeSel));
  });

  // Horizontal chip rows — soft scroll fade feel via opacity on overflow parents
  document.querySelectorAll(".depop-cat-strip, .depop-brands-row, .depop-collections-row").forEach((row) => {
    if (!markEnhanced(row, "scrollrow")) return;
    row.style.scrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  });
}

export function observeTabs() {
  enhanceTabs();
  const obs = new MutationObserver(() => enhanceTabs());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}
