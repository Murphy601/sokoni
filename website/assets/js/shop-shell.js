/**
 * Phase 3 — Depop-style mobile shop shell (top bar, bag, sell).
 */
(function () {
  const BAG_KEY = "sokoni-bag";
  const WHATSAPP_NUMBER = "254117422428";

  /** @type {Set<string>} */
  let bagIds = new Set();

  function loadBag() {
    try {
      const raw = localStorage.getItem(BAG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      bagIds = new Set(Array.isArray(arr) ? arr : []);
    } catch {
      bagIds = new Set();
    }
    syncBagCount();
  }

  function saveBag() {
    try {
      localStorage.setItem(BAG_KEY, JSON.stringify([...bagIds]));
    } catch {}
    syncBagCount();
  }

  function syncBagCount() {
    const el = document.getElementById("shop-bag-count");
    if (!el) return;
    const n = bagIds.size;
    el.textContent = String(n);
    el.classList.toggle("hidden", n === 0);
  }

  function getProducts() {
    return window.SokoniApp?.getStoreProducts?.() || [];
  }

  function findProduct(id) {
    return getProducts().find((p) => p.id === id) || null;
  }

  function toggleBag(id) {
    if (!id) return false;
    if (bagIds.has(id)) bagIds.delete(id);
    else bagIds.add(id);
    saveBag();
    return bagIds.has(id);
  }

  function isInBag(id) {
    return bagIds.has(id);
  }

  function bagProducts() {
    return [...bagIds].map(findProduct).filter(Boolean);
  }

  function waLink(message) {
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }

  function formatPrice(product) {
    if (product.priceKes != null) return `KES ${product.priceKes.toLocaleString()}`;
    if (product.priceUsd != null) return `$${product.priceUsd}`;
    return "";
  }

  function renderBagSheet() {
    const list = document.getElementById("bag-sheet-list");
    const empty = document.getElementById("bag-sheet-empty");
    const orderBtn = document.getElementById("bag-sheet-order");
    if (!list) return;

    const items = bagProducts();
    if (!items.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
      if (orderBtn) orderBtn.classList.add("hidden");
      return;
    }

    empty?.classList.add("hidden");
    if (orderBtn) {
      orderBtn.classList.remove("hidden");
      const lines = items.map((p) => `• ${p.name} (${formatPrice(p)})`).join("\n");
      orderBtn.href = waLink(
        `Hi Sokoni, I'd like to order these saved items (pay on delivery):\n\n${lines}\n\nMy name, delivery location and phone:`
      );
    }

    list.innerHTML = items
      .map(
        (p) => `
      <li class="bag-sheet-item">
        <button type="button" class="bag-sheet-open" data-product-id="${p.id}">
          <span class="bag-sheet-item-name">${escapeHtml(p.name)}</span>
          <span class="bag-sheet-item-price">${escapeHtml(formatPrice(p))}</span>
        </button>
        <button type="button" class="bag-sheet-remove" data-remove-id="${p.id}" aria-label="Remove">×</button>
      </li>`
      )
      .join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openBagSheet() {
    renderBagSheet();
    document.getElementById("bag-sheet")?.classList.add("is-open");
    document.getElementById("bag-sheet")?.removeAttribute("hidden");
    document.body.classList.add("sheet-open");
  }

  function closeBagSheet() {
    document.getElementById("bag-sheet")?.classList.remove("is-open");
    document.getElementById("bag-sheet")?.setAttribute("hidden", "");
    document.body.classList.remove("sheet-open");
  }

  function syncSearchInputs(value) {
    const hero = document.getElementById("hero-search");
    const shop = document.getElementById("shop-search");
    if (hero && hero.value !== value) hero.value = value;
    if (shop && shop.value !== value) shop.value = value;
  }

  function bindSearch() {
    const shopForm = document.getElementById("shop-search-form");
    const shopInput = document.getElementById("shop-search");
    const heroForm = document.getElementById("hero-search-form");

    shopForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = shopInput?.value?.trim() || "";
      syncSearchInputs(q);
      if (window.SokoniApp?.runSearch) {
        window.SokoniApp.runSearch(q);
      }
      document.getElementById("deals")?.scrollIntoView({ behavior: "smooth" });
    });

    shopInput?.addEventListener("input", () => {
      if (!(shopInput.value || "").trim() && window.SokoniApp?.runSearch) {
        window.SokoniApp.runSearch("");
      }
    });

    heroForm?.addEventListener("submit", () => {
      syncSearchInputs(document.getElementById("hero-search")?.value || "");
    });
  }

  function init() {
    loadBag();

    document.getElementById("shop-browse-btn")?.addEventListener("click", () => {
      window.SokoniCatalogNav?.open?.();
    });

    document.getElementById("shop-bag-btn")?.addEventListener("click", openBagSheet);
    document.getElementById("bag-sheet-close")?.addEventListener("click", closeBagSheet);
    document.querySelector("#bag-sheet .sheet-backdrop")?.addEventListener("click", closeBagSheet);

    document.getElementById("bag-sheet-list")?.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove-id]");
      if (remove) {
        bagIds.delete(remove.dataset.removeId);
        saveBag();
        renderBagSheet();
        window.SokoniProductSheet?.syncSaveButton?.(remove.dataset.removeId);
        return;
      }
      const open = e.target.closest("[data-product-id]");
      if (open?.dataset.productId) {
        const p = findProduct(open.dataset.productId);
        if (p) {
          closeBagSheet();
          window.SokoniProductSheet?.open(p);
        }
      }
    });

    bindSearch();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeBagSheet();
    });
  }

  window.SokoniShopShell = {
    init,
    toggleBag,
    isInBag,
    openBag: openBagSheet,
    refreshBag: renderBagSheet,
    syncSearchInputs,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
