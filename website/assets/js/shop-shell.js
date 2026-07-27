/**
 * Phase 5 — Saved bag with all-in prepaid totals.
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
    const wasSaved = bagIds.has(id);
    if (wasSaved) bagIds.delete(id);
    else bagIds.add(id);
    saveBag();
    const saved = bagIds.has(id);
    window.SokoniFeed?.trackSave?.(id, saved);
    return saved;
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

  function buyerTotal(product) {
    if (window.SokoniApp?.buyerPriceKes) {
      return Math.round(Number(window.SokoniApp.buyerPriceKes(product)) || 0);
    }
    if (product.totalKes != null) return Math.round(Number(product.totalKes) || 0);
    const item = Math.round(Number(product.priceKes) || 0);
    const ship = Math.round(Number(product.shippingKes) || 0);
    return ship > 0 ? item + ship : item;
  }

  function formatPriceLine(product) {
    const total = buyerTotal(product);
    return `KES ${total.toLocaleString()}`;
  }

  function renderBagSheet() {
    const list = document.getElementById("bag-sheet-list");
    const empty = document.getElementById("bag-sheet-empty");
    const orderBtn = document.getElementById("bag-sheet-order");
    const summary = document.getElementById("bag-sheet-summary");
    if (!list) return;

    const items = bagProducts();
    if (!items.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
      if (orderBtn) orderBtn.classList.add("hidden");
      summary?.classList.add("hidden");
      return;
    }

    empty?.classList.add("hidden");
    let grandTotal = 0;

    list.innerHTML = items
      .map((p) => {
        const total = buyerTotal(p);
        grandTotal += total;
        return `
      <li class="bag-sheet-item">
        <button type="button" class="bag-sheet-open" data-product-id="${p.id}">
          <span class="bag-sheet-item-name">${escapeHtml(p.name)}</span>
          <span class="bag-sheet-item-price">${escapeHtml(formatPriceLine(p))}</span>
        </button>
        <button type="button" class="bag-sheet-remove" data-remove-id="${p.id}" aria-label="Remove">×</button>
      </li>`;
      })
      .join("");

    if (summary) {
      summary.classList.remove("hidden");
      summary.innerHTML = `
        <table class="sell-fee-table" aria-label="Bag total">
          <tbody>
            <tr class="sell-fee-total"><th scope="row">Estimated total</th><td>KES ${grandTotal.toLocaleString()}</td></tr>
          </tbody>
        </table>
        <p class="text-xs text-brand-purple/50 mt-2">All prices include delivery. Sokoni orders one item at a time on WhatsApp.</p>`;
    }

    if (orderBtn) {
      orderBtn.classList.remove("hidden");
      const lines = items.map((p) => `• ${p.name} (${formatPriceLine(p)})`).join("\n");
      orderBtn.href = waLink(
        `Hi Sokoni, I'd like to order these saved items (prepaid):\n\n${lines}\n\nEstimated total KES ${grandTotal.toLocaleString()}\n\nMy name, delivery location and phone:`
      );
    }
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
    const ids = ["hero-search", "shop-search", "depop-search", "depop-search-mobile"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.value !== value) el.value = value;
    });
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
