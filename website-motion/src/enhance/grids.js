import { staggerSelector } from "../lib/motion.js";

const GRID_ROOTS = [
  "#product-grid",
  "#deals-grid",
  "#category-grid",
  "#trade-mashinani-grid",
  "#trade-artisans-grid",
  ".depop-trade-cat-grid",
  ".depop-edu-grid",
  ".depop-trust-stack",
  "#reviews-list",
  "#bag-sheet-list",
  ".depop-collections-row",
];

const CHILD_SELECTORS = [
  ".depop-card",
  ".product-card",
  ".depop-trade-cat-card",
  ".depop-edu-card",
  ".depop-trust-card",
  ".depop-collection-card",
  "#reviews-list > *",
  "#bag-sheet-list > li",
].join(",");

function staggerGrid(root) {
  if (!root) return;
  const kids = Array.from(root.querySelectorAll(CHILD_SELECTORS)).filter(
    (n) => !n.hasAttribute("data-sokoni-motion-staggered")
  );
  if (!kids.length) return;
  kids.forEach((k) => k.setAttribute("data-sokoni-motion-pending", "1"));
  staggerSelector(`${CHILD_SELECTORS}[data-sokoni-motion-pending="1"]`, { opacity: 1, y: 0 }, {
    delayChildren: 0.045,
    duration: 0.28,
  });
  kids.forEach((k) => k.removeAttribute("data-sokoni-motion-pending"));
}

/** Phase 4 — staggered entrance for catalog & trade grids. */
export function enhanceGrids() {
  GRID_ROOTS.forEach((sel) => {
    document.querySelectorAll(sel).forEach(staggerGrid);
  });
}

export function observeGrids() {
  enhanceGrids();
  let scheduled = false;
  const run = () => {
    scheduled = false;
    enhanceGrids();
  };
  const obs = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}
