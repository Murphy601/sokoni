/**
 * Admin Sellers & Shops desk — searchable table, item drawer, action menu.
 * Auth: X-Admin-Token (ADMIN_SETUP_TOKEN / MASTER_ADMIN_SECRET).
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const ADMIN_API = `${API_BASE}/admin/suppliers`;
  const TOKEN_KEY = "sokoni-admin-listings-token";

  /** @type {Map<string, object>} */
  const shopCache = new Map();
  let openShopId = null;

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, isError = false) {
    const node = el("shops-status-msg");
    if (!node) return;
    node.textContent = msg || "";
    node.classList.toggle("text-red-600", isError);
    node.classList.toggle("text-brand-green", !isError && Boolean(msg));
  }

  function readToken() {
    const input = el("admin-token");
    const fromInput = String(input?.value || "").trim();
    if (fromInput) {
      try {
        localStorage.setItem(TOKEN_KEY, fromInput);
      } catch {}
      return fromInput;
    }
    try {
      return String(localStorage.getItem(TOKEN_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function hydrateToken() {
    const params = new URLSearchParams(window.location.search);
    const token = String(params.get("token") || "").trim();
    if (token && el("admin-token")) {
      el("admin-token").value = token;
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {}
      params.delete("token");
      const q = params.toString();
      try {
        history.replaceState({}, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
      } catch {}
    } else if (el("admin-token")) {
      try {
        el("admin-token").value = localStorage.getItem(TOKEN_KEY) || "";
      } catch {}
    }
  }

  function adminHeaders(json = false) {
    const token = readToken();
    return {
      ...(token ? { "X-Admin-Token": token } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatKes(n) {
    const v = Number(n) || 0;
    try {
      return new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return `KES ${v.toLocaleString()}`;
    }
  }

  function formatPhone(p) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("254")) {
      return `+${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
    }
    if (d.length === 10 && d.startsWith("0")) {
      return `+254 ${d.slice(1, 4)} ${d.slice(4)}`;
    }
    return p || "—";
  }

  function statusBadge(st) {
    const s = String(st || "live").toLowerCase();
    const map = {
      live: "bg-brand-green/20 text-brand-purple",
      paused: "bg-amber-100 text-amber-900",
      under_review: "bg-orange-100 text-orange-900",
      deactivated: "bg-red-100 text-red-800",
    };
    return `<span class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${map[s] || "bg-black/5"}">${escapeHtml(s)}</span>`;
  }

  function itemStatusBadge(st) {
    const s = String(st || "active").toLowerCase();
    const map = {
      active: "bg-brand-green/25 text-brand-purple",
      out_of_stock: "bg-black/10 text-brand-purple/70",
      flagged: "bg-red-100 text-red-800",
      hidden: "bg-amber-100 text-amber-900",
    };
    const label =
      s === "out_of_stock" ? "Out of stock" : s.charAt(0).toUpperCase() + s.slice(1);
    return `<span class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${map[s] || "bg-black/5"}">${escapeHtml(label)}</span>`;
  }

  function thumbsHtml(thumbs, count) {
    const list = Array.isArray(thumbs) ? thumbs.slice(0, 4) : [];
    if (!list.length) {
      return `<span class="text-brand-purple/45 text-xs">${count || 0} items</span>`;
    }
    const stack = list
      .map(
        (src, i) =>
          `<img src="${escapeHtml(src)}" alt="" class="w-9 h-9 rounded-lg object-cover bg-brand-cream ${i ? "-ml-2" : ""}" loading="lazy" />`
      )
      .join("");
    return `<div class="thumb-stack flex items-center"><div class="flex">${stack}</div><span class="ml-2 text-xs font-semibold">${count} listed</span></div>`;
  }

  function rowHtml(shop) {
    const handle = shop.shopHandle || "—";
    const verified = shop.verifiedBadge
      ? `<span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#1DA1F2] text-white text-[9px] font-bold ml-1" title="Verified">✓</span>`
      : "";
    const hold = shop.payoutHold
      ? `<span class="ml-1 text-[10px] font-bold uppercase text-red-700">Hold</span>`
      : "";
    const commission =
      shop.commissionPct != null
        ? `<span class="block text-[11px] text-brand-purple/50">${shop.commissionPct}% commission</span>`
        : "";
    return `
      <tr class="align-top hover:bg-brand-cream/40" data-shop-id="${escapeHtml(shop.id)}">
        <td class="px-4 py-3">
          <div class="font-semibold">${escapeHtml(handle)}${verified}</div>
          <div class="mt-1">${statusBadge(shop.shopStatus)}${hold}</div>
          ${commission}
        </td>
        <td class="px-4 py-3">
          <div class="font-medium">${escapeHtml(shop.sellerName || shop.businessName || "—")}</div>
          <div class="text-xs text-brand-purple/60 mt-0.5 font-mono">${escapeHtml(formatPhone(shop.phone || shop.mpesaNumber))}</div>
        </td>
        <td class="px-4 py-3">
          <button type="button" class="js-open-items text-left hover:opacity-80" data-id="${escapeHtml(shop.id)}" title="Open item gallery">
            ${thumbsHtml(shop.thumbs, shop.listingCount || 0)}
          </button>
        </td>
        <td class="px-4 py-3">
          <div class="font-bold">${formatKes(shop.escrowKes)}</div>
          <div class="text-xs text-brand-purple/55">${shop.orderCount || 0} orders</div>
        </td>
        <td class="px-4 py-3 text-right relative">
          <div class="inline-flex flex-wrap gap-2 justify-end">
            <button type="button" class="js-manage min-h-[40px] px-3 rounded-full border border-brand-purple/15 text-xs font-bold" data-id="${escapeHtml(shop.id)}">Manage</button>
            <div class="relative inline-block">
              <button type="button" class="js-actions-toggle min-h-[40px] px-3 rounded-full bg-brand-green text-brand-purple text-xs font-bold" data-id="${escapeHtml(shop.id)}" aria-haspopup="true">Actions ▾</button>
              <div class="actions-menu absolute right-0 mt-1 w-56 rounded-2xl border border-black/10 bg-white shadow-lg z-10 py-1 text-left" role="menu" data-menu-for="${escapeHtml(shop.id)}">
                <button type="button" class="js-act w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream" data-act="freeze" data-id="${escapeHtml(shop.id)}">Freeze / suspend shop</button>
                <button type="button" class="js-act w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream" data-act="restore" data-id="${escapeHtml(shop.id)}">Restore shop</button>
                <button type="button" class="js-act w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream" data-act="verify" data-id="${escapeHtml(shop.id)}">${shop.verifiedBadge ? "Remove verify badge" : "Verify shop badge"}</button>
                <button type="button" class="js-act w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream" data-act="commission" data-id="${escapeHtml(shop.id)}">Force commission tier</button>
                <button type="button" class="js-act w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream" data-act="payout-hold" data-id="${escapeHtml(shop.id)}">${shop.payoutHold ? "Release payout hold" : "Manual escrow payout hold"}</button>
                <button type="button" class="js-act w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream" data-act="handle" data-id="${escapeHtml(shop.id)}">Override shop handle</button>
                <button type="button" class="js-act w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream" data-act="edit" data-id="${escapeHtml(shop.id)}">Impersonate / edit shop</button>
                <a class="block px-3 py-2.5 text-xs font-semibold hover:bg-brand-cream text-brand-purple" href="admin-seller-listings.html">Flag / hide item → Listings</a>
              </div>
            </div>
          </div>
        </td>
      </tr>`;
  }

  async function loadShops() {
    const token = readToken();
    if (!token) {
      setStatus("Enter admin token first.", true);
      return;
    }
    const q = String(el("shops-q")?.value || "").trim();
    const status = String(el("shops-status")?.value || "all");
    setStatus("Loading shops…");
    try {
      const url = new URL(`${ADMIN_API}/shops-desk`);
      if (q) url.searchParams.set("q", q);
      url.searchParams.set("status", status);
      const res = await fetch(url.toString(), { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || `Load failed (${res.status})`, true);
        return;
      }
      const shops = Array.isArray(data.shops) ? data.shops : [];
      shopCache.clear();
      shops.forEach((s) => shopCache.set(s.id, s));
      const tbody = el("shops-tbody");
      const empty = el("shops-empty");
      if (!tbody) return;
      tbody.innerHTML = shops.map(rowHtml).join("");
      if (empty) empty.classList.toggle("hidden", shops.length > 0);
      setStatus(`${shops.length} shop${shops.length === 1 ? "" : "s"}`);
    } catch (err) {
      setStatus(err?.message || "Network error", true);
    }
  }

  function closeAllMenus() {
    document.querySelectorAll(".actions-menu.is-open").forEach((m) => m.classList.remove("is-open"));
  }

  function openDrawer() {
    el("shops-drawer")?.classList.add("is-open");
    el("shops-backdrop")?.classList.add("is-open");
    el("shops-drawer")?.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    el("shops-drawer")?.classList.remove("is-open");
    el("shops-backdrop")?.classList.remove("is-open");
    el("shops-drawer")?.setAttribute("aria-hidden", "true");
    openShopId = null;
  }

  async function openItems(shopId) {
    openShopId = shopId;
    const shop = shopCache.get(shopId);
    el("drawer-title").textContent = shop?.shopHandle || shop?.businessName || "Shop items";
    el("drawer-sub").textContent = "Loading inventory…";
    el("drawer-body").innerHTML = "";
    openDrawer();
    try {
      const res = await fetch(`${ADMIN_API}/shops/${encodeURIComponent(shopId)}/items`, {
        headers: adminHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        el("drawer-sub").textContent = data.message || "Failed to load items";
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      el("drawer-sub").textContent = `${items.length} item${items.length === 1 ? "" : "s"} · ${data.shop?.shopHandle || ""}`;
      if (!items.length) {
        el("drawer-body").innerHTML =
          `<p class="text-sm text-brand-purple/55 text-center py-8">No listings tied to this shop yet.</p>`;
        return;
      }
      el("drawer-body").innerHTML = items
        .map((item) => {
          const img = item.imageUrl || (item.images && item.images[0]) || "";
          const stock =
            item.stock != null
              ? `Stock ${item.stock}`
              : item.inStock === false
                ? "Out of stock"
                : "In stock";
          return `
          <article class="rounded-2xl border border-black/5 p-3 flex gap-3">
            <button type="button" class="js-inspect shrink-0" data-src="${escapeHtml(img)}" ${img ? "" : "disabled"}>
              ${
                img
                  ? `<img src="${escapeHtml(img)}" alt="" class="w-16 h-16 rounded-xl object-cover bg-brand-cream" />`
                  : `<div class="w-16 h-16 rounded-xl bg-brand-cream"></div>`
              }
            </button>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-start justify-between gap-2">
                <h3 class="font-semibold text-sm truncate">${escapeHtml(item.name)}</h3>
                ${itemStatusBadge(item.status)}
              </div>
              <p class="text-sm font-bold">${formatKes(item.priceKes)}</p>
              <p class="text-xs text-brand-purple/55">${escapeHtml(stock)}</p>
              <div class="flex flex-wrap gap-2 pt-1">
                <button type="button" class="js-takedown min-h-[36px] px-3 rounded-full border border-red-200 text-red-800 text-[11px] font-bold" data-id="${escapeHtml(item.id)}">Flag / hide</button>
                <button type="button" class="js-restore-item min-h-[36px] px-3 rounded-full border border-brand-purple/15 text-[11px] font-semibold" data-id="${escapeHtml(item.id)}">Restore</button>
              </div>
            </div>
          </article>`;
        })
        .join("");
    } catch (err) {
      el("drawer-sub").textContent = err?.message || "Network error";
    }
  }

  function openImage(src) {
    if (!src) return;
    el("img-modal-src").src = src;
    el("img-modal")?.classList.remove("hidden");
  }

  function closeImage() {
    el("img-modal")?.classList.add("hidden");
    el("img-modal-src").src = "";
  }

  async function postAction(path, body = {}) {
    const res = await fetch(`${ADMIN_API}${path}`, {
      method: "POST",
      headers: adminHeaders(true),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  async function runAction(act, shopId) {
    const shop = shopCache.get(shopId) || {};
    closeAllMenus();
    try {
      if (act === "freeze") {
        const note = window.prompt("Freeze note (shown on admin record):", "Frozen by Sokoni admin");
        if (note == null) return;
        await postAction(`/shops/${encodeURIComponent(shopId)}/freeze`, { note });
        setStatus(`Frozen ${shop.shopHandle || shopId}`);
      } else if (act === "restore") {
        await postAction(`/shops/${encodeURIComponent(shopId)}/restore`, {});
        setStatus(`Restored ${shop.shopHandle || shopId}`);
      } else if (act === "verify") {
        const next = !shop.verifiedBadge;
        await postAction(`/shops/${encodeURIComponent(shopId)}/verify`, { verified: next });
        setStatus(next ? "Verified badge on" : "Verified badge off");
      } else if (act === "commission") {
        const raw = window.prompt(
          "Platform commission % (0–40). Leave blank to cancel.",
          shop.commissionPct != null ? String(shop.commissionPct) : "5"
        );
        if (raw == null || raw === "") return;
        const percent = Number(raw);
        await postAction(`/shops/${encodeURIComponent(shopId)}/commission`, { percent });
        setStatus(`Commission set to ${percent}%`);
      } else if (act === "payout-hold") {
        const hold = !shop.payoutHold;
        let note = "";
        if (hold) {
          const n = window.prompt("Payout hold reason:", "Under dispute investigation");
          if (n == null) return;
          note = n;
        }
        await postAction(`/shops/${encodeURIComponent(shopId)}/payout-hold`, { hold, note });
        setStatus(hold ? "Payout hold on" : "Payout hold released");
      } else if (act === "handle") {
        const current = String(shop.shopHandle || "").replace(/^@/, "");
        const next = window.prompt("New shop handle (letters, numbers, _):", current);
        if (next == null || !String(next).trim()) return;
        await postAction(`/shops/${encodeURIComponent(shopId)}/handle`, { handle: next });
        setStatus(`Handle → @${String(next).replace(/^@/, "")}`);
      } else if (act === "edit") {
        openEditModal(shopId);
        return;
      } else {
        return;
      }
      await loadShops();
    } catch (err) {
      setStatus(err?.message || "Action failed", true);
    }
  }

  function openEditModal(shopId) {
    const shop = shopCache.get(shopId) || {};
    el("edit-id").value = shopId;
    el("edit-name").value = shop.businessName || shop.sellerName || "";
    el("edit-phone").value = shop.phone || "";
    el("edit-handle").value = String(shop.shopHandle || "").replace(/^@/, "");
    el("edit-bio").value = "";
    el("edit-modal")?.classList.remove("hidden");
  }

  function closeEditModal() {
    el("edit-modal")?.classList.add("hidden");
  }

  async function submitEdit(e) {
    e.preventDefault();
    const id = el("edit-id").value;
    try {
      await postAction(`/shops/${encodeURIComponent(id)}/edit`, {
        name: el("edit-name").value,
        phone: el("edit-phone").value,
        shopHandle: el("edit-handle").value,
        bio: el("edit-bio").value,
      });
      closeEditModal();
      setStatus("Shop profile updated");
      await loadShops();
    } catch (err) {
      setStatus(err?.message || "Edit failed", true);
    }
  }

  function bind() {
    el("shops-refresh")?.addEventListener("click", () => loadShops());
    el("shops-search")?.addEventListener("click", () => loadShops());
    el("shops-q")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadShops();
      }
    });
    el("drawer-close")?.addEventListener("click", closeDrawer);
    el("shops-backdrop")?.addEventListener("click", closeDrawer);
    el("img-modal-close")?.addEventListener("click", closeImage);
    el("img-modal")?.addEventListener("click", (e) => {
      if (e.target === el("img-modal")) closeImage();
    });
    el("edit-cancel")?.addEventListener("click", closeEditModal);
    el("edit-form")?.addEventListener("submit", submitEdit);

    el("shops-tbody")?.addEventListener("click", (e) => {
      const t = e.target.closest("button, a");
      if (!t) return;
      if (t.classList.contains("js-open-items") || t.classList.contains("js-manage")) {
        openItems(t.dataset.id);
        return;
      }
      if (t.classList.contains("js-actions-toggle")) {
        const id = t.dataset.id;
        const menu = document.querySelector(`.actions-menu[data-menu-for="${CSS.escape(id)}"]`);
        const wasOpen = menu?.classList.contains("is-open");
        closeAllMenus();
        if (menu && !wasOpen) menu.classList.add("is-open");
        return;
      }
      if (t.classList.contains("js-act")) {
        e.preventDefault();
        runAction(t.dataset.act, t.dataset.id);
      }
    });

    el("drawer-body")?.addEventListener("click", async (e) => {
      const inspect = e.target.closest(".js-inspect");
      if (inspect) {
        openImage(inspect.dataset.src);
        return;
      }
      const take = e.target.closest(".js-takedown");
      if (take) {
        const reason = window.prompt("Takedown reason:", "Prohibited or fake listing");
        if (reason == null) return;
        try {
          await postAction(`/seller-listings/${encodeURIComponent(take.dataset.id)}/takedown`, {
            reason,
          });
          setStatus("Item flagged / hidden");
          if (openShopId) await openItems(openShopId);
          await loadShops();
        } catch (err) {
          setStatus(err?.message || "Takedown failed", true);
        }
        return;
      }
      const restore = e.target.closest(".js-restore-item");
      if (restore) {
        try {
          await postAction(`/seller-listings/${encodeURIComponent(restore.dataset.id)}/restore`, {});
          setStatus("Item restored");
          if (openShopId) await openItems(openShopId);
          await loadShops();
        } catch (err) {
          setStatus(err?.message || "Restore failed", true);
        }
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".js-actions-toggle") && !e.target.closest(".actions-menu")) {
        closeAllMenus();
      }
    });
  }

  hydrateToken();
  bind();
  if (readToken()) loadShops();
})();
