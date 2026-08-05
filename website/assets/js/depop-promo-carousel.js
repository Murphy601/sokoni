/**
 * Below-hero promo rotator — same idea as the hero carousel:
 * swap image + copy in place (no horizontal translate that blanks the panel).
 * Dual-image crossfade keeps the previous photo visible until the next one is ready.
 */
(function () {
  const INTERVAL_MS = 4000;

  const SLIDES = [
    {
      image: "assets/images/marketing/product-sneakers.jpg",
      alt: "Vintage streetwear sneakers on a dark studio podium",
      kicker: "Pre-loved finds",
      title: "Studio-clean shots. Real thrift heat.",
      sub:
        "Sellers list sneakers, denim, and streetwear with clear photos — you pay on M-Pesa, escrow holds until delivery.",
      primaryText: "Shop pre-loved",
      primaryHref: "#deals",
      secondaryText: "List your kicks",
      secondaryHref: "suppliers/list.html",
    },
    {
      image: "assets/images/marketing/how-it-works-dispatch.jpg",
      alt: "Buyer with a tote of pre-loved fashion — direct dispatch",
      kicker: "Direct dispatch · Seller delivered",
      title: "Sellers send products straight to you.",
      sub:
        "No shipping line at checkout. After you pay, the seller coordinates delivery to your drop-off address or landmark.",
      primaryText: "Shop latest finds",
      primaryHref: "#deals",
      secondaryText: "Start selling",
      secondaryHref: "suppliers/list.html",
    },
    {
      image: "assets/images/marketing/hero-banner-thrift.jpg",
      alt: "African thrift streetwear editorial — circular fashion",
      kicker: "Circular fashion · Pre-loved first",
      title: "Keep clothes in the loop.",
      sub:
        "Buy and resell pre-loved gems. Less waste, more unique fits — from thrifters and creators across Kenya.",
      primaryText: "Explore pre-loved",
      primaryHref: "#deals",
      secondaryText: "Start selling thrift",
      secondaryHref: "suppliers/list.html",
    },
    {
      image: "assets/images/marketing/escrow-mpesa-security.jpg",
      alt: "Smartphone showing a green digital security shield for M-Pesa escrow",
      kicker: "Prepaid escrow · Buyer protection",
      title: "Shop with peace of mind.",
      sub:
        "Your M-Pesa stays in Sokoni escrow until you receive the order. Track every purchase with SK-####.",
      primaryText: "How escrow works",
      primaryHref: "faq.html",
      secondaryText: "Track an order",
      secondaryHref: "track.html",
    },
    {
      image: "assets/images/marketing/category-vintage-denim.jpg",
      alt: "Vintage denim jackets and outerwear on black hangers",
      kicker: "Category · Vintage denim & outerwear",
      title: "Denim, leather, and 90s heat.",
      sub:
        "Browse upcycled jackets and coats from thrifters across Kenya — clear photos, prepaid checkout.",
      primaryText: "Shop outerwear",
      primaryHref: "#deals",
      secondaryText: "Browse categories",
      secondaryHref: "#categories",
    },
    {
      image: "assets/images/marketing/category-rare-kicks.jpg",
      alt: "Limited-edition streetwear sneakers on a dark reflective surface",
      kicker: "Category · Rare kicks",
      title: "Sneaker heat, studio-clean.",
      sub:
        "Limited pairs and streetwear staples from sellers who shoot clear product photos — offer or buy now.",
      primaryText: "Shop sneakers",
      primaryHref: "#deals",
      secondaryText: "List your kicks",
      secondaryHref: "suppliers/list.html",
    },
    {
      image: "assets/images/marketing/seller-closet-cash.jpg",
      alt: "Seller arranging thrift streetwear on a rack in a dark studio",
      kicker: "For sellers · Zero listing fees",
      title: "Turn your closet into cash.",
      sub:
        "List brand new or pre-loved in minutes. Buyers pay upfront — you dispatch, then get paid after delivery.",
      primaryText: "Start selling",
      primaryHref: "suppliers/list.html",
      secondaryText: "How selling works",
      secondaryHref: "#why-sell",
    },
    {
      image: "assets/images/marketing/whatsapp-mobile-commerce.jpg",
      alt: "Shopper checking her phone on a Nairobi street at sunset",
      kicker: "WhatsApp commerce · Fast checkout",
      title: "Order from your phone in minutes.",
      sub:
        "Browse on Sokoni, pay with M-Pesa, and message sellers in-app or on WhatsApp when you need a human.",
      primaryText: "Shop latest finds",
      primaryHref: "#deals",
      secondaryText: "Chat on WhatsApp",
      secondaryHref: "https://wa.me/254117422428",
    },
    {
      image: "assets/images/marketing/trust-exchange-nairobi.jpg",
      alt: "Seller and buyer shaking hands over a Sokoni Marketplace bag with Track ID SKN-572198-XY",
      kicker: "Trusted exchange · SK tracking",
      title: "Meet, hand over, track with confidence.",
      sub:
        "Prepaid escrow holds the M-Pesa until delivery. Every order gets an SK track ID — scan, follow, and shop with trust.",
      primaryText: "Track an order",
      primaryHref: "track.html",
      secondaryText: "How escrow works",
      secondaryHref: "faq.html",
    },
    {
      image: "assets/images/marketing/inspect-before-pay.jpg",
      alt: "Buyer scanning a QR code while unboxing pre-loved sneakers at a Nairobi coffee shop",
      kicker: "Inspect before you pay · Quality check",
      title: "Verify the fit before you commit.",
      sub:
        "Scan the package QR, check condition photos, and confirm authenticity — escrow keeps your M-Pesa safe until you’re happy.",
      primaryText: "Shop sneakers",
      primaryHref: "#deals",
      secondaryText: "How escrow works",
      secondaryHref: "faq.html",
    },
    {
      image: "assets/images/marketing/dropoff-hub.jpg",
      alt: "Staff at a Sokoni drop-off hub handing a branded bag to a courier",
      kicker: "Drop-off hubs · Across Kenya",
      title: "Hand it in at a Sokoni hub.",
      sub:
        "Sellers drop parcels at partner counters in Nairobi CBD and major towns — couriers pick up, buyers track with SK-####.",
      primaryText: "Start selling",
      primaryHref: "suppliers/list.html",
      secondaryText: "How it works",
      secondaryHref: "#how-it-works",
    },
    {
      image: "assets/images/marketing/sokoni-mashinani-farm.jpg",
      alt: "Kenyan farmer handing a crate of fresh tomatoes and avocados to a courier beside a pickup truck",
      kicker: "Sokoni Mashinani · Direct from the farm",
      title: "Fresh from the farm — skip the middleman.",
      sub:
        "Buy produce, livestock, and raw agricultural goods from verified farmers across Nakuru, Eldoret, Meru, and Kisumu — fresh dispatch via local parcel networks.",
      primaryText: "Shop latest finds",
      primaryHref: "#deals",
      secondaryText: "Trade across Kenya",
      secondaryHref: "#trade-across-kenya",
    },
    {
      image: "assets/images/marketing/sokoni-local-artisan.jpg",
      alt: "Kenyan craftsman in a woodwork shop holding a finished wooden coffee table",
      kicker: "Local artisans · Makers & crafts",
      title: "Empowering local artisans & crafts.",
      sub:
        "From custom wood furniture to hand-woven kitenge wear, Sokoni gives local makers a digital storefront — buyers pay safely with M-Pesa escrow.",
      primaryText: "Start selling",
      primaryHref: "suppliers/list.html",
      secondaryText: "Browse finds",
      secondaryHref: "#deals",
    },
    {
      image: "assets/images/marketing/sokoni-county-courier.jpg",
      alt: "Courier loading Sokoni Marketplace boxes onto a transport vehicle at a Kenyan parcel depot",
      kicker: "County-to-county · Nationwide parcel",
      title: "Nationwide delivery to any county.",
      sub:
        "Whether you're ordering from Nairobi CBD or shipping from a village in Nyeri, our door-to-hub parcel network tracks delivery to your nearest town centre.",
      primaryText: "Track an order",
      primaryHref: "track.html",
      secondaryText: "How it works",
      secondaryHref: "#how-it-works",
    },
    {
      image: "assets/images/marketing/empty-search.jpg",
      alt: "Minimal dark clothing rack with a spotlight on a sneaker box — nothing listed yet",
      kicker: "Nothing listed yet · Be first",
      title: "That search is still waiting for a drop.",
      sub:
        "No matching listings right now. Try another keyword — or list the piece yourself and sell it on Sokoni.",
      primaryText: "Browse all finds",
      primaryHref: "#deals",
      secondaryText: "List an item",
      secondaryHref: "suppliers/list.html",
    },
  ];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function preload(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  function mount() {
    const root = document.getElementById("depop-promo-carousel");
    const dotsWrap = document.getElementById("depop-promo-dots");
    if (!root || !dotsWrap || SLIDES.length < 2) return;

    const imgA = root.querySelector('[data-promo-img="a"]');
    const imgB = root.querySelector('[data-promo-img="b"]');
    const kickerEl = root.querySelector("[data-promo-kicker]");
    const titleEl = root.querySelector("[data-promo-title]");
    const subEl = root.querySelector("[data-promo-sub]");
    const primaryEl = root.querySelector("[data-promo-primary]");
    const secondaryEl = root.querySelector("[data-promo-secondary]");
    if (!imgA || !imgB) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let index = 0;
    let activeLayer = "a";
    let timer = null;
    let busy = false;

    // Warm the cache so swaps don't flash empty.
    SLIDES.forEach((slide) => {
      void preload(slide.image);
    });

    dotsWrap.innerHTML = SLIDES.map(
      (slide, i) =>
        `<button type="button" class="depop-promo-dot${i === 0 ? " is-active" : ""}" role="tab" aria-label="Show featured slide ${i + 1}: ${escapeHtml(slide.kicker)}" aria-selected="${i === 0 ? "true" : "false"}" data-promo-index="${i}"></button>`
    ).join("");

    const dots = [...dotsWrap.querySelectorAll(".depop-promo-dot")];

    function applyCopy(slide) {
      if (kickerEl) kickerEl.textContent = slide.kicker;
      if (titleEl) titleEl.textContent = slide.title;
      if (subEl) subEl.textContent = slide.sub;
      if (primaryEl) {
        primaryEl.textContent = slide.primaryText;
        primaryEl.setAttribute("href", slide.primaryHref);
      }
      if (secondaryEl) {
        secondaryEl.textContent = slide.secondaryText;
        secondaryEl.setAttribute("href", slide.secondaryHref);
      }
    }

    function syncDots() {
      dots.forEach((dot, di) => {
        const active = di === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    async function render(i) {
      const next = ((i % SLIDES.length) + SLIDES.length) % SLIDES.length;
      if (busy && next !== index) return;
      const slide = SLIDES[next];
      if (!slide) return;

      index = next;
      applyCopy(slide);
      syncDots();

      const currentImg = activeLayer === "a" ? imgA : imgB;
      const nextImg = activeLayer === "a" ? imgB : imgA;

      if (currentImg.getAttribute("src") === slide.image) {
        currentImg.alt = slide.alt;
        return;
      }

      busy = true;
      await preload(slide.image);
      nextImg.alt = slide.alt;
      nextImg.setAttribute("src", slide.image);

      if (reducedMotion) {
        currentImg.classList.remove("is-active");
        nextImg.classList.add("is-active");
        activeLayer = activeLayer === "a" ? "b" : "a";
        busy = false;
        return;
      }

      // Keep current visible; fade next in on top — no dark gap.
      nextImg.classList.add("is-active");
      window.setTimeout(() => {
        currentImg.classList.remove("is-active");
        activeLayer = activeLayer === "a" ? "b" : "a";
        busy = false;
      }, 420);
    }

    function restart() {
      if (timer) clearInterval(timer);
      timer = null;
      if (reducedMotion) return;
      timer = setInterval(() => {
        void render(index + 1);
      }, INTERVAL_MS);
    }

    dotsWrap.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-promo-index]");
      if (!btn) return;
      void render(Number(btn.getAttribute("data-promo-index")) || 0);
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

    applyCopy(SLIDES[0]);
    syncDots();
    restart();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
