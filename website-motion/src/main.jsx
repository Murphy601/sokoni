import { createRoot } from "react-dom/client";
import AnimationProvider from "./providers/AnimationProvider.jsx";
import { MOTION_BUILD } from "./lib/motion.js";
import { observeCards } from "./enhance/cards.js";
import { observeGrids } from "./enhance/grids.js";
import { observeSheets } from "./enhance/sheets.js";
import { observeTabs } from "./enhance/tabs.js";
import { observeFab } from "./enhance/fab.js";
import { observeForms } from "./enhance/forms.js";
import { observeSections } from "./enhance/sections.js";

/**
 * Sokoni Path B boot — progressive Framer Motion layer.
 * Fail-soft: any enhancer error must not break catalog/auth/WhatsApp.
 *
 * Note: this is NOT Next.js. There is no `'use client'` / SSR for this IIFE.
 * LazyMotion wraps React-owned UI; DOM enhancers use framer-motion `animate()`.
 */
function mountProvider() {
  let host = document.getElementById("sokoni-motion-root");
  if (!host) {
    host = document.createElement("div");
    host.id = "sokoni-motion-root";
    host.setAttribute("hidden", "");
    host.style.display = "none";
    document.body.appendChild(host);
  }
  createRoot(host).render(
    <AnimationProvider>
      <span data-sokoni-motion-ready="1" data-sokoni-motion-build={MOTION_BUILD} />
    </AnimationProvider>
  );
}

function bootEnhancers() {
  try {
    observeSections();
  } catch (e) {
    console.warn("[sokoni-motion] sections", e);
  }
  try {
    observeCards();
  } catch (e) {
    console.warn("[sokoni-motion] cards", e);
  }
  try {
    observeGrids();
  } catch (e) {
    console.warn("[sokoni-motion] grids", e);
  }
  try {
    observeSheets();
  } catch (e) {
    console.warn("[sokoni-motion] sheets", e);
  }
  try {
    observeTabs();
  } catch (e) {
    console.warn("[sokoni-motion] tabs", e);
  }
  try {
    observeFab();
  } catch (e) {
    console.warn("[sokoni-motion] fab", e);
  }
  try {
    observeForms();
  } catch (e) {
    console.warn("[sokoni-motion] forms", e);
  }
}

function boot() {
  try {
    mountProvider();
  } catch (e) {
    console.warn("[sokoni-motion] provider", e);
  }
  bootEnhancers();
  document.documentElement.setAttribute("data-sokoni-motion", "path-b");
  document.documentElement.setAttribute("data-sokoni-motion-build", MOTION_BUILD);
  // One-line proof in DevTools that the bundle actually executed on this deploy
  console.info(`[sokoni-motion] active (${MOTION_BUILD})`);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

// Late paint for catalog grids that hydrate after first paint
window.addEventListener("load", () => {
  try {
    observeGrids();
    observeCards();
  } catch (_) {
    /* ignore */
  }
});

export {};
