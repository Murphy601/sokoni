/**
 * Phase 3 — Depop-style product detail bottom sheet.
 */
(function () {
  const WHATSAPP_NUMBER = "254117422428";
  let currentProduct = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatPrice(product) {
    if (window.SokoniApp?.formatPrice) return window.SokoniApp.formatPrice(product);
    if (product.priceKes != null) return `KES ${product.priceKes.toLocaleString()}`;
    if (product.priceUsd != null) return `$${product.priceUsd}`;
    return "";
  }

  function resolveImage(product) {
    if (product?.imageUrl) return product.imageUrl;
    if (product?.id) return `assets/images/products/${product.id}.jpg`;
    return null;
  }

  function waLink(message) {
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }

  function orderLink(product) {
    return waLink(
      `Hi Sokoni, I'd like to order "${product.name}" (${formatPrice(product)}) — prepaid. ` +
        `My name, delivery location and phone are:`
    );
  }

  function askLink(product) {
    return waLink(`Hi Sokoni, tell me more about "${product.name}" (${formatPrice(product)}).`);
  }

  function browseLabel(product) {
    const path = window.SokoniBrowse?.resolveBrowsePath(product);
    if (!path) return "";
    return window.SokoniBrowse?.labelForBrowse(path.browse, path.sub) || "";
  }

  function renderBody(product) {
    const src = resolveImage(product);
    const saved = window.SokoniShopShell?.isInBag(product.id);
    const condition = product.conditionLabel || product.condition || "";
    const secondhand = product.isSecondhand ? "Pre-Loved" : "Brand New";

    return `
      <div class="product-sheet-gallery">
        ${
          src
            ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" class="product-sheet-image" />`
            : `<div class="product-sheet-image product-sheet-image--empty">Photo coming soon</div>`
        }
      </div>
      <div class="product-sheet-meta">
        <p class="product-sheet-price">${escapeHtml(formatPrice(product))}</p>
        <h2 class="product-sheet-title">${escapeHtml(product.name)}</h2>
        <p class="product-sheet-tags">${escapeHtml([browseLabel(product), secondhand, condition].filter(Boolean).join(" · "))}</p>
        <p class="product-sheet-id">${escapeHtml(product.id || "")}</p>
        ${
          product.description
            ? `<p class="product-sheet-desc">${escapeHtml(product.description)}</p>`
            : ""
        }
        <p class="product-sheet-rating">⭐ ${Number(product.rating) || 0} · ${Number(product.reviews) || 0} reviews</p>
      </div>
      <div class="product-sheet-actions">
        <a href="${orderLink(product)}" target="_blank" rel="noopener" class="product-sheet-order btn-whatsapp">
          🛒 Buy — prepaid
        </a>
        <button type="button" id="product-sheet-save" class="product-sheet-save ${saved ? "is-saved" : ""}">
          ${saved ? "♥ Saved" : "♡ Save for later"}
        </button>
        <a href="${askLink(product)}" target="_blank" rel="noopener" class="product-sheet-ask">💬 Ask on WhatsApp</a>
      </div>`;
  }

  function syncSaveButton(productId) {
    if (!currentProduct || currentProduct.id !== productId) return;
    const btn = document.getElementById("product-sheet-save");
    if (!btn) return;
    const saved = window.SokoniShopShell?.isInBag(productId);
    btn.classList.toggle("is-saved", saved);
    btn.textContent = saved ? "♥ Saved" : "♡ Save for later";
  }

  function open(product) {
    if (!product) return;
    currentProduct = product;
    window.SokoniFeed?.trackView?.(product.id);
    const body = document.getElementById("product-sheet-body");
    const sheet = document.getElementById("product-sheet");
    if (!body || !sheet) return;
    body.innerHTML = renderBody(product);
    sheet.classList.add("is-open");
    sheet.removeAttribute("hidden");
    document.body.classList.add("sheet-open");
  }

  function close() {
    document.getElementById("product-sheet")?.classList.remove("is-open");
    document.getElementById("product-sheet")?.setAttribute("hidden", "");
    document.body.classList.remove("sheet-open");
    currentProduct = null;
  }

  function init() {
    document.getElementById("product-sheet-close")?.addEventListener("click", close);
    document.querySelector("#product-sheet .sheet-backdrop")?.addEventListener("click", close);
    document.getElementById("product-sheet-body")?.addEventListener("click", (e) => {
      if (!e.target.closest("#product-sheet-save")) return;
      if (!currentProduct) return;
      window.SokoniShopShell?.toggleBag(currentProduct.id);
      syncSaveButton(currentProduct.id);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  window.SokoniProductSheet = { open, close, syncSaveButton, init };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
