import { animate } from "framer-motion";
import { markEnhanced, prefersReducedMotion, safeAnimate } from "../lib/motion.js";

/**
 * Phase 5 — bottom sheets / drawers.
 * Existing CSS toggles `.is-open`; we add spring physics on panel + fade backdrop
 * without replacing product-sheet.js behaviour.
 */
function wireSheet(sheet) {
  if (!markEnhanced(sheet, "sheet")) return;
  const panel = sheet.querySelector(".sheet-panel");
  const backdrop = sheet.querySelector(".sheet-backdrop");
  if (!panel) return;

  let open = sheet.classList.contains("is-open");

  const applyOpen = (toOpen) => {
    if (prefersReducedMotion()) return;
    if (toOpen) {
      // Neutralize CSS transition fight for the animated frame
      panel.style.transition = "none";
      if (backdrop) backdrop.style.transition = "none";
      safeAnimate(panel, { y: ["100%", "0%"] }, { type: "spring", stiffness: 300, damping: 26 });
      if (backdrop) {
        safeAnimate(backdrop, { opacity: [0, 1] }, { duration: 0.22, ease: "easeOut" });
      }
    } else {
      panel.style.transition = "none";
      if (backdrop) backdrop.style.transition = "none";
      animate(panel, { y: "105%" }, { duration: 0.22, ease: "easeIn" });
      if (backdrop) animate(backdrop, { opacity: 0 }, { duration: 0.18, ease: "easeIn" });
    }
  };

  const mo = new MutationObserver(() => {
    const next = sheet.classList.contains("is-open");
    if (next === open) return;
    open = next;
    applyOpen(open);
  });
  mo.observe(sheet, { attributes: true, attributeFilter: ["class", "hidden"] });

  // Catalog / browse drawers often use aria-expanded or hidden attrs on other roots
  if (open) applyOpen(true);
}

function wireCatalogDrawer() {
  const panel = document.getElementById("catalog-nav-panel");
  if (!panel || !markEnhanced(panel, "drawer")) return;
  const toggle = document.getElementById("catalog-nav-toggle");

  const sync = () => {
    const expanded = toggle?.getAttribute("aria-expanded") === "true" || panel.classList.contains("is-open");
    if (prefersReducedMotion()) return;
    if (expanded) {
      safeAnimate(panel, { x: ["-12%", "0%"], opacity: [0.6, 1] }, { type: "spring", stiffness: 320, damping: 28 });
    }
  };

  if (toggle) {
    const mo = new MutationObserver(sync);
    mo.observe(toggle, { attributes: true, attributeFilter: ["aria-expanded", "class"] });
  }
  const mo2 = new MutationObserver(sync);
  mo2.observe(panel, { attributes: true, attributeFilter: ["class", "hidden"] });
}

export function enhanceSheets() {
  document.querySelectorAll(".bottom-sheet").forEach(wireSheet);
  wireCatalogDrawer();
}

export function observeSheets() {
  enhanceSheets();
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.(".bottom-sheet")) wireSheet(node);
        node.querySelectorAll?.(".bottom-sheet").forEach(wireSheet);
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}
