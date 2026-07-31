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

  /**
   * Resolve a nav category/sub (including alias tops like Phones → electronics/phones)
   * to the canonical product filter path.
   */
  function resolveNavFilter(categoryId, subcategoryId) {
    const cats = menu?.categories || [];
    const cat = cats.find((c) => c.id === categoryId);
    if (!cat) {
      return { browse: categoryId || null, sub: subcategoryId || null, priceTier: null };
    }

    const sub = subcategoryId
      ? (cat.subcategories || []).find((s) => s.id === subcategoryId)
      : null;

    if (sub?.resolvesTo) {
      return {
        browse: sub.resolvesTo.browse,
        sub: sub.resolvesTo.sub ?? null,
        priceTier: sub.priceTier || null,
      };
    }

    if (sub?.priceTier) {
      return { browse: cat.id, sub: sub.id, priceTier: sub.priceTier };
    }

    if (cat.resolvesTo && !subcategoryId) {
      return {
        browse: cat.resolvesTo.browse,
        sub: cat.resolvesTo.sub ?? null,
        priceTier: null,
      };
    }

    if (cat.resolvesTo && subcategoryId) {
      return {
        browse: cat.resolvesTo.browse,
        sub: cat.resolvesTo.sub ?? subcategoryId,
        priceTier: null,
      };
    }

    return {
      browse: cat.id,
      sub: subcategoryId || null,
      priceTier: sub?.priceTier || null,
    };
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
    resolveNavFilter,
    priceTierMaxKes,
    getMenu: () => menu,
  };
})();
