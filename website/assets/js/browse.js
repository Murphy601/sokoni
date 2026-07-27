/**
 * Phase 2 — Depop-style browse taxonomy helpers for the storefront.
 */
(function () {
  function catalogCacheBust() {
    const meta = document.querySelector('meta[name="sokoni-catalog-version"]');
    return meta?.getAttribute("content") || String(Date.now());
  }

  function dataUrl(file) {
    return `${file}?v=${catalogCacheBust()}`;
  }

  /** @type {Record<string, unknown> | null} */
  let menu = null;

  async function loadMenu() {
    if (menu) return menu;
    try {
      const res = await fetch(dataUrl("data/browse-menu.json"));
      if (res.ok) menu = await res.json();
    } catch {
      menu = null;
    }
    return menu;
  }

  function resolveBrowsePath(product) {
    if (!product) return { browse: "trending", sub: "streetwear" };
    if (product.browseCategory) {
      return {
        browse: product.browseCategory,
        sub: product.browseSubCategory || null,
      };
    }
    const legacyMap = menu?.legacyMap || {};
    const full = product.subcategory
      ? `${product.category}/${product.subcategory}`
      : product.category;
    return (
      legacyMap[full] ||
      legacyMap[product.category] || { browse: "trending", sub: "streetwear" }
    );
  }

  function enrichProduct(product) {
    const path = resolveBrowsePath(product);
    return {
      ...product,
      browseCategory: path.browse,
      browseSubCategory: path.sub,
    };
  }

  function labelForBrowse(browseId, subId) {
    const cat = menu?.categories?.find((c) => c.id === browseId);
    if (!subId) return cat?.label || browseId;
    const sub = cat?.subcategories?.find((s) => s.id === subId);
    return sub?.label || subId;
  }

  function priceTierMaxKes(tierId) {
    const tier = menu?.priceTiers?.find((t) => t.id === tierId);
    return tier?.maxKes ?? null;
  }

  window.SokoniBrowse = {
    loadMenu,
    resolveBrowsePath,
    enrichProduct,
    labelForBrowse,
    priceTierMaxKes,
    getMenu: () => menu,
  };
})();
