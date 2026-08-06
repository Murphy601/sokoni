import { markEnhanced, prefersReducedMotion, safeAnimate } from "../lib/motion.js";

/**
 * Soft section enter — MUST NOT fight `.reveal-on-scroll` / `.is-visible`.
 * Path B previously set inline opacity:0 on reveal sections, which overrode
 * `.is-visible { opacity: 1 }` and left black empty blocks (e.g. Trade Across Kenya).
 */

function clearStuckInlineOpacity(el) {
  if (!el?.style) return;
  // Only clear if we left a stuck hide from an earlier motion pass
  if (el.style.opacity === "0") {
    el.style.opacity = "";
    el.style.transform = "";
  }
}

function watchNonRevealSection(el) {
  if (!markEnhanced(el, "section")) return;
  clearStuckInlineOpacity(el);

  if (prefersReducedMotion()) {
    el.style.opacity = "";
    el.style.transform = "";
    return;
  }

  // Only hide briefly if not already revealed by site CSS
  if (el.classList.contains("is-visible")) return;

  el.style.opacity = "0";
  el.style.transform = "translate3d(0, 18px, 0)";

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        safeAnimate(el, { opacity: 1, y: 0 }, { duration: 0.4, ease: "easeOut" }).then?.(() => {
          el.style.opacity = "";
          el.style.transform = "";
        });
        // Fail-safe: always clear inline hide even if animate returns null
        setTimeout(() => {
          if (el.style.opacity === "0") {
            el.style.opacity = "";
            el.style.transform = "";
          }
        }, 500);
        io.unobserve(el);
      });
    },
    { rootMargin: "0px 0px -4% 0px", threshold: 0.05 }
  );
  io.observe(el);
}

/** Ensure reveal-on-scroll sections are never stuck invisible by Path B. */
function healRevealSections() {
  document.querySelectorAll(".reveal-on-scroll").forEach((el) => {
    clearStuckInlineOpacity(el);
    // If main.js already marked visible, keep CSS in charge
    if (el.classList.contains("is-visible")) return;
    // Fail-safe for long sections: if already in viewport, force visible
    const rect = el.getBoundingClientRect();
    const inView = rect.top < window.innerHeight * 0.92 && rect.bottom > 40;
    if (inView) {
      el.classList.add("is-visible");
      clearStuckInlineOpacity(el);
    }
  });
}

export function enhanceSections() {
  healRevealSections();

  // Only enhance surfaces that do NOT already use reveal-on-scroll
  const sels = [
    ".depop-hero-carousel",
    ".depop-promo-section",
    ".shop-shell",
    ".sell-hub",
    ".account-panel",
    ".buyer-panel",
  ];
  const seen = new Set();
  sels.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      if (el.classList.contains("reveal-on-scroll")) return;
      seen.add(el);
      watchNonRevealSection(el);
    });
  });
}

export function observeSections() {
  enhanceSections();
  // Heal again after late catalog/layout paint
  window.addEventListener("load", healRevealSections, { once: true });
  setTimeout(healRevealSections, 800);
  return null;
}
