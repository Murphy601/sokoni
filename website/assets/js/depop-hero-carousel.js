/**
 * Homepage hero carousel — buyers / sellers / escrow.
 * Existing routes only; no lockup graphic. Respects prefers-reduced-motion.
 */
(function () {
  const HERO_IMG = "assets/images/marketing/hero-banner-thrift.jpg";
  const PRODUCT_IMG = "assets/images/marketing/product-sneakers.jpg";
  const DISPATCH_IMG = "assets/images/marketing/how-it-works-dispatch.jpg";

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
      image: HERO_IMG,
    },
    {
      id: "sellers",
      tag: "For sellers & creators",
      badge: "Zero listing fees",
      headline: "Turn your closet into cash.",
      subtext:
        "List brand new or pre-loved in minutes. Buyers pay the item upfront — you arrange dispatch directly and get paid after delivery.",
      primaryCtaText: "Start selling",
      primaryCtaLink: "suppliers/list.html",
      secondaryCtaText: "How selling works",
      secondaryCtaLink: "#why-sell",
      bleedClass: "depop-hero-bleed--sellers",
      image: PRODUCT_IMG,
    },
    {
      id: "dispatch",
      tag: "Direct dispatch",
      badge: "Seller delivered",
      headline: "Sellers send products straight to you.",
      subtext:
        "No shipping line at checkout. After you pay, the seller coordinates delivery to your drop-off address or landmark.",
      primaryCtaText: "Shop latest finds",
      primaryCtaLink: "#deals",
      secondaryCtaText: "Start selling",
      secondaryCtaLink: "suppliers/list.html",
      bleedClass: "depop-hero-bleed--pickup",
      image: DISPATCH_IMG,
    },
    {
      id: "escrow",
      tag: "Prepaid escrow",
      badge: "Guaranteed until delivery",
      headline: "Shop with peace of mind.",
      subtext:
        "Your M-Pesa stays in Sokoni escrow until you receive the order from the seller. Track every order with SK-####.",
      primaryCtaText: "How escrow works",
      primaryCtaLink: "faq.html",
      secondaryCtaText: "Track an order",
      secondaryCtaLink: "track.html",
      bleedClass: "depop-hero-bleed--escrow",
      image: DISPATCH_IMG,
    },
    {
      id: "circular",
      tag: "Circular fashion",
      badge: "Pre-loved first",
      headline: "Keep clothes in the loop.",
      subtext:
        "Buy and resell pre-loved gems. Less waste, more unique fits — from thrifters and creators across Kenya.",
      primaryCtaText: "Explore pre-loved",
      primaryCtaLink: "#deals",
      primaryFilter: { itemType: "secondhand", scroll: true },
      secondaryCtaText: "Start selling thrift",
      secondaryCtaLink: "suppliers/list.html",
      bleedClass: "depop-hero-bleed--circular",
      image: HERO_IMG,
    },
    {
      id: "offers",
      tag: "In-app offers",
      badge: "Chat the seller",
      headline: "Like it? Make an offer.",
      subtext:
        "Send a custom offer on a listing, or message the seller in-app after they accept — no paying outside Sokoni.",
      primaryCtaText: "Browse & offer",
      primaryCtaLink: "#deals",
      secondaryCtaText: "How Sokoni works",
      secondaryCtaLink: "#how-it-works",
      bleedClass: "depop-hero-bleed--offers",
      image: PRODUCT_IMG,
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
      <div class="depop-hero-bleed ${SLIDES[0].bleedClass}" aria-hidden="true">
        <img class="depop-hero-bleed-img" data-hero-bleed-img src="${escapeHtml(SLIDES[0].image || "")}" alt="" width="1536" height="1024" decoding="async" fetchpriority="high" />
        <div class="depop-hero-bleed-veil"></div>
      </div>
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
    const bleedImg = root.querySelector("[data-hero-bleed-img]");
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
        bleed.className = `depop-hero-bleed depop-hero-bleed--photo ${slide.bleedClass}`;
      }
      if (bleedImg && slide.image) {
        if (bleedImg.getAttribute("src") !== slide.image) {
          bleedImg.setAttribute("src", slide.image);
        }
      }
      if (tagEl) tagEl.textContent = slide.tag;
      if (badgeEl) badgeEl.textContent = `• ${slide.badge}`;
      if (titleEl) titleEl.textContent = slide.headline;
      if (subEl) subEl.textContent = slide.subtext;
      if (primaryEl) {
        primaryEl.textContent = slide.primaryCtaText;
        primaryEl.setAttribute("href", slide.primaryCtaLink);
        if (slide.primaryFilter) {
          primaryEl.setAttribute("data-depop-filter", JSON.stringify(slide.primaryFilter));
        } else {
          primaryEl.removeAttribute("data-depop-filter");
        }
      }
      if (secondaryEl) {
        secondaryEl.textContent = slide.secondaryCtaText;
        secondaryEl.setAttribute("href", slide.secondaryCtaLink);
        if (slide.secondaryFilter) {
          secondaryEl.setAttribute("data-depop-filter", JSON.stringify(slide.secondaryFilter));
        } else {
          secondaryEl.removeAttribute("data-depop-filter");
        }
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

    root.addEventListener("click", (ev) => {
      const filterEl = ev.target.closest("[data-depop-filter]");
      if (!filterEl || !root.contains(filterEl)) return;
      const raw = filterEl.getAttribute("data-depop-filter");
      if (!raw) return;
      ev.preventDefault();
      let spec = { scroll: true };
      try {
        spec = { ...JSON.parse(raw), scroll: true };
      } catch {
        /* ignore */
      }
      if (window.SokoniApp?.setCatalogFilter) {
        window.SokoniApp.setCatalogFilter(spec);
      } else {
        document.getElementById("deals")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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
