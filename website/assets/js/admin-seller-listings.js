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

  function init() {
    hydrateTokenFromUrl();
    el("admin-load-btn")?.addEventListener("click", () => loadFlagged());
    el("admin-refresh-btn")?.addEventListener("click", () => loadFlagged());
    if (readToken()) void loadFlagged();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
