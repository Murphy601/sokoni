/**
 * Depop-style header — category strip, search sync, bottom nav.
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

  function bindCategoryStrip() {
    document.querySelectorAll("[data-depop-filter]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const raw = el.getAttribute("data-depop-filter");
        let spec = { category: "all", itemType: "all", priceTier: null };
        try {
          spec = JSON.parse(raw || "{}");
        } catch {
          /* ignore */
        }
        document.querySelectorAll(".depop-cat-strip .is-active").forEach((n) => n.classList.remove("is-active"));
        el.classList.add("is-active");
        applyFilter(spec);
      });
    });
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

  function bindBottomNav() {
    document.querySelectorAll(".depop-bottom-nav a[data-depop-nav]").forEach((link) => {
      link.addEventListener("click", (e) => {
        const action = link.getAttribute("data-depop-nav");
        if (action === "explore") {
          e.preventDefault();
          window.SokoniCatalogNav?.open?.();
        }
        if (action === "bag") {
          e.preventDefault();
          window.SokoniShopShell?.openBag?.();
        }
      });
    });
  }

  function init() {
    bindCategoryStrip();
    bindSearchForms();
    bindBottomNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
