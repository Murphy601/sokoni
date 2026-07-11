/**
 * Shopify-style left catalog navigator — categories → subcategories → products.
 * Floating panel on the left; syncs with app.js filters.
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

  function truncateName(name, max = 42) {
    const n = String(name || "").replace(/\s+/g, " ").trim();
    return n.length <= max ? n : `${n.slice(0, max - 1)}…`;
  }

  function productKey(category, subcategory) {
    return `${category}::${subcategory}`;
  }

  function buildProductIndex(products) {
    productsByKey = new Map();
    for (const p of products) {
      if (!p.category || !p.subcategory) continue;
      const key = productKey(p.category, p.subcategory);
      if (!productsByKey.has(key)) productsByKey.set(key, []);
      productsByKey.get(key).push(p);
    }
    for (const list of productsByKey.values()) {
      list.sort((a, b) => (b.reviews || 0) - (a.reviews || 0) || (a.name || "").localeCompare(b.name || ""));
    }
  }

  function countForSub(categoryId, subId) {
    return productsByKey.get(productKey(categoryId, subId))?.length || 0;
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
          <p class="catalog-nav-title">Catalog</p>
          <p class="catalog-nav-sub">Browse like WhatsApp menu</p>
        </div>
        <button type="button" class="catalog-nav-close" id="catalog-nav-close" aria-label="Close catalog menu">×</button>
      </div>
      <div class="catalog-nav-scroll" id="catalog-nav-scroll">
    `;

    for (const item of topItems) {
      html += `
        <button type="button" class="catalog-nav-item catalog-nav-top ${isActiveCategory(item.id) ? "is-active" : ""}"
          data-nav-type="top" data-category="${item.id}">
          <span class="catalog-nav-emoji">${item.emoji}</span>
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
            <span class="catalog-nav-emoji">${cat.emoji || "🛍️"}</span>
            <span class="catalog-nav-label">${escapeHtml(cat.label)}</span>
          </button>
          <div class="catalog-nav-children" ${catExpanded ? "" : "hidden"}>
      `;

      for (const sub of cat.subcategories || []) {
        const count = countForSub(cat.id, sub.id);
        if (!count) continue;
        const subKey = `${cat.id}::${sub.id}`;
        const subExpanded = expandedSubcategories.has(subKey);
        const products = (productsByKey.get(productKey(cat.id, sub.id)) || []).slice(0, MAX_PRODUCTS_PER_SUB);
        const more = count - products.length;

        html += `
          <div class="catalog-nav-subgroup ${subExpanded ? "is-expanded" : ""}">
            <button type="button" class="catalog-nav-item catalog-nav-sub ${isActiveSub(cat.id, sub.id) ? "is-active" : ""}"
              data-nav-type="subcategory" data-category="${cat.id}" data-subcategory="${sub.id}" aria-expanded="${subExpanded}">
              <span class="catalog-nav-chevron catalog-nav-chevron--sm" aria-hidden="true"></span>
              <span class="catalog-nav-label">${escapeHtml(sub.label)}</span>
              <span class="catalog-nav-count">${count}</span>
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
            onNavigate({ category, subcategory: null, productId: null, scroll: true });
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
          if (onNavigate) {
            onNavigate({ category, subcategory, productId: null, scroll: true });
          }
          renderPanel();
          return;
        }

        if (type === "top") {
          expandedCategories.clear();
          expandedSubcategories.clear();
          if (onNavigate) {
            onNavigate({ category, subcategory: null, productId: null, scroll: true });
          }
          if (window.innerWidth < 1024) closePanel();
          return;
        }

        if (type === "product") {
          expandedCategories.add(category);
          expandedSubcategories.add(`${category}::${subcategory}`);
          if (onNavigate) {
            onNavigate({ category, subcategory, productId, scroll: true });
          }
          if (window.innerWidth < 1024) closePanel();
        }
      });
    });
  }

  function openPanel() {
    const panel = document.getElementById("catalog-nav-panel");
    const backdrop = document.getElementById("catalog-nav-backdrop");
    const toggle = document.getElementById("catalog-nav-toggle");
    if (!panel) return;
    isOpen = true;
    panel.classList.add("is-open");
    panel.removeAttribute("hidden");
    backdrop?.classList.add("is-open");
    backdrop?.removeAttribute("hidden");
    toggle?.setAttribute("aria-expanded", "true");
    document.body.classList.add("catalog-nav-open");
    renderPanel();
  }

  function closePanel() {
    const panel = document.getElementById("catalog-nav-panel");
    const backdrop = document.getElementById("catalog-nav-backdrop");
    const toggle = document.getElementById("catalog-nav-toggle");
    if (!panel) return;
    isOpen = false;
    panel.classList.remove("is-open");
    backdrop?.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("catalog-nav-open");
    if (window.innerWidth < 1024) {
      panel.setAttribute("hidden", "");
      backdrop?.setAttribute("hidden", "");
    }
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

    try {
      const res = await fetch("data/catalog-menu.json");
      if (res.ok) menuData = await res.json();
    } catch {
      menuData = null;
    }

    const toggle = document.getElementById("catalog-nav-toggle");
    const backdrop = document.getElementById("catalog-nav-backdrop");
    toggle?.addEventListener("click", togglePanel);
    backdrop?.addEventListener("click", closePanel);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) closePanel();
    });

    if (window.innerWidth >= 1024) {
      openPanel();
    } else {
      closePanel();
    }

    window.addEventListener("resize", () => {
      if (window.innerWidth >= 1024 && !isOpen) openPanel();
    });

    renderPanel();
  }

  window.SokoniCatalogNav = { init, sync, open: openPanel, close: closePanel };
})();
