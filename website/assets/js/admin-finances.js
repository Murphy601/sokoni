(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const CMD_API = `${API_BASE}/admin/command`;
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
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return `KES ${v.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
  }

  function token() {
    return el("admin-token")?.value?.trim() || localStorage.getItem(TOKEN_KEY) || "";
  }

  function adminHeaders(extra = {}) {
    const t = token();
    return { ...(t ? { "X-Admin-Token": t } : {}), ...extra };
  }

  function setStatus(msg, isError = false) {
    const node = el("fin-status");
    if (!node) return;
    node.textContent = msg || "";
    node.classList.toggle("text-red-600", isError);
    node.classList.toggle("text-brand-green", !isError && Boolean(msg));
  }

  async function loadDashboard() {
    if (!token()) {
      setStatus("Enter admin token.", true);
      return;
    }
    localStorage.setItem(TOKEN_KEY, token());
    setStatus("Loading…");
    try {
      const [dashRes, logsRes] = await Promise.all([
        fetch(`${CMD_API}/dashboard`, { headers: adminHeaders() }),
        fetch(`${CMD_API}/admin-logs?limit=30`, { headers: adminHeaders() }),
      ]);
      const dash = await dashRes.json().catch(() => ({}));
      const logs = await logsRes.json().catch(() => ({}));
      if (!dashRes.ok) {
        setStatus(dash.message || dash.error || "Dashboard failed.", true);
        return;
      }
      const totals = dash.escrow?.totals || {};
      const fees = dash.commissions?.totals || {};
      if (el("stat-escrow")) el("stat-escrow").textContent = formatKes(totals.heldBuyerKes);
      if (el("stat-escrow-count")) {
        el("stat-escrow-count").textContent = `${totals.heldOrders ?? 0} order(s) locked`;
      }
      if (el("stat-ready")) el("stat-ready").textContent = formatKes(totals.settlementOwedKes);
      if (el("stat-ready-count")) {
        el("stat-ready-count").textContent = `${totals.settlementOwedCount || 0} ready for B2C`;
      }
      if (el("stat-fees")) el("stat-fees").textContent = formatKes(fees.earnedPlatformFeeKes);
      if (el("stat-fees-held")) el("stat-fees-held").textContent = formatKes(fees.heldPlatformFeeKes);

      const box = el("admin-logs");
      const empty = el("logs-empty");
      const rows = logs.logs || [];
      if (empty) empty.classList.toggle("hidden", rows.length > 0 || logs.error === "database_not_configured");
      if (box) {
        if (!rows.length) {
          box.innerHTML = logs.error
            ? `<p class="text-sm text-brand-purple/55">${escapeHtml(logs.error)}</p>`
            : "";
        } else {
          box.innerHTML = rows
            .map((r) => {
              const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : "";
              const ok = r.success !== false;
              return `<article class="rounded-2xl border-2 border-[#1A1A1A] p-3 flex flex-wrap justify-between gap-2 ${
                ok ? "" : "border-[#FF2300]"
              }">
                <div>
                  <p class="font-black text-xs uppercase">${escapeHtml(r.action)}</p>
                  <p class="text-xs text-brand-purple/55 mt-0.5">${escapeHtml(r.orderRef || r.targetId || "—")} · ${escapeHtml(r.source || "")}</p>
                  ${r.message ? `<p class="text-xs mt-1">${escapeHtml(String(r.message).slice(0, 160))}</p>` : ""}
                </div>
                <p class="text-[11px] text-brand-purple/50">${escapeHtml(when)}</p>
              </article>`;
            })
            .join("");
        }
      }
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch {
      setStatus("Network error.", true);
    }
  }

  async function runBossOverride() {
    const orderId = el("boss-order-id")?.value?.trim();
    const reason = el("boss-reason")?.value?.trim() || "";
    const status = el("boss-override-status");
    if (!orderId) {
      if (status) status.textContent = "Enter order ID.";
      return;
    }
    if (!reason) {
      if (status) status.textContent = "Reason is required for audit.";
      return;
    }
    if (!token()) {
      setStatus("Enter admin token.", true);
      return;
    }
    if (status) status.textContent = "Releasing…";
    try {
      const res = await fetch(`${CMD_API}/escrow/${encodeURIComponent(orderId)}/release`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          reason: `Boss payout override: ${reason}`,
          adminLabel: "boss-dead-man-ui",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (status) status.textContent = data.message || data.error || "Override failed.";
        return;
      }
      if (status) status.textContent = data.message || `Released ${orderId}.`;
      await loadDashboard();
    } catch {
      if (status) status.textContent = "Network error.";
    }
  }

  function init() {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved && el("admin-token")) el("admin-token").value = saved;
    el("refresh-btn")?.addEventListener("click", () => loadDashboard());
    el("boss-override-btn")?.addEventListener("click", () => runBossOverride());
    el("admin-token")?.addEventListener("change", () => {
      if (token()) localStorage.setItem(TOKEN_KEY, token());
    });
    if (token()) void loadDashboard();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
