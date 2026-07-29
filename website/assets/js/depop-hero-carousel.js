/**
 * Homepage brand hero — one composition: brand, headline, support line, CTA.
 * Intentional motion only; respects prefers-reduced-motion.
 */
(function () {
  function mount() {
    const root = document.getElementById("depop-hero-carousel");
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("depop-hero--brand");
    if (reducedMotion) root.classList.add("is-reduced-motion");

    root.innerHTML = `
      <div class="depop-hero-bleed" aria-hidden="true"></div>
      <div class="depop-hero-carousel-inner depop-hero-brand-inner">
        <div class="depop-hero-brand-copy">
          <p class="depop-hero-brand-mark">Sokoni</p>
          <h1 class="depop-hero-title">Brand new &amp; pre-loved, prepaid.</h1>
          <p class="depop-hero-sub">Escrow until it lands. SK tracking on every order — shop or sell across Kenya.</p>
          <div class="depop-hero-actions">
            <a href="#deals" class="depop-hero-cta depop-hero-cta--primary">Shop finds</a>
            <a href="suppliers/list.html" class="depop-hero-cta depop-hero-cta--ghost">Start selling</a>
          </div>
        </div>
        <div class="depop-hero-brand-visual" aria-hidden="true">
          <img
            class="depop-hero-brand-lockup"
            src="assets/images/logo-lockup-light.svg"
            width="280"
            height="80"
            alt=""
            decoding="async"
          />
        </div>
      </div>`;

    requestAnimationFrame(() => {
      root.classList.add("is-ready");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
