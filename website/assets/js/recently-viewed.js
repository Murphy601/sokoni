/**
 * Recently viewed products (localStorage) — used by Inbox carousel.
 * Shared across storefront + inbox; no server dependency.
 */
(function () {
  const KEY = "sokoni-recently-viewed";
  const MAX = 12;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((x) => x && x.id) : [];
    } catch {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    } catch {
      /* quota / private mode */
    }
  }

  function record(product) {
    if (!product?.id) return;
    const entry = {
      id: String(product.id),
      name: String(product.name || product.id).slice(0, 80),
      imageUrl: product.imageUrl || product.images?.[0] || "",
      priceKes: product.priceKes ?? product.buyerTotalKes ?? product.sellerNetKes ?? null,
      shopHandle: product.shopHandle || product.sellerHandle || "",
      sellerUserId: product.sellerUserId || product.socialUserId || null,
      viewedAt: Date.now(),
    };
    const next = [entry, ...read().filter((x) => String(x.id) !== entry.id)].slice(0, MAX);
    write(next);
  }

  function list(limit = 8) {
    return read().slice(0, Math.max(1, Number(limit) || 8));
  }

  function mediaUrl(relOrUrl) {
    const raw = String(relOrUrl || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
    if (raw.startsWith("/")) return raw;
    if (raw.startsWith("assets/") || raw.startsWith("data/")) return raw;
    return raw;
  }

  function renderCarousel(mount, { onSelect } = {}) {
    const node = typeof mount === "string" ? document.getElementById(mount) : mount;
    if (!node) return;
    const items = list(10);
    if (!items.length) {
      node.innerHTML = `<p class="text-xs text-zinc-500 px-1">Browse fits on the home feed — they’ll show up here for quick chat.</p>`;
      return;
    }
    node.innerHTML = items
      .map((item) => {
        const img = mediaUrl(item.imageUrl);
        const price =
          item.priceKes != null && Number(item.priceKes) > 0
            ? `KES ${Math.round(Number(item.priceKes)).toLocaleString()}`
            : "";
        return `
          <button type="button" class="inbox-recent-card" data-recent-id="${escapeHtml(item.id)}" data-recent-handle="${escapeHtml(item.shopHandle || "")}" data-recent-seller="${escapeHtml(item.sellerUserId || "")}">
            ${
              img
                ? `<img src="${escapeHtml(img)}" alt="" class="inbox-recent-thumb" loading="lazy" onerror="this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden');" /><div class="inbox-recent-thumb inbox-recent-thumb--empty hidden">Fit</div>`
                : `<div class="inbox-recent-thumb inbox-recent-thumb--empty">Fit</div>`
            }
            <span class="inbox-recent-name">${escapeHtml(item.name)}</span>
            ${price ? `<span class="inbox-recent-price">${escapeHtml(price)}</span>` : ""}
          </button>`;
      })
      .join("");

    node.querySelectorAll("[data-recent-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-recent-id");
        const handle = btn.getAttribute("data-recent-handle") || "";
        const sellerUserId = btn.getAttribute("data-recent-seller") || "";
        if (typeof onSelect === "function") {
          onSelect({ id, handle, sellerUserId });
          return;
        }
        const params = new URLSearchParams();
        if (id) params.set("product", id);
        if (handle) params.set("handle", handle);
        if (sellerUserId) params.set("with", sellerUserId);
        if (handle || sellerUserId) {
          window.location.href = `inbox.html?${params.toString()}`;
          return;
        }
        window.location.href = `index.html?q=${encodeURIComponent(id || "")}`;
      });
    });
  }

  window.SokoniRecentlyViewed = { record, list, renderCarousel, KEY };
})();
