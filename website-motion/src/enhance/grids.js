import { staggerNodes } from "../lib/motion.js";

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
  // Scope children to THIS root only — never querySelectorAll across the whole document
  const kids = Array.from(root.querySelectorAll(CHILD_SELECTORS)).filter(
    (n) => !n.hasAttribute("data-sokoni-motion-staggered")
  );
  if (!kids.length) return;
  staggerNodes(kids, { opacity: 1, y: 0 }, {
    delayChildren: 0.055,
    duration: 0.34,
  });
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
