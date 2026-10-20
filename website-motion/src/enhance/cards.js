import { bindTapScale, markEnhanced, prefersReducedMotion, safeAnimate } from "../lib/motion.js";

const CARD_SELECTORS = [
  ".depop-card",
  ".product-card",
  ".depop-trade-cat-card",
  ".depop-cat-card",
  ".depop-collection-card",
  ".depop-edu-card",
  ".depop-trust-card",
].join(",");

const CTA_SELECTORS = [
  ".depop-hero-cta",
  ".depop-card a.button-whatsapp",
  ".product-card a[href*='wa.me']",
  ".product-card a.button-whatsapp",
  "a.button-whatsapp",
  "button.button-whatsapp",
  ".bag-sheet-order",
  ".depop-wa-float",
  "#catalog-nav-toggle",
  "button[type='submit']",
  ".depop-btn-accent",
].join(",");

function enhanceCard(card) {
  if (!markEnhanced(card, "card")) return;
  if (prefersReducedMotion()) return;

  card.style.willChange = "transform";
  card.style.transformOrigin = "center center";

  // Stronger than Path B v1 (−4px) so hover is obvious on mid-range phones
  const lift = () => safeAnimate(card, { y: -8, scale: 1.02 }, { duration: 0.22, ease: "easeOut" });
  const reset = () => safeAnimate(card, { y: 0, scale: 1 }, { duration: 0.22, ease: "easeOut" });
  const press = () => safeAnimate(card, { scale: 0.97, y: -3 }, { duration: 0.1, ease: "easeOut" });

  card.addEventListener("pointerenter", lift, { passive: true });
  card.addEventListener("pointerleave", reset, { passive: true });
  card.addEventListener("pointerdown", press, { passive: true });
  card.addEventListener("pointerup", lift, { passive: true });
  card.addEventListener("pointercancel", reset, { passive: true });
}

function enhanceCtas(root = document) {
  root.querySelectorAll(CTA_SELECTORS).forEach((el) => bindTapScale(el));
}

/** Phase 3 — product / trade / collection cards + CTA tap feedback (DOM-safe). */
export function enhanceCards(root = document) {
  root.querySelectorAll(CARD_SELECTORS).forEach(enhanceCard);
  enhanceCtas(root);
}

export function observeCards() {
  enhanceCards();
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.(CARD_SELECTORS) || node.matches?.(CTA_SELECTORS)) {
          enhanceCards(node.parentElement || document);
        } else if (node.querySelector?.(CARD_SELECTORS) || node.querySelector?.(CTA_SELECTORS)) {
          enhanceCards(node);
        }
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}
