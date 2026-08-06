import { animate, stagger } from "framer-motion";

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
        if (n && n.style && "y" in keyframes) n.style.transform = "none";
      });
    }
    return null;
  }
  return animate(target, keyframes, options);
}

export function staggerSelector(selector, keyframes, { delayChildren = 0.05, duration = 0.28, ease = "easeOut" } = {}) {
  const nodes = Array.from(document.querySelectorAll(selector)).filter(
    (n) => !isEnhanced(n, "staggered")
  );
  if (!nodes.length) return;
  nodes.forEach((n) => markEnhanced(n, "staggered"));
  if (prefersReducedMotion()) {
    nodes.forEach((n) => {
      n.style.opacity = "1";
      n.style.transform = "none";
    });
    return;
  }
  nodes.forEach((n) => {
    n.style.opacity = "0";
    n.style.transform = "translate3d(0, 14px, 0)";
  });
  animate(
    nodes,
    keyframes || { opacity: 1, y: 0 },
    {
      delay: stagger(delayChildren),
      duration,
      ease,
    }
  );
}

export function bindTapScale(el, { hover = 1.02, tap = 0.96 } = {}) {
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
