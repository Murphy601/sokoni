/**
 * Scroll reveals, lazy-image fallback, perf helpers.
 */
(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function initReveals() {
    if (reduced) {
      document.querySelectorAll(".reveal-on-scroll").forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal-on-scroll").forEach((el) => obs.observe(el));
  }

  function initLazyImages() {
    const imgs = document.querySelectorAll("img.product-image, img[data-src]");
    for (const img of imgs) {
      if (img.dataset.fallbackBound) continue;
      img.dataset.fallbackBound = "1";
      img.addEventListener("error", () => {
        const emoji = img.dataset.emoji || "🛍️";
        const wrap = img.closest(".product-image-wrap");
        if (wrap) {
          wrap.innerHTML = `<div class="text-5xl text-center py-8">${emoji}</div>`;
        }
      });
    }
  }

  function enhanceProductCards() {
    document.querySelectorAll(".product-card a[href*='wa.me']").forEach((a) => {
      if (!a.querySelector(".wa-pulse")) {
        const span = document.createElement("span");
        span.className = "wa-pulse inline-block ml-1";
        span.textContent = "💬";
        a.appendChild(span);
      }
    });
  }

  function defer3d() {
    const wide = window.matchMedia("(min-width: 768px)").matches;
    if (reduced || !wide) return;
    const s = document.createElement("script");
    s.src = "assets/js/scene-3d.js";
    s.defer = true;
    document.body.appendChild(s);
  }

  function boot() {
    initReveals();
    initLazyImages();
    defer3d();
    // Product grid renders after app.js — re-run lazy + pulse shortly after
    setTimeout(() => {
      initLazyImages();
      enhanceProductCards();
    }, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
