(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const BODA_API = `${API_BASE}/admin/boda`;
  const CMD_API = `${API_BASE}/admin/command`;
  const TOKEN_KEY = "sokoni-admin-token";

  let fleetFilter = "all";
  let cache = [];

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
    return { ...(t ? { "X-Admin-Token": t } : {}), ...extra };
  }

  function setStatus(msg, isError = false) {
    const node = el("fleet-status");
    if (!node) return;
    node.textContent = msg || "";
    node.classList.toggle("text-red-600", isError);
    node.classList.toggle("text-brand-green", !isError && Boolean(msg));
  }

  function badgeHtml(status) {
    const s = String(status || "OFFLINE").toUpperCase();
    if (s === "ON_DELIVERY") {
      return `<span class="inline-flex items-center text-[10px] font-black uppercase tracking-wide px-3 py-1 rounded-full bg-[#1A1A1A] text-white">On delivery</span>`;
    }
    if (s === "AVAILABLE") {
      return `<span class="inline-flex items-center text-[10px] font-black uppercase tracking-wide px-3 py-1 rounded-full bg-[#00D26A] text-white">Available</span>`;
    }
    if (s === "SUSPENDED") {
      return `<span class="inline-flex items-center text-[10px] font-black uppercase tracking-wide px-3 py-1 rounded-full bg-[#FF2300] text-white">Suspended</span>`;
    }
    if (s === "PENDING") {
      return `<span class="inline-flex items-center text-[10px] font-black uppercase tracking-wide px-3 py-1 rounded-full border-2 border-[#1A1A1A] text-[#1A1A1A]">Pending</span>`;
    }
    return `<span class="inline-flex items-center text-[10px] font-black uppercase tracking-wide px-3 py-1 rounded-full bg-gray-300 text-[#1A1A1A]">Offline</span>`;
  }

  function render() {
    const grid = el("rider-grid");
    if (!grid) return;
    const rows =
      fleetFilter === "all" ? cache : cache.filter((r) => r.fleetStatus === fleetFilter);
    if (!rows.length) {
      grid.innerHTML = `<p class="text-sm text-brand-purple/60 col-span-full">No riders in this filter.</p>`;
      return;
    }
    grid.innerHTML = rows
      .map((r) => {
        const gps =
          r.lastLat != null && r.lastLng != null
            ? `${Number(r.lastLat).toFixed(4)}, ${Number(r.lastLng).toFixed(4)}`
            : "No pin yet";
        const job = r.activeOrderRef
          ? `<p class="text-xs font-bold mt-1">Job ${escapeHtml(r.activeOrderRef)} · ${escapeHtml(
              r.activeDispatchStatus || ""
            )}</p>`
          : "";
        const suspendBtn =
          r.verificationStatus === "SUSPENDED"
            ? `<button type="button" data-verify="VERIFIED" data-id="${r.id}" class="js-verify min-h-[40px] px-4 rounded-full bg-[#00D26A] text-white text-xs font-black border-2 border-[#1A1A1A]">Unsuspend</button>`
            : `<button type="button" data-verify="SUSPENDED" data-id="${r.id}" class="js-verify min-h-[40px] px-4 rounded-full bg-[#FF2300] text-white text-xs font-black border-2 border-[#1A1A1A]">Suspend rider</button>`;
        return `<article class="rounded-2xl border-2 border-[#1A1A1A] bg-white p-5 shadow-[4px_4px_0px_0px_#1A1A1A] space-y-3" data-rider-id="${r.id}">
          <div class="flex justify-between items-start gap-2">
            <div>
              <h3 class="font-black text-lg">${escapeHtml(r.fullName || "Rider")}</h3>
              <p class="text-xs text-brand-purple/55">${escapeHtml(r.phone)} · ${escapeHtml(
          r.operatingTown || ""
        )} · ${escapeHtml(r.motorbikePlate || "—")}</p>
              ${job}
            </div>
            ${badgeHtml(r.fleetStatus)}
          </div>
          <p class="text-xs bg-[#F4F4F4] border border-[#1A1A1A] rounded-xl px-3 py-2 font-mono">GPS ${escapeHtml(
            gps
          )}</p>
          <div class="flex flex-wrap gap-2 pt-1">
            ${suspendBtn}
            <button type="button" class="js-fill-reassign min-h-[40px] px-4 rounded-full bg-[#1A1A1A] text-white text-xs font-black" data-phone="${escapeHtml(
              r.phone || ""
            )}" data-order="${escapeHtml(r.activeOrderRef || "")}">Reassign route</button>
          </div>
        </article>`;
      })
      .join("");

    grid.querySelectorAll(".js-verify").forEach((btn) => {
      btn.addEventListener("click", () =>
        void verifyRider(btn.getAttribute("data-id"), btn.getAttribute("data-verify"))
      );
    });
    grid.querySelectorAll(".js-fill-reassign").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (el("reassign-phone")) el("reassign-phone").value = btn.getAttribute("data-phone") || "";
        const ord = btn.getAttribute("data-order") || "";
        if (ord && el("reassign-order")) el("reassign-order").value = ord;
        el("reassign-order")?.focus();
      });
    });
  }

  async function loadFleet() {
    if (!token()) {
      setStatus("Enter admin token.", true);
      return;
    }
    localStorage.setItem(TOKEN_KEY, token());
    setStatus("Loading fleet…");
    try {
      const res = await fetch(`${BODA_API}/riders?limit=100`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load riders.", true);
        cache = [];
        render();
        return;
      }
      cache = data.riders || [];
      setStatus(`${cache.length} rider(s)`);
      render();
    } catch {
      setStatus("Network error.", true);
    }
  }

  async function verifyRider(id, status) {
    if (!token()) return;
    const reason =
      status === "SUSPENDED"
        ? window.prompt("Suspend reason:", "Ops suspend from fleet desk") || "Ops suspend"
        : "Unsuspended from fleet desk";
    setStatus(`${status === "SUSPENDED" ? "Suspending" : "Updating"} #${id}…`);
    try {
      const res = await fetch(`${BODA_API}/riders/${encodeURIComponent(id)}/verify`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Update failed.", true);
        return;
      }
      await loadFleet();
    } catch {
      setStatus("Network error.", true);
    }
  }

  async function reassignRoute() {
    const orderId = el("reassign-order")?.value?.trim();
    const phone = el("reassign-phone")?.value?.trim();
    const status = el("reassign-status");
    if (!orderId || !phone) {
      if (status) status.textContent = "Need order ID and rider phone.";
      return;
    }
    if (!token()) {
      setStatus("Enter admin token.", true);
      return;
    }
    if (status) status.textContent = "Reassigning…";
    try {
      const res = await fetch(`${CMD_API}/master`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          command: `REASSIGN RIDER ${orderId} ${phone}`,
          adminLabel: "fleet-desk",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        if (status) status.textContent = data.reply || data.message || data.error || "Failed.";
        return;
      }
      if (status) status.textContent = data.reply || "Reassigned.";
      await loadFleet();
    } catch {
      if (status) status.textContent = "Network error.";
    }
  }

  function init() {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved && el("admin-token")) el("admin-token").value = saved;
    el("refresh-btn")?.addEventListener("click", () => loadFleet());
    el("reassign-btn")?.addEventListener("click", () => reassignRoute());
    document.querySelectorAll(".fleet-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        fleetFilter = btn.getAttribute("data-filter") || "all";
        document.querySelectorAll(".fleet-filter").forEach((b) => b.classList.toggle("is-active", b === btn));
        render();
      });
    });
    if (token()) void loadFleet();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
