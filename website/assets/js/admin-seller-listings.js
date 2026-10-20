/**
 * Admin review queue for flagged / hidden seller listings.
 * Auth: ?token= or saved local token → ADMIN_SETUP_TOKEN / SUPPLIER_ADMIN_TOKEN.
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const ADMIN_API = `${API_BASE}/admin/suppliers`;
  const TOKEN_KEY = "sokoni-admin-listings-token";

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, isError = false) {
    const node = el("admin-status");
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

  function stripTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("token")) return;
    params.delete("token");
    const q = params.toString();
    const next = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash || ""}`;
    try {
      history.replaceState({}, "", next);
    } catch {}
  }

  function hydrateTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = String(params.get("token") || "").trim();
    if (token && el("admin-token")) {
      el("admin-token").value = token;
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {}
      stripTokenFromUrl();
    } else if (el("admin-token")) {
      try {
        el("admin-token").value = localStorage.getItem(TOKEN_KEY) || "";
      } catch {}
    }
  }

  function adminHeaders(extra = {}) {
    const token = readToken();
    return {
      ...(token ? { "X-Admin-Token": token } : {}),
      ...extra,
    };
  }

  function formatWhen(ts) {
    if (!ts) return "";
    try {
      return new Intl.DateTimeFormat("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(ts));
    } catch {
      return "";
    }
  }

  function cardHtml(item) {
    const summary = item.moderationSummary || {};
    const title = item.name || item.id;
    const reason = summary.reason || (summary.labels || []).join(" · ") || "Pending review";
    const img = item.imageUrl || (item.images && item.images[0]) || "";
    const when = formatWhen(summary.hiddenAt || summary.scannedAt);
    const supplier = item.supplierId || item.sellerPhone || "—";
    return `
      <article class="rounded-3xl border border-black/5 bg-white p-4 flex gap-4 items-start" data-id="${item.id}">
        ${img ? `<img src="${img}" alt="" class="w-20 h-20 rounded-xl object-cover shrink-0 bg-brand-cream" />` : `<div class="w-20 h-20 rounded-xl bg-brand-cream shrink-0"></div>`}
        <div class="min-w-0 flex-1 space-y-2">
          <div>
            <h2 class="font-semibold truncate">${title}</h2>
            <p class="text-xs text-brand-purple/60 mt-0.5"><code>${item.id}</code> · supplier ${supplier}</p>
            ${when ? `<p class="text-xs text-brand-purple/50 mt-0.5">Hidden ${when}</p>` : ""}
          </div>
          <p class="text-sm font-medium text-red-700">${reason}</p>
          <label class="block text-xs font-medium">
            Takedown note (optional)
            <input type="text" class="admin-reason mt-1 w-full min-h-[40px] rounded-xl border border-black/10 px-3 text-sm" placeholder="Why keep this removed?" />
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="admin-restore min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-sm font-bold" data-id="${item.id}">Restore</button>
            <button type="button" class="admin-takedown min-h-[44px] px-4 rounded-full border border-red-300 text-red-700 text-sm font-semibold" data-id="${item.id}">Keep removed</button>
            ${
              item.supplierId
                ? `<button type="button" class="admin-shop-action min-h-[44px] px-4 rounded-full border border-brand-purple/20 text-sm font-semibold" data-id="${item.supplierId}" data-action="review">Hold whole shop</button>`
                : ""
            }
          </div>
        </div>
      </article>`;
  }

  async function loadFlagged() {
    const token = readToken();
    const list = el("admin-list");
    if (!token) {
      setStatus("Enter the admin token first.", true);
      return;
    }
    setStatus("Loading flagged listings…");
    list.innerHTML = "";
    try {
      const res = await fetch(`${ADMIN_API}/seller-listings/flagged`, {
        headers: adminHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load flagged listings.", true);
        return;
      }
      const listings = Array.isArray(data.listings) ? data.listings : [];
      if (!listings.length) {
        setStatus("No flagged listings right now.");
        list.innerHTML = `<p class="text-sm text-brand-purple/60">Queue empty — nothing hidden pending review.</p>`;
        return;
      }
      setStatus(`${listings.length} flagged listing${listings.length === 1 ? "" : "s"}`);
      list.innerHTML = listings.map(cardHtml).join("");
      wireActions();
      wireShopActions();
    } catch {
      setStatus("Network error while loading flagged listings.", true);
    }
  }

  async function postAction(id, action, reason) {
    const token = readToken();
    if (!token || !id) return;
    setStatus(`${action === "restore" ? "Restoring" : "Updating"} ${id}…`);
    try {
      const res = await fetch(`${ADMIN_API}/seller-listings/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(action === "takedown" ? { reason: reason || "" } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || `Could not ${action} ${id}.`, true);
        return;
      }
      setStatus(action === "restore" ? `Restored ${id}.` : `Kept ${id} removed.`);
      await loadFlagged();
    } catch {
      setStatus(`Network error during ${action}.`, true);
    }
  }

  function wireActions() {
    document.querySelectorAll(".admin-restore").forEach((btn) => {
      btn.addEventListener("click", () => postAction(btn.dataset.id, "restore"));
    });
    document.querySelectorAll(".admin-takedown").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-id]");
        const reason = card?.querySelector(".admin-reason")?.value || "";
        postAction(btn.dataset.id, "takedown", reason);
      });
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function apiErrorHint(res, data, label) {
    if (res.status === 404) {
      return `${label} API not on the live bot yet — deploy bot (git pull + scripts/deploy-bot.sh). Flagged listings can still work on the older build.`;
    }
    if (res.status === 403) {
      return "Admin token rejected — check ADMIN_SETUP_TOKEN / SUPPLIER_ADMIN_TOKEN.";
    }
    return data.message || data.error || `Could not load ${label}.`;
  }

  function kycCardHtml(s) {
    return `
      <article class="rounded-3xl border border-black/5 bg-white p-4 space-y-2" data-kyc-id="${escapeHtml(s.id)}">
        <div>
          <h2 class="font-semibold">${escapeHtml(s.businessName || s.shopHandle || s.id)}</h2>
          <p class="text-xs text-brand-purple/60 mt-0.5">
            <code>${escapeHtml(s.id)}</code>
            ${s.shopHandle ? ` · ${escapeHtml(s.shopHandle)}` : ""}
            · ${escapeHtml(s.phone || "—")}
          </p>
        </div>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div><dt class="text-xs text-brand-purple/50">National ID</dt><dd class="font-medium">${escapeHtml(s.nationalId || "—")}</dd></div>
          <div><dt class="text-xs text-brand-purple/50">KRA PIN</dt><dd class="font-medium">${escapeHtml(s.kraPin || "—")}</dd></div>
          <div><dt class="text-xs text-brand-purple/50">M-Pesa</dt><dd class="font-medium">${escapeHtml(s.mpesaNumber || "—")}</dd></div>
          <div><dt class="text-xs text-brand-purple/50">Status</dt><dd class="font-medium">${escapeHtml(s.kycStatus || "pending")}</dd></div>
        </dl>
        <label class="block text-xs font-medium">
          Review note (optional)
          <input type="text" class="admin-kyc-note mt-1 w-full min-h-[40px] rounded-xl border border-black/10 px-3 text-sm" placeholder="Verified docs / reason" />
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="admin-kyc-approve min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-sm font-bold" data-id="${escapeHtml(s.id)}">Approve KYC</button>
          <button type="button" class="admin-kyc-reject min-h-[44px] px-4 rounded-full border border-red-300 text-red-700 text-sm font-semibold" data-id="${escapeHtml(s.id)}">Reject KYC</button>
          <button type="button" class="admin-shop-action min-h-[44px] px-4 rounded-full border border-brand-purple/20 text-sm font-semibold" data-id="${escapeHtml(s.id)}" data-action="review">Hold shop + payouts</button>
        </div>
      </article>`;
  }

  function shopCardHtml(s) {
    return `
      <article class="rounded-3xl border border-black/5 bg-white p-4 space-y-2" data-shop-id="${escapeHtml(s.id)}">
        <div>
          <h2 class="font-semibold">${escapeHtml(s.businessName || s.shopHandle || s.id)}</h2>
          <p class="text-xs text-brand-purple/60 mt-0.5">
            <code>${escapeHtml(s.id)}</code>
            ${s.shopHandle ? ` · ${escapeHtml(s.shopHandle)}` : ""}
            · status <strong>${escapeHtml(s.shopStatus || "live")}</strong>
            ${s.payoutHold ? " · payouts held" : ""}
          </p>
          ${s.shopStatusNote ? `<p class="text-sm text-brand-purple/70">${escapeHtml(s.shopStatusNote)}</p>` : ""}
        </div>
        <label class="block text-xs font-medium">
          Note
          <input type="text" class="admin-shop-note mt-1 w-full min-h-[40px] rounded-xl border border-black/10 px-3 text-sm" placeholder="Reason for pause / restore" />
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="admin-shop-action min-h-[44px] px-4 rounded-full border border-brand-purple/20 text-sm font-semibold" data-id="${escapeHtml(s.id)}" data-action="pause">Pause</button>
          <button type="button" class="admin-shop-action min-h-[44px] px-4 rounded-full border border-brand-purple/20 text-sm font-semibold" data-id="${escapeHtml(s.id)}" data-action="review">Under review</button>
          <button type="button" class="admin-shop-action min-h-[44px] px-4 rounded-full border border-red-300 text-red-700 text-sm font-semibold" data-id="${escapeHtml(s.id)}" data-action="deactivate">Deactivate</button>
          <button type="button" class="admin-shop-action min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-sm font-bold" data-id="${escapeHtml(s.id)}" data-action="restore">Restore shop</button>
        </div>
      </article>`;
  }

  async function loadKyc() {
    const token = readToken();
    const list = el("admin-kyc-list");
    if (!list) return;
    if (!token) {
      setStatus("Enter the admin token first.", true);
      return;
    }
    setStatus("Loading seller KYC queue…");
    list.innerHTML = "";
    try {
      const res = await fetch(`${ADMIN_API}/kyc?status=pending`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(apiErrorHint(res, data, "KYC"), true);
        list.innerHTML = `<p class="text-sm text-red-700">${escapeHtml(apiErrorHint(res, data, "KYC"))}</p>`;
        return;
      }
      const sellers = Array.isArray(data.sellers) ? data.sellers : [];
      if (!sellers.length) {
        setStatus("No sellers pending KYC review.");
        list.innerHTML = `<p class="text-sm text-brand-purple/60">KYC queue empty.</p>`;
        return;
      }
      setStatus(`${sellers.length} seller${sellers.length === 1 ? "" : "s"} awaiting KYC`);
      list.innerHTML =
        `<h2 class="font-display text-xl font-bold">Seller KYC</h2>` + sellers.map(kycCardHtml).join("");
      wireKycActions();
      wireShopActions();
    } catch {
      setStatus("Network error while loading KYC.", true);
    }
  }

  async function loadShops() {
    const token = readToken();
    const list = el("admin-shops-list");
    if (!list) return;
    if (!token) {
      setStatus("Enter the admin token first.", true);
      return;
    }
    setStatus("Loading held shops…");
    list.innerHTML = "";
    try {
      const res = await fetch(`${ADMIN_API}/shops?status=held`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(apiErrorHint(res, data, "held shops"), true);
        list.innerHTML = `<p class="text-sm text-red-700">${escapeHtml(apiErrorHint(res, data, "held shops"))}</p>`;
        return;
      }
      const shops = Array.isArray(data.shops) ? data.shops : [];
      if (!shops.length) {
        setStatus("No shops on hold.");
        list.innerHTML = `<p class="text-sm text-brand-purple/60">No paused / under-review / deactivated shops.</p>`;
        return;
      }
      setStatus(`${shops.length} shop${shops.length === 1 ? "" : "s"} held`);
      list.innerHTML =
        `<h2 class="font-display text-xl font-bold">Held shops</h2>
         <p class="text-sm text-brand-purple/60">Listings hidden from the mall + M-Pesa withdraw blocked until Restore.</p>` +
        shops.map(shopCardHtml).join("");
      wireShopActions();
    } catch {
      setStatus("Network error while loading shops.", true);
    }
  }

  async function postKyc(id, action, note) {
    if (!id) return;
    setStatus(`${action === "approve" ? "Approving" : "Rejecting"} ${id}…`);
    try {
      const res = await fetch(`${ADMIN_API}/kyc/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ note: note || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(apiErrorHint(res, data, "KYC action"), true);
        return;
      }
      setStatus(action === "approve" ? `Approved ${id}.` : `Rejected ${id}.`);
      await loadKyc();
    } catch {
      setStatus(`Network error during KYC ${action}.`, true);
    }
  }

  async function postShop(id, action, note) {
    if (!id || !action) return;
    setStatus(`${action} ${id}…`);
    try {
      const res = await fetch(`${ADMIN_API}/shops/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ note: note || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(apiErrorHint(res, data, "shop action"), true);
        return;
      }
      const hidden = data.listings?.hidden;
      const restored = data.listings?.restored;
      setStatus(
        action === "restore"
          ? `Restored ${id}${restored != null ? ` · ${restored} listings back` : ""}.`
          : `${action} set on ${id}${hidden != null ? ` · ${hidden} listings hidden` : ""} · payouts held.`
      );
      await loadShops();
      await loadFlagged();
    } catch {
      setStatus(`Network error during shop ${action}.`, true);
    }
  }

  function wireKycActions() {
    document.querySelectorAll(".admin-kyc-approve").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-kyc-id]");
        const note = card?.querySelector(".admin-kyc-note")?.value || "";
        postKyc(btn.dataset.id, "approve", note);
      });
    });
    document.querySelectorAll(".admin-kyc-reject").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-kyc-id]");
        const note = card?.querySelector(".admin-kyc-note")?.value || "";
        postKyc(btn.dataset.id, "reject", note);
      });
    });
  }

  function wireShopActions() {
    document.querySelectorAll(".admin-shop-action").forEach((btn) => {
      btn.onclick = () => {
        const card = btn.closest("[data-shop-id], [data-kyc-id]");
        const note =
          card?.querySelector(".admin-shop-note")?.value ||
          card?.querySelector(".admin-kyc-note")?.value ||
          "";
        postShop(btn.dataset.id, btn.dataset.action, note);
      };
    });
  }

  function init() {
    hydrateTokenFromUrl();
    el("admin-load-btn")?.addEventListener("click", () => loadFlagged());
    el("admin-refresh-btn")?.addEventListener("click", () => {
      void loadFlagged();
      void loadKyc();
      void loadShops();
    });
    el("admin-kyc-btn")?.addEventListener("click", () => loadKyc());
    el("admin-shops-btn")?.addEventListener("click", () => loadShops());
    if (readToken()) {
      void loadFlagged();
      void loadKyc();
      void loadShops();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
