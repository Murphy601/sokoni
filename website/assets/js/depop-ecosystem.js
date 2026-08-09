/**
 * Homepage ecosystem strips under the hero — brands + shops from live catalog.
 * No fake city shops or invented counts.
 */
(function () {
  const BRANDS = [
    "Nike",
    "Adidas",
    "Carhartt",
    "Zara",
    "Levi's",
    "Ralph Lauren",
    "Stüssy",
    "Vintage",
    "Streetwear",
    "Thrift",
  ];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeHandle(raw) {
    return String(raw || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function slugFromSource(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40);
  }

  function sellerHandle(product) {
    const direct = normalizeHandle(
      product?.sellerHandle ||
        product?.shopHandle ||
        product?.seller?.handle ||
        product?.handle
    );
    if (direct) return direct;
    // Fallback so shops don't vanish when a listing forgot shopHandle
    const fromSource = slugFromSource(product?.source);
    if (fromSource && fromSource !== "sokoni") return fromSource;
    return "";
  }

  function sellerName(product) {
    return (
      product?.shopName ||
      product?.seller?.shopName ||
      product?.sellerName ||
      product?.seller?.name ||
      (product?.source && product.source !== "Sokoni" ? product.source : "") ||
      ""
    );
  }

  function sellerAvatar(product) {
    return product?.sellerAvatarUrl || product?.seller?.avatarUrl || product?.shopAvatarUrl || "";
  }

  function mountBrands() {
    const row = document.getElementById("depop-brands-row");
    if (!row || row.dataset.bound) return;
    row.dataset.bound = "1";
    row.innerHTML = BRANDS.map(
      (brand) =>
        `<button type="button" class="depop-brand-chip" data-brand-search="${escapeHtml(brand)}">${escapeHtml(brand)}</button>`
    ).join("");

    row.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-brand-search]");
      if (!btn) return;
      const q = btn.getAttribute("data-brand-search") || "";
      if (window.SokoniApp?.runSearch) {
        window.SokoniApp.runSearch(q);
      } else {
        document.getElementById("deals")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function collectShops(products) {
    const map = new Map();
    for (const product of products || []) {
      const handle = sellerHandle(product);
      if (!handle) continue;
      const current = map.get(handle) || {
        handle,
        name: "",
        listings: 0,
        avatarUrl: "",
      };
      current.listings += 1;
      if (!current.name) current.name = sellerName(product);
      if (!current.avatarUrl) current.avatarUrl = sellerAvatar(product);
      map.set(handle, current);
    }
    return [...map.values()]
      .sort((a, b) => b.listings - a.listings || a.handle.localeCompare(b.handle))
      .slice(0, 12);
  }

  function renderShops(shops) {
    const grid = document.getElementById("depop-top-shops-grid");
    const empty = document.getElementById("depop-top-shops-empty");
    if (!grid) return;

    if (!shops.length) {
      grid.innerHTML = "";
      grid.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    grid.hidden = false;
    grid.innerHTML = shops
      .map((shop) => {
        const name = shop.name || `@${shop.handle}`;
        const avatar = shop.avatarUrl
          ? `<img src="${escapeHtml(shop.avatarUrl)}" alt="" loading="lazy" decoding="async" />`
          : "🏪";
        return `<article class="depop-shop-card">
          <div class="depop-shop-avatar">${avatar}</div>
          <div class="depop-shop-meta">
            <h3>@${escapeHtml(shop.handle)}</h3>
            <p>${escapeHtml(name)}</p>
            <span>${shop.listings} live listing${shop.listings === 1 ? "" : "s"}</span>
          </div>
          <a class="depop-shop-cta" href="shop.html?handle=${encodeURIComponent(shop.handle)}">View shop</a>
        </article>`;
      })
      .join("");
  }

  function refreshShops() {
    const products = window.SokoniApp?.getStoreProducts?.() || [];
    renderShops(collectShops(products));
  }

  function mount() {
    mountBrands();
    refreshShops();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      refreshShops();
      const products = window.SokoniApp?.getStoreProducts?.() || [];
      if ((products.length > 0 && document.getElementById("depop-top-shops-grid")?.children.length) || tries >= 20) {
        clearInterval(timer);
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
