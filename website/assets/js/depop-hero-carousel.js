/**
 * Dynamic 3-slide hero carousel — sellers, AI listing, prepaid buyer protection.
 */
(function () {
  const SLIDES = [
    {
      eyebrow: "For sellers",
      title: "0% selling fees — keep 100% of your earnings",
      subtitle:
        "List brand new merchandise or thrift your wardrobe with zero platform commissions. Payout goes straight to you.",
      ctaText: "Start selling",
      ctaLink: "suppliers/list.html",
      gradient: "depop-hero-slide--fees",
    },
    {
      eyebrow: "AI listing",
      title: "Snap & list in seconds with AI",
      subtitle:
        "Upload a photo — AI cleans backgrounds, writes titles, tags, and suggests prices automatically.",
      ctaText: "Try AI listing",
      ctaLink: "suppliers/list.html",
      gradient: "depop-hero-slide--ai",
    },
    {
      eyebrow: "Buyer protection",
      title: "100% safe prepaid shopping",
      subtitle:
        "Every item is backed by escrow buyer protection with instant SK-#### tracking via Sokoni drop-offs.",
      ctaText: "Shop latest fits",
      ctaLink: "#deals",
      gradient: "depop-hero-slide--prepaid",
    },
  ];

  let current = 0;
  let timer = null;
  let reducedMotion = false;

  function mount() {
    const root = document.getElementById("depop-hero-carousel");
    if (!root) return;

    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    root.innerHTML = `
      <div class="depop-hero-carousel-inner">
        <div class="depop-hero-slide-wrap" id="depop-hero-slide-wrap"></div>
        <div class="depop-hero-dots" id="depop-hero-dots" role="tablist" aria-label="Hero banners"></div>
      </div>`;

    renderSlide(false);
    buildDots();
    if (!reducedMotion) startTimer();

    root.addEventListener("mouseenter", stopTimer);
    root.addEventListener("mouseleave", startTimer);
    root.addEventListener("focusin", stopTimer);
    root.addEventListener("focusout", startTimer);
  }

  function renderSlide(animate) {
    const slide = SLIDES[current];
    const wrap = document.getElementById("depop-hero-slide-wrap");
    if (!wrap || !slide) return;

    wrap.classList.toggle("is-animating", animate);
    wrap.innerHTML = `
      <article class="depop-hero-slide ${slide.gradient}" aria-live="polite">
        <span class="depop-hero-eyebrow">${slide.eyebrow}</span>
        <h1 class="depop-hero-title">${slide.title}</h1>
        <p class="depop-hero-sub">${slide.subtitle}</p>
        <div class="depop-hero-actions">
          <a href="${slide.ctaLink}" class="depop-hero-cta depop-hero-cta--primary">${slide.ctaText} →</a>
        </div>
      </article>`;

    document.querySelectorAll(".depop-hero-dot").forEach((dot, i) => {
      dot.classList.toggle("is-active", i === current);
      dot.setAttribute("aria-selected", i === current ? "true" : "false");
    });
  }

  function buildDots() {
    const dots = document.getElementById("depop-hero-dots");
    if (!dots) return;
    dots.innerHTML = SLIDES.map(
      (_, i) =>
        `<button type="button" class="depop-hero-dot${i === 0 ? " is-active" : ""}" role="tab" aria-selected="${i === 0 ? "true" : "false"}" aria-label="Banner ${i + 1}"></button>`
    ).join("");
    dots.querySelectorAll(".depop-hero-dot").forEach((btn, i) => {
      btn.addEventListener("click", () => goTo(i));
    });
  }

  function goTo(index) {
    current = ((index % SLIDES.length) + SLIDES.length) % SLIDES.length;
    renderSlide(true);
    if (!reducedMotion) {
      stopTimer();
      startTimer();
    }
  }

  function startTimer() {
    if (reducedMotion) return;
    stopTimer();
    timer = window.setInterval(() => goTo(current + 1), 5000);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
