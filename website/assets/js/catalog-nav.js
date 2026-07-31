/**
 * Depop-style left browse navigator — Women / Men / Kids / Sale / etc.
 * Syncs with app.js filters via SokoniCatalogNav.sync().
 */
(function () {
  const MAX_PRODUCTS_PER_SUB = 8;
  let menuData = null;
  let productsByKey = new Map();
  let expandedCategories = new Set();
  let expandedSubcategories = new Set();
  let isOpen = false;
  let onNavigate = null;
  let selection = { category: "all", subcategory: null, productId: null };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function catIconHtml(cat) {
    if (cat?.image) {
      return `<span class="catalog-nav-emoji catalog-nav-emoji--img" aria-hidden="true"><img src="${escapeHtml(cat.image)}" alt="" width="22" height="22" loading="lazy" /></span>`;
    }
    return `<span class="catalog-nav-emoji" aria-hidden="true">${escapeHtml(cat?.emoji || "🛍️")}</span>`;
  }

  function truncateName(name, max = 42) {
    const n = String(name || "").replace(/\s+/g, " ").trim();
    return n.length <= max ? n : `${n.slice(0, max - 1)}…`;
  }

  function dataUrl(file) {
    const meta = document.querySelector('meta[name="sokoni-catalog-version"]');
    const v = meta?.getAttribute("content") || String(Date.now());
    return `${file}?v=${v}`;
  }

  function productKey(browseCat, browseSub) {
    return `${browseCat}::${browseSub || ""}`;
  }

  function resolveBrowse(product) {
    if (window.SokoniBrowse) return window.SokoniBrowse.resolveBrowsePath(product);
    return {
      browse: product.browseCategory || product.category,
      sub: product.browseSubCategory || product.subcategory,
    };
  }

  function buildProductIndex(products) {
    productsByKey = new Map();
    for (const p of products) {
      const path = resolveBrowse(p);
      if (!path.browse) continue;
      const key = productKey(path.browse, path.sub);
      if (!productsByKey.has(key)) productsByKey.set(key, []);
      productsByKey.get(key).push(p);
    }
    for (const list of productsByKey.values()) {
      list.sort((a, b) => (b.reviews || 0) - (a.reviews || 0) || (a.name || "").localeCompare(b.name || ""));
    }
  }

  function resolveNav(categoryId, subId) {
    return (
      window.SokoniBrowse?.resolveNavFilter?.(categoryId, subId) || {
        browse: categoryId,
        sub: subId,
      }
    );
  }

  /** Products under a nav sub — honors resolvesTo (including browse-only aliases). */
  function productsForSub(categoryId, subId) {
    const nav = resolveNav(categoryId, subId);
    if (!nav?.browse) return [];
    if (nav.sub) return productsByKey.get(productKey(nav.browse, nav.sub)) || [];
    // sub null → all products in that browse category
    const out = [];
    for (const [key, list] of productsByKey.entries()) {
      if (key === nav.browse || key.startsWith(`${nav.browse}::`)) {
        out.push(...list);
      }
    }
    return out;
  }

  function countForSub(categoryId, subId) {
    return productsForSub(categoryId, subId).length;
  }

  function findSubDef(categoryId, subId) {
    const cat = menuData?.categories?.find((c) => c.id === categoryId);
    return cat?.subcategories?.find((s) => s.id === subId) || null;
  }

  function isActiveCategory(id) {
    return selection.category === id && !selection.subcategory && !selection.productId;
  }

  function isActiveSub(categoryId, subId) {
    return selection.category === categoryId && selection.subcategory === subId && !selection.productId;
  }

  function isActiveProduct(productId) {
    return selection.productId === productId;
  }

  function renderPanel() {
    const panel = document.getElementById("catalog-nav-panel");
    if (!panel || !menuData) return;

    const topItems = [
      { id: "all", label: "All Products", emoji: "🛍️", type: "top" },
      { id: "viral", label: "Viral Bargains", emoji: "🔥", type: "top" },
    ];

    let html = `
      <div class="catalog-nav-header">
        <div>
          <p class="catalog-nav-title">Browse</p>
          <p class="catalog-nav-sub">Women · Men · Kids · Sale</p>
        </div>
        <button type="button" class="catalog-nav-close" id="catalog-nav-close" aria-label="Close browse menu">×</button>
      </div>
      <div class="catalog-nav-scroll" id="catalog-nav-scroll">
    `;

    for (const item of topItems) {
      html += `
        <button type="button" class="catalog-nav-item catalog-nav-top ${isActiveCategory(item.id) ? "is-active" : ""}"
          data-nav-type="top" data-category="${item.id}">
          ${catIconHtml(item)}
          <span class="catalog-nav-label">${item.label}</span>
        </button>`;
    }

    html += `<div class="catalog-nav-divider" role="separator"></div>`;

    for (const cat of menuData.categories || []) {
      const catExpanded = expandedCategories.has(cat.id);
      const catActive = selection.category === cat.id;
      html += `
        <div class="catalog-nav-group ${catExpanded ? "is-expanded" : ""}" data-category-group="${cat.id}">
          <button type="button" class="catalog-nav-item catalog-nav-cat ${catActive && !selection.subcategory ? "is-active" : ""}"
            data-nav-type="category" data-category="${cat.id}" aria-expanded="${catExpanded}">
            <span class="catalog-nav-chevron" aria-hidden="true"></span>
            ${catIconHtml(cat)}
            <span class="catalog-nav-label">${escapeHtml(cat.label)}</span>
          </button>
          <div class="catalog-nav-children" ${catExpanded ? "" : "hidden"}>
      `;

      for (const sub of cat.subcategories || []) {
        const count = countForSub(cat.id, sub.id);
        const subKey = `${cat.id}::${sub.id}`;
        const subExpanded = expandedSubcategories.has(subKey);
        const products = productsForSub(cat.id, sub.id).slice(0, MAX_PRODUCTS_PER_SUB);
        const more = count - products.length;

        html += `
          <div class="catalog-nav-subgroup ${subExpanded ? "is-expanded" : ""}">
            <button type="button" class="catalog-nav-item catalog-nav-sub ${isActiveSub(cat.id, sub.id) ? "is-active" : ""}"
              data-nav-type="subcategory" data-category="${cat.id}" data-subcategory="${sub.id}" aria-expanded="${subExpanded}">
              <span class="catalog-nav-chevron catalog-nav-chevron--sm" aria-hidden="true"></span>
              <span class="catalog-nav-label">${escapeHtml(sub.label)}</span>
              ${count ? `<span class="catalog-nav-count">${count}</span>` : ""}
            </button>
            <div class="catalog-nav-products" ${subExpanded ? "" : "hidden"}>
        `;

        for (const p of products) {
          html += `
            <button type="button" class="catalog-nav-item catalog-nav-product ${isActiveProduct(p.id) ? "is-active" : ""}"
              data-nav-type="product" data-category="${cat.id}" data-subcategory="${sub.id}" data-product-id="${p.id}">
              <span class="catalog-nav-label">${escapeHtml(truncateName(p.name))}</span>
            </button>`;
        }

        if (more > 0) {
          html += `
            <button type="button" class="catalog-nav-item catalog-nav-more"
              data-nav-type="subcategory" data-category="${cat.id}" data-subcategory="${sub.id}">
              <span class="catalog-nav-label">+ ${more} more in ${escapeHtml(sub.label)}</span>
            </button>`;
        }

        html += `</div></div>`;
      }

      html += `</div></div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;
    bindPanelEvents(panel);
  }

  function navigateFromSub(category, subcategory) {
    const subDef = findSubDef(category, subcategory);
    const priceTier = subDef?.priceTier || (category === "sale" ? subcategory : null);
    if (onNavigate) {
      onNavigate({
        category,
        subcategory,
        productId: null,
        priceTier,
        scroll: true,
      });
    }
  }

  function bindPanelEvents(panel) {
    panel.querySelector("#catalog-nav-close")?.addEventListener("click", closePanel);

    panel.querySelectorAll("[data-nav-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.navType;
        const category = btn.dataset.category;
        const subcategory = btn.dataset.subcategory || null;
        const productId = btn.dataset.productId || null;

        if (type === "category") {
          if (expandedCategories.has(category)) {
            expandedCategories.delete(category);
          } else {
            expandedCategories.add(category);
          }
          if (onNavigate) {
            onNavigate({
              category,
              subcategory: null,
              productId: null,
              priceTier: category === "sale" ? null : null,
              scroll: true,
            });
          }
          renderPanel();
          return;
        }

        if (type === "subcategory") {
          const key = `${category}::${subcategory}`;
          expandedCategories.add(category);
          if (expandedSubcategories.has(key)) {
            expandedSubcategories.delete(key);
          } else {
            expandedSubcategories.add(key);
          }
          navigateFromSub(category, subcategory);
          renderPanel();
          return;
        }

        if (type === "top") {
          expandedCategories.clear();
          expandedSubcategories.clear();
          if (onNavigate) {
            onNavigate({
              category,
              subcategory: null,
              productId: null,
              priceTier: null,
              scroll: true,
            });
          }
          closePanel();
          return;
        }

        if (type === "product") {
          expandedCategories.add(category);
          expandedSubcategories.add(`${category}::${subcategory}`);
          const subDef = findSubDef(category, subcategory);
          if (onNavigate) {
            onNavigate({
              category,
              subcategory,
              productId,
              priceTier: subDef?.priceTier || (category === "sale" ? subcategory : null),
              scroll: true,
            });
          }
          closePanel();
        }
      });
    });
  }

  function syncToggleUi() {
    const toggle = document.getElementById("catalog-nav-toggle");
    const icon = toggle?.querySelector(".catalog-nav-toggle-icon");
    const label = toggle?.querySelector(".catalog-nav-toggle-label");
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.setAttribute("aria-label", isOpen ? "Close browse menu" : "Open browse menu");
    if (icon) icon.textContent = isOpen ? "✕" : "☰";
    if (label) label.textContent = isOpen ? "Close" : "Browse";
    toggle.classList.toggle("is-open", isOpen);
  }

  function openPanel() {
    // Mobile / narrow: left drawer. Desktop uses embedded category rail (no modal).
    window.SokoniMegaMenu?.close?.();
    const panel = document.getElementById("catalog-nav-panel");
    const backdrop = document.getElementById("catalog-nav-backdrop");
    if (!panel) return;
    isOpen = true;
    panel.classList.add("is-open");
    panel.removeAttribute("hidden");
    backdrop?.classList.add("is-open");
    backdrop?.removeAttribute("hidden");
    document.body.classList.add("catalog-nav-open");
    syncToggleUi();
    renderPanel();
  }

  function closePanel() {
    const panel = document.getElementById("catalog-nav-panel");
    const backdrop = document.getElementById("catalog-nav-backdrop");
    if (!panel) return;
    isOpen = false;
    panel.classList.remove("is-open");
    panel.setAttribute("hidden", "");
    backdrop?.classList.remove("is-open");
    backdrop?.setAttribute("hidden", "");
    document.body.classList.remove("catalog-nav-open");
    syncToggleUi();
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function sync(next) {
    selection = { ...selection, ...next };
    if (selection.category && selection.category !== "all" && selection.category !== "viral") {
      expandedCategories.add(selection.category);
    }
    if (selection.category && selection.subcategory) {
      expandedSubcategories.add(`${selection.category}::${selection.subcategory}`);
    }
    if (isOpen) renderPanel();
  }

  async function init({ products, navigate }) {
    onNavigate = navigate;
    buildProductIndex(products || []);

    await window.SokoniBrowse?.loadMenu?.();
    menuData = window.SokoniBrowse?.getMenu?.() || null;
    if (!menuData) {
      try {
        const res = await fetch(dataUrl("data/browse-menu.json"));
        if (res.ok) menuData = await res.json();
      } catch {
        menuData = null;
      }
    }

    const toggle = document.getElementById("catalog-nav-toggle");
    const backdrop = document.getElementById("catalog-nav-backdrop");
    toggle?.addEventListener("click", togglePanel);
    backdrop?.addEventListener("click", closePanel);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) closePanel();
    });

    closePanel();
    renderPanel();
  }

  window.SokoniCatalogNav = { init, sync, open: openPanel, close: closePanel };
})();
