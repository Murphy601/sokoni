import { bindTapScale, markEnhanced, prefersReducedMotion, safeAnimate } from "../lib/motion.js";

/**
 * Phase 7 — floating WhatsApp + sticky helpers.
 */
function wireFab(el) {
  if (!markEnhanced(el, "fab")) return;
  bindTapScale(el, { hover: 1.06, tap: 0.94 });

  if (prefersReducedMotion()) return;
  el.style.opacity = "0";
  el.style.transform = "translate3d(0, 24px, 0) scale(0.9)";
  requestAnimationFrame(() => {
    safeAnimate(
      el,
      { opacity: 1, y: 0, scale: 1 },
      { type: "spring", stiffness: 320, damping: 22, delay: 0.35 }
    );
  });
}

function wireNudge(el) {
  if (!markEnhanced(el, "nudge")) return;
  if (prefersReducedMotion()) return;

  const show = () => {
    if (el.classList.contains("hidden")) return;
    safeAnimate(el, { opacity: [0, 1], y: [16, 0] }, { type: "spring", stiffness: 280, damping: 24 });
  };

  const mo = new MutationObserver(() => {
    if (!el.classList.contains("hidden")) show();
  });
  mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  if (!el.classList.contains("hidden")) show();
}

export function enhanceFab() {
  document.querySelectorAll(".depop-wa-float, a[aria-label*='WhatsApp' i].fixed, #wa-float").forEach(wireFab);
  const nudge = document.getElementById("ai-nudge");
  if (nudge) wireNudge(nudge);

  document
    .querySelectorAll("[data-open-bag], #bag-toggle, .depop-bag-btn, a[href='#bag'], button[data-bag]")
    .forEach((el) => bindTapScale(el, { hover: 1.03, tap: 0.96 }));
}

export function observeFab() {
  enhanceFab();
  const obs = new MutationObserver(() => enhanceFab());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}
