(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const BODA_API = `${API_BASE}/admin/boda`;
  const TOKEN_KEY = "sokoni-admin-token";

  let cache = [];
  let queryText = "";
  let statusFilter = "all";

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

  function formatPhone(p) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length >= 12 && d.startsWith("254")) {
      return `+${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
    }
    return p || "—";
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
    node.classList.toggle("is-error", isError);
    node.classList.toggle("is-ok", !isError && Boolean(msg));
  }

  function closeAllMenus() {
    document.querySelectorAll(".actions-menu.is-open").forEach((m) => m.classList.remove("is-open"));
  }

  function badgeHtml(r) {
    const s = String(r.fleetStatus || "OFFLINE").toUpperCase();
    if (s === "ON_DELIVERY") {
      const job = r.activeOrderRef ? ` (#${escapeHtml(r.activeOrderRef)})` : "";
      return `<span class="fleet-badge is-delivery">On delivery${job}</span>`;
    }
    if (s === "AVAILABLE") return `<span class="fleet-badge is-available">Available</span>`;
    if (s === "SUSPENDED") return `<span class="fleet-badge is-suspended">Suspended</span>`;
    if (s === "PENDING") return `<span class="fleet-badge is-pending">Pending</span>`;
    return `<span class="fleet-badge is-offline">Offline</span>`;
  }

  function filteredRows() {
    const q = queryText.trim().toLowerCase();
    return cache.filter((r) => {
      if (statusFilter !== "all" && r.fleetStatus !== statusFilter) return false;
      if (!q) return true;
      const blob = [
        r.fullName,
        r.phone,
        r.motorbikePlate,
        r.bikeLabel,
        r.activeOrderRef,
        r.operatingTown,
        r.stageLocation,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  function updateMetrics(rows) {
    if (el("metric-total")) el("metric-total").textContent = String(rows.length);
    if (el("metric-delivery")) {
      el("metric-delivery").textContent = String(rows.filter((r) => r.fleetStatus === "ON_DELIVERY").length);
    }
    if (el("metric-available")) {
      el("metric-available").textContent = String(rows.filter((r) => r.fleetStatus === "AVAILABLE").length);
    }
    if (el("metric-suspended")) {
      el("metric-suspended").textContent = String(rows.filter((r) => r.fleetStatus === "SUSPENDED").length);
    }
  }

  function render() {
    const tbody = el("fleet-tbody");
    const empty = el("fleet-empty");
    if (!tbody) return;
    const rows = filteredRows();
    updateMetrics(statusFilter === "all" && !queryText ? cache : rows);
    if (empty) empty.classList.toggle("hidden", rows.length > 0);
    if (!rows.length) {
      tbody.innerHTML = "";
      return;
    }
    tbody.innerHTML = rows
      .map((r) => {
        const suspended = r.verificationStatus === "SUSPENDED";
        const pending = r.verificationStatus === "PENDING";
        const bike =
          r.stageLocation || r.licenseClass
            ? `${escapeHtml(r.stageLocation || r.licenseClass || "Bike")} · ${escapeHtml(r.motorbikePlate || "—")}`
            : escapeHtml(r.motorbikePlate || "Bike —");
        const primaryBtn =
          r.fleetStatus === "ON_DELIVERY"
            ? `<button type="button" class="btn-ink js-act" data-act="reassign" data-id="${r.id}">Reassign</button>`
            : r.fleetStatus === "AVAILABLE"
              ? `<button type="button" class="btn-ink js-act" data-act="assign" data-id="${r.id}">Assign job</button>`
              : suspended
                ? `<button type="button" class="btn-green js-act" data-act="unban" data-id="${r.id}">Unban</button>`
                : pending
                  ? `<button type="button" class="btn-green js-act" data-act="verify" data-id="${r.id}">Verify</button>`
                  : `<button type="button" class="btn-outline js-act" data-act="gps" data-id="${r.id}">GPS</button>`;
        return `<tr data-rider-id="${r.id}">
          <td>
            <p style="margin:0;font-weight:900;font-size:0.95rem;">${escapeHtml(r.fullName || "Rider")}</p>
            <p class="muted" style="margin:0.2rem 0 0;font-size:0.7rem;font-weight:700;">${escapeHtml(
              formatPhone(r.phone)
            )} · ${bike}</p>
          </td>
          <td>${badgeHtml(r)}</td>
          <td style="font-weight:900;">${Number(r.completedTrips || 0)} trips</td>
          <td style="font-weight:900;color:${Number(r.unpaidLedgerKes) > 0 ? "#00D26A" : "inherit"};">${formatKes(
            r.unpaidLedgerKes
          )}</td>
          <td style="text-align:right;">
            <div style="display:inline-flex;gap:0.4rem;align-items:center;position:relative;justify-content:flex-end;">
              ${primaryBtn}
              <button type="button" class="btn-outline js-actions-toggle" data-id="${r.id}" aria-haspopup="true">Actions ▾</button>
              <div class="actions-menu" data-menu-for="${r.id}">
                <button type="button" class="js-act" data-act="reassign" data-id="${r.id}">⚡ Force reassign job</button>
                <button type="button" class="js-act" data-act="noshow" data-id="${r.id}">🔓 Override no-show timer</button>
                ${
                  suspended
                    ? `<button type="button" class="js-act" data-act="unban" data-id="${r.id}">✅ Unban rider</button>`
                    : `<button type="button" class="js-act act-danger" data-act="suspend" data-id="${r.id}">🛑 Suspend / ban</button>`
                }
                <button type="button" class="js-act act-danger" data-act="delete" data-id="${r.id}">🗑️ Delete permanently</button>
                <button type="button" class="js-act" data-act="bonus" data-id="${r.id}">💸 Direct wallet payout</button>
                ${
                  pending || r.verificationStatus === "REJECTED"
                    ? `<button type="button" class="js-act" data-act="verify" data-id="${r.id}">✅ Verify documents</button>`
                    : `<button type="button" class="js-act" data-act="docs" data-id="${r.id}">✅ View / re-verify docs</button>`
                }
                <button type="button" class="js-act" data-act="gps" data-id="${r.id}">🗺️ Live GPS tracking</button>
              </div>
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  function findRider(id) {
    return cache.find((r) => String(r.id) === String(id));
  }

  async function loadFleet() {
    if (!token()) {
      setStatus("Enter admin token.", true);
      return;
    }
    localStorage.setItem(TOKEN_KEY, token());
    setStatus("Loading fleet…");
    try {
      const res = await fetch(`${BODA_API}/riders?limit=200`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load riders.", true);
        cache = [];
        render();
        return;
      }
      cache = data.riders || [];
      setStatus(`${cache.length} rider(s) loaded`);
      render();
    } catch {
      setStatus("Network error.", true);
    }
  }

  async function postJson(path, body) {
    const res = await fetch(`${BODA_API}${path}`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.reply || data.error || "Request failed");
      err.data = data;
      throw err;
    }
    return data;
  }

  function openMap(r) {
    const modal = el("map-modal");
    if (!modal) return;
    const lat = r.lastLat;
    const lng = r.lastLng;
    el("map-title").textContent = r.fullName || "Rider GPS";
    if (lat == null || lng == null) {
      el("map-meta").textContent = "No live pin yet — rider must share WhatsApp Live Location.";
      el("map-frame").removeAttribute("src");
      el("map-external").href = "#";
    } else {
      el("map-meta").textContent = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}${
        r.lastLocationAt ? ` · ${new Date(r.lastLocationAt).toLocaleString()}` : ""
      }`;
      const delta = 0.01;
      const bbox = `${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}`;
      el("map-frame").src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
      el("map-external").href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    }
    modal.classList.add("is-open");
  }

  function closeMap() {
    el("map-modal")?.classList.remove("is-open");
  }

  function openAdd() {
    el("add-modal")?.classList.add("is-open");
  }
  function closeAdd() {
    el("add-modal")?.classList.remove("is-open");
  }

  async function runAction(act, id) {
    const r = findRider(id);
    if (!r) return;
    closeAllMenus();
    try {
      if (act === "gps") {
        openMap(r);
        return;
      }
      if (act === "docs") {
        const docs = r.docs || {};
        const lines = [
          `ID front: ${docs.nationalIdFrontUrl || "—"}`,
          `License: ${docs.licenseUrl || "—"}`,
          `Good conduct: ${docs.goodConductUrl || "—"}`,
          `NTSA: ${docs.ntsaBadgeUrl || "—"}`,
        ].join("\n");
        window.alert(`Docs for ${r.fullName || r.phone}\n\n${lines}`);
        const ok = window.confirm("Mark documents VERIFIED?");
        if (!ok) return;
        await postJson(`/riders/${encodeURIComponent(id)}/verify`, {
          status: "VERIFIED",
          reason: "Docs verified from fleet desk",
        });
        setStatus(`Verified #${id}`);
        await loadFleet();
        return;
      }
      if (act === "verify") {
        await postJson(`/riders/${encodeURIComponent(id)}/verify`, {
          status: "VERIFIED",
          reason: "Verified from fleet directory",
        });
        setStatus(`Verified #${id}`);
        await loadFleet();
        return;
      }
      if (act === "suspend") {
        const reason = window.prompt("Suspend reason:", "Ops suspend from fleet directory") || "";
        if (!reason) return;
        await postJson(`/riders/${encodeURIComponent(id)}/verify`, {
          status: "SUSPENDED",
          reason,
        });
        setStatus(`Suspended #${id}`);
        await loadFleet();
        return;
      }
      if (act === "unban") {
        await postJson(`/riders/${encodeURIComponent(id)}/verify`, {
          status: "VERIFIED",
          reason: "Unbanned from fleet directory",
        });
        setStatus(`Unbanned #${id}`);
        await loadFleet();
        return;
      }
      if (act === "delete") {
        const typed = window.prompt(
          `PERMANENTLY delete rider ${r.fullName || r.phone || id}? Type DELETE to confirm. They can re-apply later from scratch.`
        );
        if (String(typed || "").trim().toUpperCase() !== "DELETE") {
          setStatus("Delete cancelled — type DELETE to confirm.", true);
          return;
        }
        await postJson(`/riders/${encodeURIComponent(id)}/delete`, { confirm: true });
        setStatus(`Deleted rider #${id} permanently`);
        await loadFleet();
        return;
      }
      if (act === "reassign" || act === "assign") {
        const orderId =
          window.prompt(
            act === "assign" ? "Order ID to assign to this rider:" : "Order ID to force-reassign:",
            r.activeOrderRef || "SKN-"
          ) || "";
        if (!orderId.trim()) return;
        let toPhone = r.phone;
        if (act === "reassign" && r.fleetStatus === "ON_DELIVERY") {
          const next = window.prompt("Reassign TO rider phone (available):", "") || "";
          if (!next.trim()) return;
          toPhone = next.trim();
        }
        const data = await postJson(`/dispatches/force-reassign`, {
          orderId: orderId.trim(),
          toRiderPhone: toPhone,
          adminLabel: "fleet-directory",
        });
        setStatus(data.reply || `Reassigned ${orderId}`);
        await loadFleet();
        return;
      }
      if (act === "noshow") {
        const orderId =
          window.prompt("Order ID for no-show override:", r.activeOrderRef || "") || "";
        if (!orderId.trim()) return;
        const data = await postJson(`/riders/${encodeURIComponent(id)}/override-noshow`, {
          orderId: orderId.trim(),
          reason: "Admin override from fleet directory",
        });
        setStatus(data.message || data.reply || "No-show timer overridden");
        await loadFleet();
        return;
      }
      if (act === "bonus") {
        const amountRaw = window.prompt("Bonus / fuel advance amount (KES):", "500");
        if (amountRaw == null) return;
        const amountKes = Number(String(amountRaw).replace(/[^\d.]/g, ""));
        if (!amountKes || amountKes < 1) {
          setStatus("Enter a valid KES amount.", true);
          return;
        }
        const reason = window.prompt("Reason:", "Fuel advance / ops bonus") || "admin_bonus";
        const data = await postJson(`/riders/${encodeURIComponent(id)}/bonus`, {
          amountKes,
          reason,
        });
        setStatus(data.message || `Bonus KES ${amountKes} queued`);
        await loadFleet();
        return;
      }
    } catch (err) {
      setStatus(err.message || "Action failed", true);
    }
  }

  function bind() {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved && el("admin-token")) el("admin-token").value = saved;

    el("fleet-refresh")?.addEventListener("click", () => loadFleet());
    el("fleet-search")?.addEventListener("click", () => {
      queryText = el("fleet-q")?.value || "";
      statusFilter = el("fleet-filter")?.value || "all";
      render();
    });
    el("fleet-q")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        queryText = el("fleet-q")?.value || "";
        statusFilter = el("fleet-filter")?.value || "all";
        render();
      }
    });
    el("fleet-filter")?.addEventListener("change", () => {
      statusFilter = el("fleet-filter")?.value || "all";
      render();
    });

    el("fleet-tbody")?.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.classList.contains("js-actions-toggle")) {
        const id = t.dataset.id;
        const menu = document.querySelector(`.actions-menu[data-menu-for="${CSS.escape(id)}"]`);
        const wasOpen = menu?.classList.contains("is-open");
        closeAllMenus();
        if (menu && !wasOpen) menu.classList.add("is-open");
        return;
      }
      if (t.classList.contains("js-act")) {
        void runAction(t.dataset.act, t.dataset.id);
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".js-actions-toggle") && !e.target.closest(".actions-menu")) {
        closeAllMenus();
      }
    });

    el("fleet-add-open")?.addEventListener("click", openAdd);
    el("add-cancel")?.addEventListener("click", closeAdd);
    el("add-modal")?.addEventListener("click", (e) => {
      if (e.target === el("add-modal")) closeAdd();
    });
    el("add-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await postJson("/riders", {
          fullName: el("add-name")?.value?.trim(),
          phone: el("add-phone")?.value?.trim(),
          motorbikePlate: el("add-plate")?.value?.trim(),
          operatingTown: el("add-town")?.value || "NAIROBI",
          stageLocation: el("add-stage")?.value?.trim() || "",
          verificationStatus: "PENDING",
        });
        setStatus("Rider added (PENDING verify)");
        closeAdd();
        el("add-form")?.reset();
        await loadFleet();
      } catch (err) {
        setStatus(err.message || "Could not add rider", true);
      }
    });

    el("map-close")?.addEventListener("click", closeMap);
    el("map-modal")?.addEventListener("click", (e) => {
      if (e.target === el("map-modal")) closeMap();
    });
  }

  bind();
  if (token()) void loadFleet();
})();
