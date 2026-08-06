import { markEnhanced, prefersReducedMotion, safeAnimate } from "../lib/motion.js";

/**
 * Marketing sections, shop shell, dashboards — soft fade/slide when entering viewport.
 * Complements existing `.reveal-on-scroll` without removing it.
 */
function watchSection(el) {
  if (!markEnhanced(el, "section")) return;
  if (prefersReducedMotion()) {
    el.style.opacity = "1";
    return;
  }

  el.style.opacity = "0";
  el.style.transform = "translate3d(0, 18px, 0)";

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        safeAnimate(el, { opacity: 1, y: 0 }, { duration: 0.4, ease: "easeOut" });
        io.unobserve(el);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );
  io.observe(el);
}

export function enhanceSections() {
  const sels = [
    ".reveal-on-scroll",
    "#trade-across-kenya",
    "#trusted-exchange",
    "#how-it-works",
    "#reviews",
    "#deals",
    "#categories",
    "#why-sell",
    ".depop-hero-carousel",
    ".depop-promo-section",
    ".shop-shell",
    ".sell-hub",
    "main",
    ".account-panel",
    ".buyer-panel",
  ];
  const seen = new Set();
  sels.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      watchSection(el);
    });
  });
}

export function observeSections() {
  enhanceSections();
  return null;
}
