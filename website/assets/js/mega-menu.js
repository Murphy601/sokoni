/**
 * Desktop mega-menu flyout for browse categories.
 * Mobile keeps the left catalog-nav drawer — this only activates ≥900px.
 */
(function () {
  const DESKTOP_MQ = "(min-width: 900px)";
  let menuData = null;
  let activeCategoryId = null;
  let isOpen = false;
  let onNavigate = null;
  let root = null;
  let leaveTimer = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isDesktop() {
    return window.matchMedia(DESKTOP_MQ).matches;
  }

  function categories() {
    return menuData?.categories || [];
  }

  function activeCategory() {
    return categories().find((c) => c.id === activeCategoryId) || categories()[0] || null;
  }

  function iconHtml(item, sizeClass) {
    if (item?.image) {
      return `<span class="mega-menu-icon ${sizeClass}" aria-hidden="true">
        <img src="${escapeHtml(item.image)}" alt="" width="56" height="56" loading="lazy" />
      </span>`;
    }
    return `<span class="mega-menu-emoji ${sizeClass}" aria-hidden="true">${escapeHtml(item?.emoji || "🛍️")}</span>`;
  }

  function ensureRoot() {
    if (root) return root;
    root = document.getElementById("sokoni-mega-menu");
    if (!root) {
      root = document.createElement("div");
      root.id = "sokoni-mega-menu";
      root.className = "mega-menu";
      root.hidden = true;
      document.body.appendChild(root);
    }
    root.addEventListener("mouseenter", () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    });
    root.addEventListener("mouseleave", () => scheduleClose());
    return root;
  }

  function scheduleClose() {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => close(), 180);
  }

  function navigate(spec) {
    const payload = {
      category: spec.category || "all",
      subcategory: spec.subcategory || null,
      productId: null,
      priceTier: spec.priceTier || null,
      scroll: true,
    };
    if (onNavigate) onNavigate(payload);
    else if (window.SokoniApp?.setCatalogFilter) window.SokoniApp.setCatalogFilter(payload);
    close();
  }

  function render() {
    const el = ensureRoot();
    const cats = categories();
    if (!cats.length) {
      el.innerHTML = `<div class="mega-menu-empty">Browse menu is loading…</div>`;
      return;
    }

    if (!activeCategoryId || !cats.some((c) => c.id === activeCategoryId)) {
      activeCategoryId = cats[0].id;
    }
    const active = activeCategory();
    const subs = active?.subcategories || [];

    let left = "";
    for (const cat of cats) {
      const activeCls = cat.id === activeCategoryId ? "is-active" : "";
      left += `
        <button type="button" class="mega-menu-cat ${activeCls}" data-mega-cat="${escapeHtml(cat.id)}"
          aria-current="${cat.id === activeCategoryId ? "true" : "false"}">
          ${iconHtml(cat, "mega-menu-icon--sm")}
          <span class="mega-menu-cat-label">${escapeHtml(cat.label)}</span>
          <span class="mega-menu-cat-chevron" aria-hidden="true">›</span>
        </button>`;
    }

    let right = `
      <div class="mega-menu-panel-head">
        <h3 class="mega-menu-panel-title">${escapeHtml(active.label)}</h3>
        <button type="button" class="mega-menu-shop-all" data-mega-shop-all="${escapeHtml(active.id)}">
          Shop all
        </button>
      </div>`;

    if (active.groups?.length) {
      for (const group of active.groups) {
        right += `
          <div class="mega-menu-group">
            <p class="mega-menu-group-title">${escapeHtml(group.title)}</p>
            <div class="mega-menu-grid">
              ${(group.subcategories || [])
                .map(
                  (sub) => `
                <button type="button" class="mega-menu-sub" data-mega-cat="${escapeHtml(active.id)}" data-mega-sub="${escapeHtml(sub.id)}">
                  ${iconHtml(sub, "mega-menu-icon--lg")}
                  <span class="mega-menu-sub-label">${escapeHtml(sub.label || sub.name)}</span>
                </button>`
                )
                .join("")}
            </div>
          </div>`;
      }
    } else {
      right += `
        <div class="mega-menu-grid">
          ${subs
            .map(
              (sub) => `
            <button type="button" class="mega-menu-sub" data-mega-cat="${escapeHtml(active.id)}" data-mega-sub="${escapeHtml(sub.id)}">
              ${iconHtml({ emoji: active.emoji, image: sub.image }, "mega-menu-icon--lg")}
              <span class="mega-menu-sub-label">${escapeHtml(sub.label)}</span>
            </button>`
            )
            .join("")}
        </div>`;
    }

    el.innerHTML = `
      <div class="mega-menu-shell" role="dialog" aria-label="Browse categories">
        <div class="mega-menu-left">${left}</div>
        <div class="mega-menu-right">${right}</div>
      </div>`;

    el.querySelectorAll("[data-mega-cat]").forEach((btn) => {
      if (btn.classList.contains("mega-menu-sub")) return;
      btn.addEventListener("mouseenter", () => {
        const id = btn.getAttribute("data-mega-cat");
        if (id && id !== activeCategoryId) {
          activeCategoryId = id;
          render();
        }
      });
      btn.addEventListener("focus", () => {
        const id = btn.getAttribute("data-mega-cat");
        if (id && id !== activeCategoryId) {
          activeCategoryId = id;
          render();
        }
      });
      btn.addEventListener("click", () => {
        navigate({ category: btn.getAttribute("data-mega-cat") });
      });
    });

    el.querySelectorAll(".mega-menu-sub").forEach((btn) => {
      btn.addEventListener("click", () => {
        const category = btn.getAttribute("data-mega-cat");
        const subcategory = btn.getAttribute("data-mega-sub");
        const cat = cats.find((c) => c.id === category);
        const subDef = cat?.subcategories?.find((s) => s.id === subcategory);
        navigate({
          category,
          subcategory,
          priceTier: subDef?.priceTier || (category === "sale" ? subcategory : null),
        });
      });
    });

    el.querySelector("[data-mega-shop-all]")?.addEventListener("click", (e) => {
      navigate({ category: e.currentTarget.getAttribute("data-mega-shop-all") });
    });
  }

  function open(preferredCategoryId) {
    if (!isDesktop()) return false;
    if (preferredCategoryId) activeCategoryId = preferredCategoryId;
    ensureRoot();
    render();
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    root.classList.add("is-open");
    isOpen = true;
    document.body.classList.add("mega-menu-open");
    const toggle = document.getElementById("catalog-nav-toggle");
    toggle?.classList.add("is-open");
    toggle?.setAttribute("aria-expanded", "true");
    return true;
  }

  function close() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    if (!root) return;
    root.classList.remove("is-open");
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    isOpen = false;
    document.body.classList.remove("mega-menu-open");
    const toggle = document.getElementById("catalog-nav-toggle");
    // Only clear toggle if drawer is also closed
    if (!document.body.classList.contains("catalog-nav-open")) {
      toggle?.classList.remove("is-open");
      toggle?.setAttribute("aria-expanded", "false");
    }
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  async function init({ navigate } = {}) {
    onNavigate = navigate || null;
    await window.SokoniBrowse?.loadMenu?.();
    menuData = window.SokoniBrowse?.getMenu?.() || null;
    if (!menuData) {
      try {
        const meta = document.querySelector('meta[name="sokoni-catalog-version"]');
        const v = meta?.getAttribute("content") || String(Date.now());
        const res = await fetch(`data/browse-menu.json?v=${v}`);
        if (res.ok) menuData = await res.json();
      } catch {
        menuData = null;
      }
    }
    ensureRoot();

    const toggleBtn = document.getElementById("catalog-nav-toggle");
    toggleBtn?.addEventListener("mouseenter", () => {
      if (isDesktop()) open();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) close();
    });

    window.matchMedia(DESKTOP_MQ).addEventListener("change", (ev) => {
      if (!ev.matches) close();
    });
  }

  window.SokoniMegaMenu = {
    init,
    open,
    close,
    toggle,
    isOpen: () => isOpen,
    isDesktop,
  };
})();
