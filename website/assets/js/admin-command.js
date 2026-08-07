(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const CMD_API = `${API_BASE}/admin/command`;
  const SEARCH_API = `${API_BASE}/api/search`;
  const TOKEN_KEY = "sokoni-admin-token";

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function token() {
    return el("admin-token")?.value?.trim() || localStorage.getItem(TOKEN_KEY) || "";
  }

  function adminHeaders(extra = {}) {
    const t = token();
    return {
      ...(t ? { "X-Admin-Token": t } : {}),
      ...extra,
    };
  }

  function setStatus(message, isError = false) {
    const node = el("cmd-status");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("text-red-600", isError);
    node.classList.toggle("text-brand-green", !isError && Boolean(message));
  }

  function showTab(name) {
    document.querySelectorAll(".cmd-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === name);
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.getAttribute("data-panel") !== name);
    });
  }

  function orderIsDelivered(o) {
    return Boolean(
      o?.delivered ||
        o?.buyerConfirmed ||
        o?.shipmentStatus === "delivered" ||
        o?.status === "delivered"
    );
  }

  function orderInTransit(o) {
    if (orderIsDelivered(o)) return false;
    if (o?.inTransit) return true;
    const ship = String(o?.shipmentStatus || "").toLowerCase();
    return ["dropped_off", "in_transit", "at_pickup_point", "out_for_delivery"].includes(ship);
  }

  function deliveryBadge(o) {
    const delivered = orderIsDelivered(o);
    const inTransit = orderInTransit(o);
    const label =
      o.deliveryLabel ||
      (delivered && o.buyerConfirmed
        ? "Delivered · buyer confirmed"
        : delivered
          ? "Delivered"
          : inTransit
            ? "In transit"
            : "Not delivered");
    const cls = delivered
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : inTransit
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : "bg-zinc-100 text-zinc-700 border-zinc-200";
    return `<span class="inline-flex items-center min-h-[28px] px-2.5 rounded-full border text-[11px] font-bold uppercase tracking-wide ${cls}">${escapeHtml(label)}</span>`;
  }

  function renderEscrow(tank) {
    const totals = tank?.totals || {};
    if (el("stat-held-buyer")) el("stat-held-buyer").textContent = formatKes(totals.heldBuyerKes);
    if (el("stat-held-seller")) el("stat-held-seller").textContent = formatKes(totals.heldSellerNetKes);
    if (el("stat-held-count")) el("stat-held-count").textContent = String(totals.heldOrders ?? "—");
    if (el("stat-delivery")) {
      el("stat-delivery").textContent = `${totals.deliveredCount ?? 0} / ${totals.notDeliveredCount ?? 0}`;
    }
    if (el("stat-paused")) {
      el("stat-paused").textContent = `${totals.pausedCount || 0} / ${totals.disputeHoldCount || 0}`;
    }
    if (el("till-note")) {
      const till = tank?.till || {};
      el("till-note").textContent = till.number
        ? `Till ${till.number}${till.name ? ` · ${till.name}` : ""}. ${till.note || ""}`
        : till.note || "";
    }
    if (el("escrow-delivery-hint")) {
      el("escrow-delivery-hint").textContent =
        `${totals.deliveredCount || 0} delivered (prefer Release here) · ${totals.notDeliveredCount || 0} not delivered yet · paused ${totals.pausedCount || 0} · dispute holds ${totals.disputeHoldCount || 0}`;
    }
    const wrap = el("escrow-orders");
    if (!wrap) return;
    const orders = tank?.orders || [];
    if (!orders.length) {
      wrap.innerHTML = `<p class="text-sm text-brand-purple/60 rounded-3xl border border-black/5 bg-white p-5">No prepaid orders currently held in escrow.</p>`;
      return;
    }
    wrap.innerHTML = orders
      .map((o) => {
        const flags = [
          o.escrowPaused ? "Paused" : "",
          o.disputeHold ? "Dispute hold" : "",
          o.refundPendingManual ? "Refund pending" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const releaseCls = o.delivered
          ? "bg-brand-green text-brand-purple"
          : "border border-brand-purple/20 text-brand-purple/50";
        return `
        <article class="rounded-3xl border border-black/5 bg-white p-4 space-y-2 ${
          o.delivered ? "ring-1 ring-emerald-200" : ""
        }">
          <div class="flex flex-wrap justify-between gap-2">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-bold font-mono text-sm">${escapeHtml(o.orderId)}</h3>
                ${deliveryBadge(o)}
              </div>
              <p class="text-sm text-brand-purple/70 mt-1">${escapeHtml(o.productName || "Item")}</p>
            </div>
            <p class="font-semibold shrink-0">${formatKes(o.buyerTotalKes)}</p>
          </div>
          <p class="text-xs text-brand-purple/55">${escapeHtml(o.hub || "—")} · escrow ${escapeHtml(o.escrowStatus || "—")}${
            flags ? ` · ${escapeHtml(flags)}` : ""
          }</p>
          <p class="text-xs font-semibold ${o.delivered ? "text-emerald-800" : "text-amber-800"}">${escapeHtml(
            o.releaseHint || (o.delivered ? "Delivered — release when ready" : "Not delivered yet")
          )}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="min-h-[40px] px-3 rounded-full border border-amber-400 text-amber-900 text-xs font-bold" data-quick-override="pause" data-order="${escapeHtml(o.orderId)}">Pause</button>
            <button type="button" class="min-h-[40px] px-3 rounded-full border border-red-300 text-red-800 text-xs font-bold" data-quick-override="refund" data-order="${escapeHtml(o.orderId)}">Refund</button>
            <button type="button" class="min-h-[40px] px-3 rounded-full text-xs font-bold ${releaseCls}" data-quick-override="release" data-order="${escapeHtml(o.orderId)}" title="${escapeHtml(
              o.releaseHint || ""
            )}">Release</button>
          </div>
        </article>`;
      })
      .join("");
    wrap.querySelectorAll("[data-quick-override]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (el("override-order-id")) el("override-order-id").value = btn.getAttribute("data-order") || "";
        showTab("resolve");
        void runOverride(btn.getAttribute("data-quick-override"));
      });
    });
  }

  function renderDisputes(list) {
    const wrap = el("dispute-list");
    if (!wrap) return;
    const disputes = list?.disputes || [];
    if (!disputes.length) {
      wrap.innerHTML = `<p class="text-sm text-brand-purple/60">No open disputes.</p>`;
      return;
    }
    wrap.innerHTML = disputes
      .map(
        (d) => `
      <article class="rounded-2xl border border-black/5 p-4 space-y-2" data-dispute="${escapeHtml(String(d.id))}">
        <div class="flex flex-wrap justify-between gap-2">
          <div>
            <p class="font-bold text-sm">${escapeHtml(d.orderRef)} · #${escapeHtml(String(d.id))}</p>
            <p class="text-xs text-brand-purple/55">${escapeHtml(d.reason)} · ${escapeHtml(d.status)}</p>
          </div>
        </div>
        <p class="text-sm">${escapeHtml(d.buyerStatement || "No statement")}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-resolve="refund" class="min-h-[40px] px-3 rounded-full border border-red-300 text-red-800 text-xs font-bold">Refund</button>
          <button type="button" data-resolve="release" class="min-h-[40px] px-3 rounded-full bg-brand-green text-brand-purple text-xs font-bold">Release</button>
        </div>
      </article>`
      )
      .join("");
    wrap.querySelectorAll("[data-resolve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-dispute]");
        const id = card?.getAttribute("data-dispute");
        if (!id) return;
        btn.disabled = true;
        try {
          const res = await fetch(`${CMD_API}/disputes/${encodeURIComponent(id)}/resolve`, {
            method: "POST",
            headers: adminHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ resolution: btn.getAttribute("data-resolve") }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setStatus(data.message || data.error || "Resolve failed", true);
            return;
          }
          setStatus(data.message || "Dispute resolved.");
          await loadDashboard();
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function renderHubs(hubsPayload) {
    const hubs = hubsPayload?.hubs || [];
    const max = hubs[0]?.orders || 1;
    if (el("hub-top")) {
      el("hub-top").textContent = hubs[0]
        ? `Top hub: ${hubs[0].hub} — ${hubs[0].orders} orders · ${formatKes(hubs[0].buyerKes)}`
        : "No hub volume in this window yet.";
    }
    const wrap = el("hub-list");
    if (!wrap) return;
    if (!hubs.length) {
      wrap.innerHTML = `<p class="text-sm text-brand-purple/60">No drop-off data yet. Hub labels appear after #scan / landmark checkout.</p>`;
      return;
    }
    wrap.innerHTML = hubs
      .map((h) => {
        const pct = Math.max(4, Math.round((h.orders / max) * 100));
        return `
        <div class="rounded-2xl border border-black/5 p-4 space-y-2">
          <div class="flex flex-wrap justify-between gap-2">
            <p class="font-semibold text-sm">${escapeHtml(h.hub)}</p>
            <p class="text-xs text-brand-purple/55">${h.orders} orders · ${h.scanned} scanned · ${h.delivered} delivered</p>
          </div>
          <div class="cmd-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <p class="text-xs text-brand-purple/60">${formatKes(h.buyerKes)} buyer volume · ${h.awaitingShip} awaiting ship</p>
        </div>`;
      })
      .join("");
  }

  async function loadDashboard() {
    const t = token();
    if (!t) {
      setStatus("Enter admin token.", true);
      return;
    }
    localStorage.setItem(TOKEN_KEY, t);
    setStatus("Loading…");
    try {
      const days = Number(el("hub-days")?.value || 30);
      const [dashRes, hubRes] = await Promise.all([
        fetch(`${CMD_API}/dashboard`, { headers: adminHeaders() }),
        fetch(`${CMD_API}/hubs?days=${encodeURIComponent(days)}`, { headers: adminHeaders() }),
      ]);
      const dash = await dashRes.json().catch(() => ({}));
      const hubs = await hubRes.json().catch(() => ({}));
      if (!dashRes.ok) {
        setStatus(dash.message || dash.error || "Could not load dashboard.", true);
        return;
      }
      renderEscrow(dash.escrow);
      renderDisputes(dash.disputes);
      renderHubs(hubRes.ok ? hubs : dash.hubs);
      setStatus(
        `Tank ${dash.escrow?.totals?.heldOrders || 0} orders · ${dash.disputes?.openCount || 0} open disputes · updated ${new Date().toLocaleTimeString()}`
      );
    } catch {
      setStatus("Network error loading command center.", true);
    }
  }

  async function runOverride(action) {
    const orderId = el("override-order-id")?.value?.trim();
    const reason = el("override-reason")?.value?.trim() || "";
    const status = el("override-status");
    if (!orderId) {
      if (status) status.textContent = "Enter an order ID.";
      return;
    }
    if (!token()) {
      setStatus("Enter admin token.", true);
      return;
    }
    if (status) status.textContent = "Working…";
    try {
      const res = await fetch(`${CMD_API}/escrow/${encodeURIComponent(orderId)}/${action}`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (status) status.textContent = data.message || data.error || "Override failed.";
        return;
      }
      if (status) status.textContent = data.message || "Done.";
      await loadDashboard();
    } catch {
      if (status) status.textContent = "Network error.";
    }
  }

  let suggestTimer = null;
  async function runSmartSearch(q) {
    const query = String(q || "").trim();
    const results = el("smart-results");
    const suggestions = el("smart-suggestions");
    if (!query) {
      if (results) results.innerHTML = "";
      if (suggestions) suggestions.innerHTML = "";
      return;
    }
    if (results) results.innerHTML = `<p class="text-sm text-brand-purple/55">Searching…</p>`;
    try {
      const res = await fetch(`${SEARCH_API}?q=${encodeURIComponent(query)}&limit=12`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (results) results.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(data.message || "Search failed")}</p>`;
        return;
      }
      if (suggestions) {
        suggestions.innerHTML = (data.suggestions || [])
          .map(
            (s) =>
              `<button type="button" class="min-h-[36px] px-3 rounded-full border border-brand-purple/15 text-xs font-semibold" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`
          )
          .join("");
        suggestions.querySelectorAll("[data-suggest]").forEach((btn) => {
          btn.addEventListener("click", () => {
            if (el("smart-q")) el("smart-q").value = btn.getAttribute("data-suggest") || "";
            void runSmartSearch(el("smart-q")?.value);
          });
        });
      }
      const products = data.products || [];
      if (!products.length) {
        if (results) {
          results.innerHTML = `<p class="text-sm text-brand-purple/60">No matches for “${escapeHtml(query)}”. Engine: ${escapeHtml(data.engine || "sokoni-smart")}.</p>`;
        }
        return;
      }
      if (results) {
        results.innerHTML =
          `<p class="text-xs text-brand-purple/50 mb-2">Expanded: ${escapeHtml(data.expandedQuery || query)} · ${products.length} hits</p>` +
          products
            .map(
              (p) => `
            <div class="flex gap-3 items-center rounded-2xl border border-black/5 p-3">
              ${
                p.imageUrl
                  ? `<img src="${escapeHtml(p.imageUrl)}" alt="" class="w-14 h-14 rounded-xl object-cover bg-brand-cream" />`
                  : `<div class="w-14 h-14 rounded-xl bg-brand-cream"></div>`
              }
              <div class="min-w-0">
                <p class="font-semibold text-sm truncate">${escapeHtml(p.name)}</p>
                <p class="text-xs text-brand-purple/55 font-mono">${escapeHtml(p.id)} · ${formatKes(p.priceKes)}</p>
                <p class="text-xs text-brand-purple/45">${escapeHtml([p.browseCategory, p.browseSubCategory].filter(Boolean).join(" → "))}</p>
              </div>
            </div>`
            )
            .join("");
      }
    } catch {
      if (results) results.innerHTML = `<p class="text-sm text-red-600">Network error.</p>`;
    }
  }

  function bindUi() {
    const tokenInput = el("admin-token");
    if (tokenInput) {
      tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
      tokenInput.addEventListener("change", () => {
        if (tokenInput.value.trim()) localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
      });
    }
    document.querySelectorAll(".cmd-tab").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.dataset.tab));
    });
    el("refresh-btn")?.addEventListener("click", () => loadDashboard());
    el("hub-days")?.addEventListener("change", () => loadDashboard());
    document.querySelectorAll("[data-override]").forEach((btn) => {
      btn.addEventListener("click", () => runOverride(btn.getAttribute("data-override")));
    });
    el("smart-q")?.addEventListener("input", () => {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => runSmartSearch(el("smart-q")?.value), 280);
    });
    el("smart-q")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void runSmartSearch(el("smart-q")?.value);
      }
    });
  }

  bindUi();
  if (token()) void loadDashboard();
  else setStatus("Enter admin token to load the holding tank.");
})();
