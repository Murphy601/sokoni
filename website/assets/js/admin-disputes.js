(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const DISPUTES_API = `${API_BASE}/api/disputes`;
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

  function setStatus(message, isError = false) {
    const node = el("admin-status");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("text-red-600", isError);
    node.classList.toggle("text-brand-green", !isError && Boolean(message));
  }

  async function loadList(status = "open") {
    const t = token();
    if (!t) {
      setStatus("Enter admin token.", true);
      return;
    }
    localStorage.setItem(TOKEN_KEY, t);
    setStatus("Loading…");
    const list = el("disputes-list");
    if (list) list.innerHTML = "";
    try {
      const res = await fetch(
        `${DISPUTES_API}/admin/list?status=${encodeURIComponent(status)}`,
        { headers: adminHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load disputes.", true);
        return;
      }
      const disputes = Array.isArray(data.disputes) ? data.disputes : [];
      setStatus(`${disputes.length} dispute${disputes.length === 1 ? "" : "s"}`);
      if (!disputes.length) {
        if (list) list.innerHTML = `<p class="text-sm text-brand-purple/60">No disputes in this queue.</p>`;
        return;
      }
      if (list) {
        list.innerHTML = disputes
          .map(
            (d) => `
          <article class="rounded-3xl border border-black/5 bg-white p-5 space-y-3" data-id="${escapeHtml(String(d.id))}">
            <div class="flex flex-wrap justify-between gap-2">
              <div>
                <h2 class="font-bold">${escapeHtml(d.orderRef)} · #${escapeHtml(String(d.id))}</h2>
                <p class="text-xs text-brand-purple/55 mt-1">${escapeHtml(d.reason)} · ${escapeHtml(d.status)}</p>
              </div>
              <button type="button" data-open-detail class="min-h-[44px] px-3 rounded-full border border-brand-purple/20 text-xs font-semibold">Open detail</button>
            </div>
            <p class="text-sm">${escapeHtml(d.buyerStatement || "No buyer statement")}</p>
            ${d.sellerResponse ? `<p class="text-sm text-brand-purple/70">Seller: ${escapeHtml(d.sellerResponse)}</p>` : ""}
            <div class="flex flex-wrap gap-2" data-actions>
              <button type="button" data-resolve="refund" class="min-h-[44px] px-4 rounded-full border border-red-300 text-red-800 text-xs font-bold">Refund buyer</button>
              <button type="button" data-resolve="release" class="min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-xs font-bold">Release to seller</button>
            </div>
            <pre class="hidden text-xs bg-brand-cream rounded-2xl p-3 overflow-auto max-h-64" data-detail></pre>
          </article>`
          )
          .join("");
        bindCards(list);
      }
    } catch {
      setStatus("Network error.", true);
    }
  }

  function bindCards(list) {
    list.querySelectorAll("[data-open-detail]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-id]");
        const id = card?.getAttribute("data-id");
        const detail = card?.querySelector("[data-detail]");
        if (!detail) return;
        detail.classList.remove("hidden");
        detail.textContent = "Loading…";
        try {
          const res = await fetch(`${DISPUTES_API}/${encodeURIComponent(id)}`, {
            headers: adminHeaders(),
          });
          const data = await res.json().catch(() => ({}));
          detail.textContent = JSON.stringify(data, null, 2);
        } catch {
          detail.textContent = "Could not load detail.";
        }
      });
    });
    list.querySelectorAll("[data-resolve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-id]");
        const id = card?.getAttribute("data-id");
        const resolution = btn.getAttribute("data-resolve");
        const notes = window.prompt(`Admin notes for ${resolution}:`, "") || "";
        setStatus(`Resolving #${id}…`);
        try {
          const res = await fetch(`${DISPUTES_API}/admin/${encodeURIComponent(id)}/resolve`, {
            method: "POST",
            headers: adminHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ resolution, notes }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setStatus(data.message || data.error || "Resolve failed.", true);
            return;
          }
          setStatus(`Resolved #${id} → ${resolution}`);
          void loadList("open");
        } catch {
          setStatus("Network error.", true);
        }
      });
    });
  }

  function init() {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved && el("admin-token")) el("admin-token").value = saved;
    const params = new URLSearchParams(window.location.search);
    if (params.get("token") && el("admin-token")) {
      el("admin-token").value = params.get("token");
      try {
        localStorage.setItem(TOKEN_KEY, params.get("token"));
      } catch {}
      stripTokenFromUrl();
    }
    el("load-open-btn")?.addEventListener("click", () => loadList("open"));
    el("load-all-btn")?.addEventListener("click", () => loadList("all"));
    if (token()) void loadList("open");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
