/**
 * Below-hero promo carousel — brands stay above; slides rotate every 4s.
 * Independent of #depop-hero-carousel.
 */
(function () {
  const INTERVAL_MS = 4000;

  function mount() {
    const root = document.getElementById("depop-promo-carousel");
    const track = document.getElementById("depop-promo-track");
    const dotsWrap = document.getElementById("depop-promo-dots");
    if (!root || !track || !dotsWrap) return;

    const slides = [...track.querySelectorAll("[data-promo-slide]")];
    if (slides.length < 2) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let index = 0;
    let timer = null;

    dotsWrap.innerHTML = slides
      .map(
        (_, i) =>
          `<button type="button" class="depop-promo-dot${i === 0 ? " is-active" : ""}" role="tab" aria-label="Show featured slide ${i + 1}" aria-selected="${i === 0 ? "true" : "false"}" data-promo-index="${i}"></button>`
      )
      .join("");

    const dots = [...dotsWrap.querySelectorAll(".depop-promo-dot")];

    function render(i) {
      index = ((i % slides.length) + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      dots.forEach((dot, di) => {
        const active = di === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    function restart() {
      if (timer) clearInterval(timer);
      timer = null;
      if (reducedMotion) return;
      timer = setInterval(() => render(index + 1), INTERVAL_MS);
    }

    dotsWrap.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-promo-index]");
      if (!btn) return;
      render(Number(btn.getAttribute("data-promo-index")) || 0);
      restart();
    });

    root.addEventListener("mouseenter", () => {
      if (timer) clearInterval(timer);
      timer = null;
    });
    root.addEventListener("mouseleave", restart);

    root.addEventListener("focusin", () => {
      if (timer) clearInterval(timer);
      timer = null;
    });
    root.addEventListener("focusout", (ev) => {
      if (!root.contains(ev.relatedTarget)) restart();
    });

    render(0);
    restart();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
