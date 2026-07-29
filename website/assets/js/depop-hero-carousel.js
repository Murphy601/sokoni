/**
 * Homepage hero carousel — buyers / sellers / escrow.
 * Existing routes only; no lockup graphic. Respects prefers-reduced-motion.
 */
(function () {
  const SLIDES = [
    {
      id: "buyers",
      tag: "For buyers & collectors",
      badge: "100% buyer protection",
      headline: "Find unique fits you won’t get in stores.",
      subtext:
        "Vintage, streetwear, and pre-loved brands from thrifters across Kenya — prepaid with SK tracking.",
      primaryCtaText: "Shop latest finds",
      primaryCtaLink: "#deals",
      secondaryCtaText: "Browse categories",
      secondaryCtaLink: "#categories",
      bleedClass: "depop-hero-bleed--buyers",
    },
    {
      id: "sellers",
      tag: "For sellers & creators",
      badge: "Zero listing fees",
      headline: "Turn your closet into cash.",
      subtext:
        "List brand new or pre-loved in minutes. Buyers pay upfront — you drop off with an SK label and get paid after delivery.",
      primaryCtaText: "Start selling",
      primaryCtaLink: "suppliers/list.html",
      secondaryCtaText: "How selling works",
      secondaryCtaLink: "#why-sell",
      bleedClass: "depop-hero-bleed--sellers",
    },
    {
      id: "escrow",
      tag: "Prepaid escrow",
      badge: "Guaranteed until delivery",
      headline: "Shop with peace of mind.",
      subtext:
        "Your M-Pesa stays in Sokoni escrow until the parcel lands. Track every order with SK-####.",
      primaryCtaText: "How escrow works",
      primaryCtaLink: "faq.html",
      secondaryCtaText: "Track an order",
      secondaryCtaLink: "track.html",
      bleedClass: "depop-hero-bleed--escrow",
    },
  ];

  const INTERVAL_MS = 6000;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mount() {
    const root = document.getElementById("depop-hero-carousel");
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("depop-hero--brand");
    if (reducedMotion) root.classList.add("is-reduced-motion");

    let index = 0;
    let timer = null;

    root.innerHTML = `
      <div class="depop-hero-bleed ${SLIDES[0].bleedClass}" aria-hidden="true"></div>
      <div class="depop-hero-carousel-inner depop-hero-brand-inner">
        <div class="depop-hero-brand-copy">
          <div class="depop-hero-tag-row">
            <span class="depop-hero-tag" data-hero-tag></span>
            <span class="depop-hero-badge" data-hero-badge></span>
          </div>
          <h1 class="depop-hero-title" data-hero-title></h1>
          <p class="depop-hero-sub" data-hero-sub></p>
        </div>
        <div class="depop-hero-footer">
          <div class="depop-hero-actions">
            <a data-hero-primary class="depop-hero-cta depop-hero-cta--primary" href="#deals"></a>
            <a data-hero-secondary class="depop-hero-cta depop-hero-cta--ghost" href="#categories"></a>
          </div>
          <div class="depop-hero-dots" role="tablist" aria-label="Hero slides"></div>
        </div>
      </div>`;

    const bleed = root.querySelector(".depop-hero-bleed");
    const tagEl = root.querySelector("[data-hero-tag]");
    const badgeEl = root.querySelector("[data-hero-badge]");
    const titleEl = root.querySelector("[data-hero-title]");
    const subEl = root.querySelector("[data-hero-sub]");
    const primaryEl = root.querySelector("[data-hero-primary]");
    const secondaryEl = root.querySelector("[data-hero-secondary]");
    const dotsWrap = root.querySelector(".depop-hero-dots");

    dotsWrap.innerHTML = SLIDES.map(
      (slide, i) =>
        `<button type="button" class="depop-hero-dot${i === 0 ? " is-active" : ""}" role="tab" aria-label="Show slide ${i + 1}: ${escapeHtml(slide.tag)}" aria-selected="${i === 0 ? "true" : "false"}" data-slide-index="${i}"></button>`
    ).join("");

    function render(i) {
      const slide = SLIDES[i];
      if (!slide) return;
      index = i;
      if (bleed) {
        bleed.className = `depop-hero-bleed ${slide.bleedClass}`;
      }
      if (tagEl) tagEl.textContent = slide.tag;
      if (badgeEl) badgeEl.textContent = `• ${slide.badge}`;
      if (titleEl) titleEl.textContent = slide.headline;
      if (subEl) subEl.textContent = slide.subtext;
      if (primaryEl) {
        primaryEl.textContent = slide.primaryCtaText;
        primaryEl.setAttribute("href", slide.primaryCtaLink);
      }
      if (secondaryEl) {
        secondaryEl.textContent = slide.secondaryCtaText;
        secondaryEl.setAttribute("href", slide.secondaryCtaLink);
      }
      dotsWrap.querySelectorAll(".depop-hero-dot").forEach((dot, di) => {
        const active = di === i;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    function go(i) {
      render((i + SLIDES.length) % SLIDES.length);
      restart();
    }

    function restart() {
      if (timer) clearInterval(timer);
      timer = null;
      if (reducedMotion || SLIDES.length < 2) return;
      timer = setInterval(() => go(index + 1), INTERVAL_MS);
    }

    dotsWrap.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-slide-index]");
      if (!btn) return;
      go(Number(btn.getAttribute("data-slide-index")) || 0);
    });

    root.addEventListener("mouseenter", () => {
      if (timer) clearInterval(timer);
      timer = null;
    });
    root.addEventListener("mouseleave", restart);

    render(0);
    restart();
    requestAnimationFrame(() => root.classList.add("is-ready"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
