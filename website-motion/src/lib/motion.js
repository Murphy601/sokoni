import { animate, stagger } from "framer-motion";

export const MOTION_BUILD = "20260806b";

export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Mark element so enhancers stay idempotent. */
export function markEnhanced(el, key) {
  if (!el || !(el instanceof Element)) return false;
  const attr = `data-sokoni-motion-${key}`;
  if (el.hasAttribute(attr)) return false;
  el.setAttribute(attr, "1");
  return true;
}

export function isEnhanced(el, key) {
  return !!(el && el.hasAttribute?.(`data-sokoni-motion-${key}`));
}

/** Clear stuck inline hide from a failed/interrupted motion pass. */
export function clearStuckHide(el) {
  if (!el?.style) return;
  if (el.style.opacity === "0") {
    el.style.opacity = "";
    el.style.transform = "";
  }
}

/**
 * Safe animate — opacity/transform only. No-ops under reduced motion
 * (optional instant snap for opacity).
 */
export function safeAnimate(target, keyframes, options = {}) {
  if (!target) return null;
  if (prefersReducedMotion()) {
    if (keyframes && typeof keyframes === "object" && "opacity" in keyframes) {
      const nodes = typeof target === "string" ? document.querySelectorAll(target) : [target].flat();
      nodes.forEach((n) => {
        if (n && n.style) n.style.opacity = String(keyframes.opacity);
        if (n && n.style && ("y" in keyframes || "x" in keyframes || "scale" in keyframes)) {
          n.style.transform = "none";
        }
      });
    }
    return null;
  }
  try {
    return animate(target, keyframes, options);
  } catch (e) {
    console.warn("[sokoni-motion] animate failed", e);
    return null;
  }
}

/**
 * Stagger a concrete node list (never a comma-joined CSS selector).
 * Previous Path B bug: appending `[data-…]` to a comma selector only
 * filtered the LAST term, so grids could hide unrelated cards.
 */
export function staggerNodes(nodes, keyframes, { delayChildren = 0.05, duration = 0.32, ease = "easeOut" } = {}) {
  const list = Array.from(nodes || []).filter((n) => n instanceof Element && !isEnhanced(n, "staggered"));
  if (!list.length) return;
  list.forEach((n) => markEnhanced(n, "staggered"));

  if (prefersReducedMotion()) {
    list.forEach((n) => {
      n.style.opacity = "1";
      n.style.transform = "none";
    });
    return;
  }

  list.forEach((n) => {
    n.style.opacity = "0";
    n.style.transform = "translate3d(0, 22px, 0)";
  });

  const controls = safeAnimate(
    list,
    keyframes || { opacity: 1, y: 0 },
    {
      delay: stagger(delayChildren),
      duration,
      ease,
    }
  );

  // Fail-safe: never leave cards stuck invisible
  const healMs = Math.ceil((delayChildren * list.length + duration) * 1000) + 120;
  setTimeout(() => {
    list.forEach(clearStuckHide);
  }, healMs);

  return controls;
}

/** @deprecated Prefer staggerNodes — kept for callers that still pass a selector. */
export function staggerSelector(selector, keyframes, options) {
  return staggerNodes(document.querySelectorAll(selector), keyframes, options);
}

export function bindTapScale(el, { hover = 1.04, tap = 0.95 } = {}) {
  if (!markEnhanced(el, "tap")) return;
  if (prefersReducedMotion()) return;

  const onEnter = () => safeAnimate(el, { scale: hover }, { duration: 0.18, ease: "easeOut" });
  const onLeave = () => safeAnimate(el, { scale: 1 }, { duration: 0.18, ease: "easeOut" });
  const onDown = () => safeAnimate(el, { scale: tap }, { duration: 0.1, ease: "easeOut" });
  const onUp = () => safeAnimate(el, { scale: hover }, { duration: 0.12, ease: "easeOut" });

  el.style.transformOrigin = "center center";
  el.style.willChange = "transform";
  el.addEventListener("pointerenter", onEnter, { passive: true });
  el.addEventListener("pointerleave", onLeave, { passive: true });
  el.addEventListener("pointerdown", onDown, { passive: true });
  el.addEventListener("pointerup", onUp, { passive: true });
  el.addEventListener("pointercancel", onLeave, { passive: true });
}

export { stagger };
