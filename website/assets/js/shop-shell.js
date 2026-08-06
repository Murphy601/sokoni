/**
 * Phase 5 — Saved bag with all-in prepaid totals.
 * When a buyer WhatsApp session exists, bag hearts also sync social likes (best-effort).
 */
(function () {
  const BAG_KEY = "sokoni-bag";
  const WHATSAPP_NUMBER = "254117422428";
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const PRODUCT_API_BASE = `${API_BASE}/api/products`;

  /** @type {Set<string>} */
  let bagIds = new Set();
  /** @type {Set<string>} server-hydrated likes for signed-in buyers */
  let likedIds = new Set();

  function loadBag() {
    try {
      const raw = localStorage.getItem(BAG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      bagIds = new Set((Array.isArray(arr) ? arr : []).map((id) => String(id)));
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

  function isInBag(id) {
    return bagIds.has(id);
  }

  function isHearted(id) {
    if (!id) return false;
    const key = String(id);
    return bagIds.has(key) || likedIds.has(key);
  }

  function applyHeartButton(btn, hearted) {
    if (!btn) return;
    btn.classList.toggle("is-saved", hearted);
    btn.textContent = hearted ? "♥" : "♡";
    btn.setAttribute("aria-label", hearted ? "Remove from saved" : "Save item");
  }

  function syncHeartButtons(productId = null) {
    const selector = productId
      ? `.depop-card-heart[data-save-id="${CSS.escape(String(productId))}"]`
      : ".depop-card-heart[data-save-id]";
    document.querySelectorAll(selector).forEach((btn) => {
      const id = btn.getAttribute("data-save-id");
      applyHeartButton(btn, isHearted(id));
    });
    if (productId) {
      window.SokoniProductSheet?.syncSaveButton?.(productId);
    }
  }

  function hydrateLikedIds(ids) {
    likedIds = new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    );
    syncHeartButtons();
  }

  async function syncSocialLike(productId, liked) {
    const session = window.SokoniBuyerAuth?.readSession?.();
    if (!session?.userId || !productId) return;
    try {
      const payload = window.SokoniBuyerAuth?.authFields
        ? window.SokoniBuyerAuth.authFields({
            userId: session.userId,
            productId,
            liked: Boolean(liked),
          })
        : {
            userId: session.userId,
            productId,
            liked: Boolean(liked),
          };
      await fetch(`${PRODUCT_API_BASE}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Bag remains local; social sync is best-effort.
    }
  }

  async function hydrateLikesFromServer(productIds = []) {
    const session = window.SokoniBuyerAuth?.readSession?.();
    if (!session?.userId) {
      likedIds = new Set();
      syncHeartButtons();
      return [];
    }

    const ids = [...new Set((productIds || []).map((id) => String(id || "").trim()).filter(Boolean))].slice(
      0,
      200
    );
    if (!ids.length) return [];

    try {
      const params = new URLSearchParams({ productIds: ids.join(",") });
      if (window.SokoniBuyerAuth?.appendAuthQuery) {
        window.SokoniBuyerAuth.appendAuthQuery(params);
      }
      const res = await fetch(`${PRODUCT_API_BASE}/likes?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return [];
      const liked = Array.isArray(data?.likedProductIds) ? data.likedProductIds : [];
      hydrateLikedIds(liked);
      return liked;
    } catch {
      return [];
    }
  }

  function toggleBag(id) {
    if (!id) return false;
    const key = String(id);
    const wasHearted = isHearted(key);
    if (wasHearted) {
      bagIds.delete(key);
      likedIds.delete(key);
      saveBag();
      window.SokoniFeed?.trackSave?.(key, false);
      void syncSocialLike(key, false);
      syncHeartButtons(key);
      return false;
    }
    bagIds.add(key);
    likedIds.add(key);
    saveBag();
    window.SokoniFeed?.trackSave?.(key, true);
    void syncSocialLike(key, true);
    syncHeartButtons(key);
    return true;
  }

  function removeFromBag(id) {
    if (!id) return false;
    const key = String(id);
    if (!bagIds.has(key) && !likedIds.has(key)) return false;
    bagIds.delete(key);
    likedIds.delete(key);
    saveBag();
    void syncSocialLike(key, false);
    syncHeartButtons(key);
    return true;
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

    // Group by seller for display (checkout remains one payment)
    const bySeller = new Map();
    items.forEach((p) => {
      const key = p.shopHandle || p.sellerHandle || p.supplierId || "seller";
      if (!bySeller.has(key)) bySeller.set(key, []);
      bySeller.get(key).push(p);
    });

    if (summary) {
      summary.classList.remove("hidden");
      const sellerNote =
        bySeller.size > 1
          ? `${bySeller.size} sellers — one M-Pesa PIN; items ship separately with their own SKN tracking IDs.`
          : `Pay once on WhatsApp. Each item gets its own SKN tracking ID.`;
      summary.innerHTML = `
        <table class="sell-fee-table" aria-label="Bag total">
          <tbody>
            <tr class="sell-fee-total"><th scope="row">Estimated total</th><td>KES ${grandTotal.toLocaleString()}</td></tr>
          </tbody>
        </table>
        <p class="text-xs text-zinc-400 mt-2">${escapeHtml(sellerNote)} Commission is per item, not on the cart total.</p>`;
    }

    if (orderBtn) {
      orderBtn.classList.remove("hidden");
      const skuLines = items
        .map((p) => `• ${p.name} (${formatPriceLine(p)}) [SKU:${p.id}]`)
        .join("\n");
      orderBtn.textContent = "Order cart on WhatsApp";
      // Machine-readable handoff only — bot replies with photos + asks for details.
      orderBtn.href = waLink(
        `🛒 *NEW SOKONI CART ORDER*\nSOKONI_CART\n\n${skuLines}\n\n💰 Estimated total KES ${grandTotal.toLocaleString()}`
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
    if (window.SokoniAccountGate?.requireForAction && !window.SokoniAccountGate.requireForAction("index.html")) {
      return;
    }
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
      // Mobile: open drawer. Desktop rail is always visible (button hidden via CSS).
      window.SokoniCatalogNav?.open?.();
    });

    document.getElementById("shop-bag-btn")?.addEventListener("click", openBagSheet);
    document.getElementById("bag-sheet-close")?.addEventListener("click", closeBagSheet);
    document.querySelector("#bag-sheet .sheet-backdrop")?.addEventListener("click", closeBagSheet);

    document.getElementById("bag-sheet-list")?.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove-id]");
      if (remove) {
        removeFromBag(remove.dataset.removeId);
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
    isHearted,
    hydrateLikedIds,
    hydrateLikesFromServer,
    syncHeartButtons,
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
