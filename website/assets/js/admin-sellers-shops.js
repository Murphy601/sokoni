/**
 * Admin Sellers & Shops desk — Depop Admin OS UI.
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
    node.classList.toggle("is-error", isError);
    node.classList.toggle("is-ok", !isError && Boolean(msg));
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

  function shortKes(n) {
    const v = Number(n) || 0;
    if (v >= 1000) {
      const k = v / 1000;
      return `KES ${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
    }
    return formatKes(v);
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

  function shopStatusBadge(shop) {
    if (shop.payoutHold && String(shop.shopStatus || "live").toLowerCase() === "live") {
      return `<span class="badge-status is-hold">Payout hold</span>`;
    }
    const s = String(shop.shopStatus || "live").toLowerCase();
    if (s === "live") return `<span class="badge-status is-active">Active</span>`;
    if (s === "paused") return `<span class="badge-status is-paused">Paused</span>`;
    if (s === "under_review") return `<span class="badge-status is-review">Under review</span>`;
    if (s === "deactivated") return `<span class="badge-status is-flagged">Deactivated</span>`;
    return `<span class="badge-status is-muted">${escapeHtml(s)}</span>`;
  }

  function itemStatusBadge(st) {
    const s = String(st || "active").toLowerCase();
    const map = {
      active: "is-active",
      out_of_stock: "is-muted",
      flagged: "is-flagged",
      hidden: "is-hidden",
    };
    const label =
      s === "out_of_stock" ? "Out of stock" : s.charAt(0).toUpperCase() + s.slice(1);
    return `<span class="badge-status ${map[s] || "is-muted"}">${escapeHtml(label)}</span>`;
  }

  function thumbsHtml(thumbs, count) {
    const list = Array.isArray(thumbs) ? thumbs.slice(0, 3) : [];
    if (!list.length) {
      return `<span class="muted">${count || 0} items</span>`;
    }
    const cells = list
      .map((t) => {
        const url = typeof t === "string" ? t : t.url;
        const price = typeof t === "string" ? null : t.priceKes;
        if (!url) return "";
        return `<span class="thumb-cell" tabindex="0" role="img" aria-label="Item thumbnail">
          <img src="${escapeHtml(url)}" alt="" loading="lazy" />
          ${
            price != null
              ? `<span class="thumb-price">${escapeHtml(shortKes(price))}</span>`
              : ""
          }
        </span>`;
      })
      .join("");
    const extra = count > list.length ? `<span class="thumb-more">+${count - list.length} items</span>` : "";
    return `<div class="thumb-row">${cells}${extra}</div>`;
  }

  function updateMetrics(shops) {
    const active = shops.filter((s) => String(s.shopStatus || "live").toLowerCase() === "live").length;
    const verified = shops.filter((s) => s.verifiedBadge).length;
    const held = shops.filter(
      (s) =>
        String(s.shopStatus || "live").toLowerCase() !== "live" || Boolean(s.payoutHold)
    ).length;
    const holdKes = shops
      .filter((s) => s.payoutHold)
      .reduce((sum, s) => sum + (Number(s.escrowKes) || 0), 0);
    if (el("metric-active")) el("metric-active").textContent = String(active);
    if (el("metric-verified")) el("metric-verified").textContent = String(verified);
    if (el("metric-flagged")) el("metric-flagged").textContent = String(held);
    if (el("metric-holds")) el("metric-holds").textContent = formatKes(holdKes);
  }

  function rowHtml(shop) {
    const handle = shop.shopHandle || "—";
    const verified = shop.verifiedBadge
      ? `<span class="badge-verified">✓ Verified</span>`
      : "";
    const commission =
      shop.commissionPct != null
        ? `<span class="muted" style="display:block;margin-top:0.25rem;">${shop.commissionPct}% commission</span>`
        : "";
    const primaryAction =
      String(shop.shopStatus || "live").toLowerCase() === "live" && !shop.payoutHold
        ? `<button type="button" class="js-act btn-red" data-act="deactivate" data-id="${escapeHtml(shop.id)}">Deactivate</button>`
        : `<button type="button" class="js-act btn-green" data-act="restore" data-id="${escapeHtml(shop.id)}">Restore</button>`;

    return `
      <tr data-shop-id="${escapeHtml(shop.id)}">
        <td>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <span class="handle-name">${escapeHtml(handle)}</span>
            ${verified}
          </div>
          ${commission}
        </td>
        <td>
          <p style="margin:0;font-weight:800;">${escapeHtml(shop.sellerName || shop.businessName || "—")}</p>
          <p class="muted" style="margin:0.2rem 0 0;font-family:ui-monospace,monospace;">${escapeHtml(formatPhone(shop.phone || shop.mpesaNumber))}</p>
        </td>
        <td>
          <button type="button" class="js-open-items" data-id="${escapeHtml(shop.id)}" title="Open item gallery" style="background:none;border:none;padding:0;cursor:pointer;font:inherit;color:inherit;">
            ${thumbsHtml(shop.thumbs, shop.listingCount || 0)}
          </button>
        </td>
        <td>
          <p class="escrow-amt" style="margin:0;">${formatKes(shop.escrowKes)}</p>
          <p class="muted" style="margin:0.2rem 0 0;">${shop.orderCount || 0} orders completed</p>
        </td>
        <td>${shopStatusBadge(shop)}</td>
        <td style="text-align:right;">
          <div style="display:inline-flex;flex-wrap:wrap;gap:0.4rem;justify-content:flex-end;position:relative;">
            <button type="button" class="js-manage btn-ink" data-id="${escapeHtml(shop.id)}">Inspect</button>
            ${primaryAction}
            <div style="position:relative;display:inline-block;">
              <button type="button" class="js-actions-toggle btn-outline" data-id="${escapeHtml(shop.id)}" aria-haspopup="true">Actions ▾</button>
              <div class="actions-menu" role="menu" data-menu-for="${escapeHtml(shop.id)}">
                <button type="button" class="js-act" data-act="pause" data-id="${escapeHtml(shop.id)}">Pause shop (temporary hold)</button>
                <button type="button" class="js-act act-danger" data-act="deactivate" data-id="${escapeHtml(shop.id)}">Deactivate shop (block login)</button>
                <button type="button" class="js-act" data-act="restore" data-id="${escapeHtml(shop.id)}">Restore shop</button>
                <button type="button" class="js-act" data-act="verify" data-id="${escapeHtml(shop.id)}">${shop.verifiedBadge ? "Remove verify badge" : "Verify shop badge"}</button>
                <button type="button" class="js-act" data-act="commission" data-id="${escapeHtml(shop.id)}">Force commission tier</button>
                <button type="button" class="js-act" data-act="payout-hold" data-id="${escapeHtml(shop.id)}">${shop.payoutHold ? "Release payout hold" : "Manual escrow payout hold"}</button>
                <button type="button" class="js-act" data-act="handle" data-id="${escapeHtml(shop.id)}">Override shop handle</button>
                <button type="button" class="js-act" data-act="ratings" data-id="${escapeHtml(shop.id)}">Rating log / purge unfair</button>
                <button type="button" class="js-act" data-act="edit" data-id="${escapeHtml(shop.id)}">Impersonate / edit shop</button>
                <a href="admin-seller-listings.html">Flag / hide item → Listings</a>
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
      updateMetrics(shops);
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
          `<p class="muted" style="text-align:center;padding:2rem 0;">No listings tied to this shop yet.</p>`;
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
          <article class="item-card">
            <button type="button" class="js-inspect" data-src="${escapeHtml(img)}" ${img ? "" : "disabled"} style="padding:0;border:none;background:none;cursor:pointer;">
              ${
                img
                  ? `<img src="${escapeHtml(img)}" alt="" />`
                  : `<div style="width:4rem;height:4rem;border:2px solid #1a1a1a;border-radius:0.5rem;background:#f4f4f4;"></div>`
              }
            </button>
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;">
                <h3 style="margin:0;font-size:0.875rem;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.name)}</h3>
                ${itemStatusBadge(item.status)}
              </div>
              <p style="margin:0.25rem 0 0;font-weight:900;">${formatKes(item.priceKes)}</p>
              <p class="muted" style="margin:0.15rem 0 0;">${escapeHtml(stock)}</p>
              <div style="display:flex;flex-wrap:wrap;gap:0.4rem;padding-top:0.45rem;">
                <button type="button" class="js-takedown btn-red" data-id="${escapeHtml(item.id)}" style="min-height:2.25rem;font-size:0.65rem;">Flag / hide</button>
                <button type="button" class="js-restore-item btn-outline" data-id="${escapeHtml(item.id)}" style="min-height:2.25rem;font-size:0.65rem;">Restore</button>
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
    const modal = el("img-modal");
    if (modal) {
      modal.classList.remove("hidden");
      modal.style.display = "flex";
    }
  }

  function closeImage() {
    const modal = el("img-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.style.display = "none";
    }
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
      if (act === "freeze" || act === "pause") {
        const note = window.prompt(
          "Pause note (seller + Boss get WhatsApp notice):",
          "Temporarily paused by Sokoni admin"
        );
        if (note == null) return;
        await postAction(`/shops/${encodeURIComponent(shopId)}/pause`, { note });
        setStatus(`Paused ${shop.shopHandle || shopId} — shop & listings hidden; seller notified`);
      } else if (act === "deactivate") {
        const note = window.prompt(
          "Deactivate note (blocks seller login; shop unlisted):",
          "Deactivated by Sokoni admin"
        );
        if (note == null) return;
        await postAction(`/shops/${encodeURIComponent(shopId)}/deactivate`, { note });
        setStatus(`Deactivated ${shop.shopHandle || shopId} — login blocked; seller notified`);
      } else if (act === "restore") {
        await postAction(`/shops/${encodeURIComponent(shopId)}/restore`, {});
        setStatus(`Restored ${shop.shopHandle || shopId} — seller notified`);
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
      } else if (act === "ratings") {
        await openRatingsPurge(shopId);
        return;
      } else {
        return;
      }
      await loadShops();
    } catch (err) {
      setStatus(err?.message || "Action failed", true);
    }
  }

  async function openRatingsPurge(shopId) {
    const shop = shopCache.get(shopId) || {};
    let sellerUserId = Number(shop.sellerUserId || shop.userId || 0);
    const CMD = `${API_BASE}/admin/command`;
    const handle = String(shop.shopHandle || "").replace(/^@/, "");
    setStatus("Loading rating log…");
    try {
      const url = sellerUserId
        ? `${CMD}/ratings/seller/${sellerUserId}`
        : `${CMD}/ratings/by-handle/${encodeURIComponent(handle)}`;
      if (!sellerUserId && !handle) {
        setStatus("Shop has no handle or seller user id for ratings.", true);
        return;
      }
      const res = await fetch(url, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Could not load ratings");
      sellerUserId = Number(data.subjectId || sellerUserId);
      const events = Array.isArray(data.events)
        ? data.events.filter((e) => !e.purged && e.poolEntryId)
        : [];
      if (!events.length) {
        setStatus(
          `No purgeable rating entries. Profile: ${
            data.profile?.displayLabel || data.profile?.avgRating || "—"
          }`
        );
        return;
      }
      const lines = events.slice(0, 12).map(
        (e, i) =>
          `${i + 1}. ${e.eventKind} ${e.stars != null ? e.stars + "★" : e.delta || ""} → ${Number(
            e.ratingAfter
          ).toFixed(2)} (${e.poolEntryId})`
      );
      const pick = window.prompt(
        `Purge Unfair Review for ${shop.shopHandle || shopId}\nScore: ${
          data.profile?.unrated ? "UNRATED" : data.profile?.avgRating
        }\n\n${lines.join("\n")}\n\nEnter line number to purge (or cancel):`,
        "1"
      );
      if (pick == null || pick === "") return;
      const idx = Number(pick) - 1;
      const entry = events[idx];
      if (!entry?.poolEntryId) {
        setStatus("Invalid selection", true);
        return;
      }
      if (!window.confirm(`Purge ${entry.poolEntryId} (${entry.eventKind})?`)) return;
      const purgeRes = await fetch(`${CMD}/ratings/purge`, {
        method: "POST",
        headers: adminHeaders(true),
        body: JSON.stringify({
          subjectType: "seller",
          subjectId: sellerUserId,
          poolEntryId: entry.poolEntryId,
          adminLabel: "shops-desk",
        }),
      });
      const purged = await purgeRes.json().catch(() => ({}));
      if (!purgeRes.ok) throw new Error(purged.error || "Purge failed");
      setStatus(
        `Purged. New score ${purged.unrated ? "UNRATED" : Number(purged.rating).toFixed(2)}`
      );
    } catch (err) {
      setStatus(err?.message || "Ratings purge failed", true);
    }
  }

  function openEditModal(shopId) {
    const shop = shopCache.get(shopId) || {};
    el("edit-id").value = shopId;
    el("edit-name").value = shop.businessName || shop.sellerName || "";
    el("edit-phone").value = shop.phone || "";
    el("edit-handle").value = String(shop.shopHandle || "").replace(/^@/, "");
    el("edit-bio").value = "";
    const modal = el("edit-modal");
    if (modal) {
      modal.classList.remove("hidden");
      modal.style.display = "flex";
    }
  }

  function closeEditModal() {
    const modal = el("edit-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.style.display = "none";
    }
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
