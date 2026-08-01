/**
 * Embedded homepage category rail (Kilimall-style).
 * Desktop: permanent sidebar beside the hero; hover opens subcategory flyout over the banner.
 * Thumbnails use public web URLs from browse-menu.json — never catalog product photos.
 * Mobile: rail hidden — use catalog-nav drawer (hamburger).
 */
(function () {
  const DESKTOP_MQ = "(min-width: 900px)";
  let menuData = null;
  let activeCategoryId = null;
  let flyoutOpen = false;
  let onNavigate = null;
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
    return categories().find((c) => c.id === activeCategoryId) || null;
  }

  function iconHtml(item, sizeClass) {
    const src = item?.image;
    if (src) {
      return `<span class="sokoni-cat-icon ${sizeClass}" aria-hidden="true">
        <img src="${escapeHtml(src)}" alt="" width="240" height="240" loading="lazy"
          referrerpolicy="no-referrer"
          onerror="this.onerror=null;this.classList.add('is-broken');this.src='https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&h=600&q=80';" />
      </span>`;
    }
    // Last resort only — every cat/sub should have a web image in browse-menu.json
    return `<span class="sokoni-cat-icon ${sizeClass} sokoni-cat-icon--empty" aria-hidden="true"></span>`;
  }

  function railEl() {
    return document.getElementById("sokoni-category-rail");
  }

  function listEl() {
    return document.getElementById("sokoni-category-rail-list");
  }

  function flyoutEl() {
    return document.getElementById("sokoni-category-flyout");
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
    closeFlyout();
  }

  function renderList() {
    const list = listEl();
    if (!list) return;
    const cats = categories();
    if (!cats.length) {
      list.innerHTML = `<p class="sokoni-category-rail__empty">Loading categories…</p>`;
      return;
    }

    list.innerHTML = cats
      .map((cat) => {
        const active = cat.id === activeCategoryId && flyoutOpen;
        return `
        <button type="button" class="sokoni-category-rail__item ${active ? "is-active" : ""}"
          data-rail-cat="${escapeHtml(cat.id)}" aria-expanded="${active ? "true" : "false"}">
          ${iconHtml(cat, "sokoni-cat-icon--sm")}
          <span class="sokoni-category-rail__label">${escapeHtml(cat.label)}</span>
          <span class="sokoni-category-rail__chevron" aria-hidden="true">›</span>
        </button>`;
      })
      .join("");

    list.querySelectorAll("[data-rail-cat]").forEach((btn) => {
      const id = btn.getAttribute("data-rail-cat");
      btn.addEventListener("mouseenter", () => {
        if (!isDesktop()) return;
        openFlyout(id);
      });
      btn.addEventListener("focus", () => {
        if (!isDesktop()) return;
        openFlyout(id);
      });
      btn.addEventListener("click", () => {
        navigate({ category: id });
      });
    });
  }

  function renderFlyout() {
    const flyout = flyoutEl();
    const active = activeCategory();
    if (!flyout || !active) return;

    const groups =
      active.groups?.length > 0
        ? active.groups
        : [{ title: active.label, subcategories: active.subcategories || [] }];

    let body = `
      <div class="sokoni-category-flyout__head">
        <h3 class="sokoni-category-flyout__title">${escapeHtml(active.label)}</h3>
        <button type="button" class="sokoni-category-flyout__shop-all" data-flyout-shop-all="${escapeHtml(active.id)}">
          Shop all ›
        </button>
      </div>`;

    for (const group of groups) {
      body += `
        <div class="sokoni-category-flyout__group">
          <p class="sokoni-category-flyout__group-title">${escapeHtml(group.title)}</p>
          <div class="sokoni-category-flyout__grid">
            ${(group.subcategories || [])
              .map((sub) => {
                const label = sub.label || sub.name || "";
                const sid = sub.id || sub.slug || "";
                return `
              <button type="button" class="sokoni-category-flyout__sub"
                data-flyout-cat="${escapeHtml(active.id)}" data-flyout-sub="${escapeHtml(sid)}">
                ${iconHtml(sub, "sokoni-cat-icon--lg")}
                <span class="sokoni-category-flyout__sub-label">${escapeHtml(label)}</span>
              </button>`;
              })
              .join("")}
          </div>
        </div>`;
    }

    flyout.innerHTML = body;

    flyout.querySelectorAll(".sokoni-category-flyout__sub").forEach((btn) => {
      btn.addEventListener("click", () => {
        const category = btn.getAttribute("data-flyout-cat");
        const subcategory = btn.getAttribute("data-flyout-sub");
        const cat = categories().find((c) => c.id === category);
        const subDef = cat?.subcategories?.find((s) => s.id === subcategory);
        navigate({
          category,
          subcategory,
          priceTier: subDef?.priceTier || (category === "sale" ? subcategory : null),
        });
      });
    });

    flyout.querySelector("[data-flyout-shop-all]")?.addEventListener("click", (e) => {
      navigate({ category: e.currentTarget.getAttribute("data-flyout-shop-all") });
    });
  }

  function openFlyout(categoryId) {
    if (!isDesktop()) return false;
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    activeCategoryId = categoryId;
    flyoutOpen = true;
    renderList();
    renderFlyout();
    const flyout = flyoutEl();
    const rail = railEl();
    if (flyout) {
      flyout.hidden = false;
      flyout.setAttribute("aria-hidden", "false");
      flyout.classList.add("is-open");
    }
    rail?.classList.add("has-flyout");
    return true;
  }

  function closeFlyout() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    flyoutOpen = false;
    activeCategoryId = null;
    const flyout = flyoutEl();
    const rail = railEl();
    if (flyout) {
      flyout.classList.remove("is-open");
      flyout.hidden = true;
      flyout.setAttribute("aria-hidden", "true");
      flyout.innerHTML = "";
    }
    rail?.classList.remove("has-flyout");
    renderList();
  }

  function scheduleCloseFlyout() {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => closeFlyout(), 160);
  }

  let bound = false;

  async function init({ navigate } = {}) {
    if (navigate) onNavigate = navigate;
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

    renderList();

    if (!bound) {
      bound = true;
      const rail = railEl();
      rail?.addEventListener("mouseleave", () => {
        if (isDesktop()) scheduleCloseFlyout();
      });
      rail?.addEventListener("mouseenter", () => {
        if (leaveTimer) {
          clearTimeout(leaveTimer);
          leaveTimer = null;
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && flyoutOpen) closeFlyout();
      });

      window.matchMedia(DESKTOP_MQ).addEventListener("change", (ev) => {
        if (!ev.matches) closeFlyout();
      });
    }
  }

  window.SokoniMegaMenu = {
    init,
    open: (id) => openFlyout(id || categories()[0]?.id),
    close: closeFlyout,
    toggle: () => {
      if (flyoutOpen) closeFlyout();
      else openFlyout(categories()[0]?.id);
    },
    isOpen: () => flyoutOpen,
    isDesktop,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      window.SokoniMegaMenu.init();
    });
  } else {
    window.SokoniMegaMenu.init();
  }
})();
