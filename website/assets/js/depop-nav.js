/**
 * Depop-style header — category strip from browse-menu, search sync, bottom nav.
 */
(function () {
  function scrollToDeals() {
    document.getElementById("deals")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyFilter(spec) {
    if (window.SokoniApp?.setCatalogFilter) {
      window.SokoniApp.setCatalogFilter({ ...spec, scroll: true });
    } else {
      scrollToDeals();
    }
  }

  function bindFilterButtons(root) {
    root.querySelectorAll("[data-depop-filter]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const raw = el.getAttribute("data-depop-filter");
        let spec = { category: "all", itemType: "all", priceTier: null };
        try {
          spec = JSON.parse(raw || "{}");
        } catch {
          /* ignore */
        }
        document.querySelectorAll(".depop-cat-strip .is-active, .depop-collection-card.is-active").forEach((n) => {
          n.classList.remove("is-active");
        });
        el.classList.add("is-active");
        applyFilter(spec);
      });
    });
  }

  async function populateCategoryStrip() {
    const strip = document.getElementById("depop-cat-strip");
    if (!strip) return;

    await window.SokoniBrowse?.loadMenu?.();
    const menu = window.SokoniBrowse?.getMenu?.();
    const cats = menu?.categories || [];

    const staticChips = [
      { label: "♻️ Pre-Loved", filter: { itemType: "secondhand", scroll: true }, className: "tag-thrift" },
      { label: "✨ Brand New", filter: { itemType: "new", scroll: true }, className: "tag-new" },
      { label: "🔥 Trending", filter: { category: "trending", scroll: true } },
    ];

    let html = cats
      .slice(0, 10)
      .map(
        (c) =>
          `<button type="button" data-depop-filter='${JSON.stringify({ category: c.id, scroll: true })}'>${c.emoji || ""} ${c.label}</button>`
      )
      .join("");

    html += staticChips
      .map(
        (chip) =>
          `<button type="button" class="${chip.className || ""}" data-depop-filter='${JSON.stringify(chip.filter)}'>${chip.label}</button>`
      )
      .join("");

    strip.innerHTML = html;
    bindFilterButtons(strip);
  }

  function bindCategoryStrip() {
    const strip = document.getElementById("depop-cat-strip");
    if (strip?.children.length) {
      bindFilterButtons(strip);
      return;
    }
    populateCategoryStrip();
  }

  function bindCollections() {
    const row = document.getElementById("depop-collections-row");
    if (row) bindFilterButtons(row);
  }

  function bindSearchForms() {
    const ids = ["depop-search-form", "depop-search-form-mobile", "shop-search-form"];
    ids.forEach((formId) => {
      const form = document.getElementById(formId);
      const input = form?.querySelector("input[type='search']");
      if (!form || !input) return;
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = input.value.trim();
        window.SokoniShopShell?.syncSearchInputs?.(q);
        if (window.SokoniApp?.runSearch) {
          window.SokoniApp.runSearch(q);
        }
        scrollToDeals();
      });
    });
  }

  function focusMobileSearch() {
    const input = document.getElementById("depop-search-mobile") || document.getElementById("depop-search");
    input?.focus();
    input?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function bindHeaderSearchToggle() {
    document.getElementById("depop-search-toggle")?.addEventListener("click", () => {
      const wrap = document.querySelector(".depop-mobile-search-row");
      wrap?.classList.toggle("is-open");
      focusMobileSearch();
    });
  }

  function setBottomNavActive(navKey) {
    document.querySelectorAll(".depop-bottom-nav__item[data-depop-nav]").forEach((el) => {
      const key = el.getAttribute("data-depop-nav");
      if (key === "sell") return;
      el.classList.toggle("is-active", Boolean(navKey) && key === navKey);
    });
  }

  function syncBottomNavFromLocation() {
    const path = (window.location.pathname || "").toLowerCase();
    const hash = window.location.hash;
    if (path.includes("suppliers/list")) {
      setBottomNavActive(null);
      return;
    }
    if (path.includes("inbox")) {
      setBottomNavActive("inbox");
      return;
    }
    if (path.includes("activity")) {
      setBottomNavActive("activity");
      return;
    }
    if (path.includes("track")) {
      setBottomNavActive("track");
      return;
    }
    if (hash === "#deals") {
      setBottomNavActive("explore");
      return;
    }
    setBottomNavActive("home");
  }

  function bindBottomNav() {
    syncBottomNavFromLocation();
    window.addEventListener("hashchange", syncBottomNavFromLocation);

    document.querySelectorAll(".depop-bottom-nav__item[data-depop-nav]").forEach((link) => {
      link.addEventListener("click", (e) => {
        const action = link.getAttribute("data-depop-nav");
        if (action === "explore") {
          e.preventDefault();
          setBottomNavActive("explore");
          if (window.SokoniCatalogNav?.open) {
            window.SokoniCatalogNav.open();
          } else {
            focusMobileSearch();
            scrollToDeals();
          }
          return;
        }
        if (action === "search") {
          e.preventDefault();
          setBottomNavActive("search");
          focusMobileSearch();
          scrollToDeals();
          return;
        }
        if (action === "home") {
          setBottomNavActive("home");
          return;
        }
        if (action === "activity" || action === "inbox" || action === "track" || action === "profile") {
          setBottomNavActive(action === "profile" ? "activity" : action);
          return;
        }
        if (action === "bag") {
          e.preventDefault();
          window.SokoniShopShell?.openBag?.();
        }
      });
    });
  }

  async function init() {
    bindCategoryStrip();
    bindCollections();
    bindSearchForms();
    bindHeaderSearchToggle();
    bindBottomNav();
    const footer = document.getElementById("site-footer");
    if (footer) bindFilterButtons(footer);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
