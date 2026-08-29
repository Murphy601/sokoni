/**
 * Admin boda rider verify desk — uses /admin/boda/* with X-Admin-Token.
 */
(function () {
  const API_BASE =
    typeof location !== "undefined" && /localhost|127\.0\.0\.1/.test(location.hostname)
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";

  const TOKEN_KEY = "sokoni-admin-token";
  const tokenInput = document.getElementById("admin-token");
  const statusEl = document.getElementById("boda-status");
  const listEl = document.getElementById("rider-list");

  if (tokenInput) {
    try {
      tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
    } catch (_) {}
    tokenInput.addEventListener("change", () => {
      try {
        localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
      } catch (_) {}
    });
  }

  function token() {
    return String(tokenInput?.value || "").trim();
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function docLinks(docs) {
    if (!docs) return "";
    const entries = [
      ["ID front", docs.nationalIdFrontUrl],
      ["ID back", docs.nationalIdBackUrl],
      ["Licence", docs.licenseUrl],
      ["Stage letter", docs.stageLetterUrl],
      ["Logbook", docs.logbookUrl],
      ["Good conduct", docs.goodConductUrl],
      ["NTSA", docs.ntsaBadgeUrl],
    ].filter(([, url]) => url);
    if (!entries.length) return `<p class="text-xs text-brand-purple/50">No docs on file</p>`;
    return `<div class="flex flex-wrap gap-2 mt-2">${entries
      .map(
        ([label, url]) =>
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-xs font-semibold text-brand-green underline">${escapeHtml(
            label
          )}</a>`
      )
      .join("")}</div>`;
  }

  async function loadRiders(status) {
    const t = token();
    if (!t) {
      setStatus("Enter admin token first.");
      return;
    }
    setStatus("Loading…");
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    try {
      const res = await fetch(`${API_BASE}/admin/boda/riders${q}`, {
        headers: { "X-Admin-Token": t },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      const riders = data.riders || [];
      setStatus(`${riders.length} rider${riders.length === 1 ? "" : "s"}`);
      if (!listEl) return;
      if (!riders.length) {
        listEl.innerHTML = `<p class="text-sm text-brand-purple/60">None found.</p>`;
        return;
      }
      listEl.innerHTML = riders
        .map((r) => {
          return `<article class="rounded-3xl border border-black/5 bg-white p-5 space-y-2" data-rider-id="${r.id}">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 class="font-bold text-lg">${escapeHtml(r.fullName)}</h2>
                <p class="text-sm text-brand-purple/70">${escapeHtml(r.phone)} · ${escapeHtml(
            r.operatingTown
          )} · ${escapeHtml(r.motorbikePlate || "—")}</p>
                <p class="text-xs mt-1"><span class="font-semibold">${escapeHtml(
                  r.verificationStatus
                )}</span>${r.isAvailable ? " · available" : " · offline"} · stage ${escapeHtml(
            r.stageLocation || "—"
          )}</p>
                ${
                  r.guarantorName
                    ? `<p class="text-xs text-brand-purple/55">Guarantor: ${escapeHtml(
                        r.guarantorName
                      )} ${escapeHtml(r.guarantorPhone || "")}</p>`
                    : ""
                }
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" data-verify="VERIFIED" class="min-h-[40px] px-3 rounded-full bg-brand-green text-brand-purple text-xs font-bold">Verify</button>
                <button type="button" data-verify="REJECTED" class="min-h-[40px] px-3 rounded-full border border-red-300 text-red-700 text-xs font-bold">Reject</button>
                <button type="button" data-verify="SUSPENDED" class="min-h-[40px] px-3 rounded-full border border-brand-purple/20 text-xs font-bold">Suspend</button>
              </div>
            </div>
            ${docLinks(r.docs)}
          </article>`;
        })
        .join("");
    } catch (err) {
      setStatus(err.message || "Load failed");
    }
  }

  async function setStatusForRider(riderId, status) {
    const t = token();
    if (!t) return setStatus("Enter admin token first.");
    let reason = "";
    if (status === "REJECTED" || status === "SUSPENDED") {
      reason = window.prompt(`Reason for ${status}?`) || "";
    }
    setStatus(`${status} #${riderId}…`);
    try {
      const res = await fetch(`${API_BASE}/admin/boda/riders/${riderId}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": t,
        },
        body: JSON.stringify({ status, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      setStatus(`Updated #${riderId} → ${data.rider?.verificationStatus || status}`);
      loadRiders(status === "VERIFIED" ? "PENDING" : undefined);
    } catch (err) {
      setStatus(err.message || "Update failed");
    }
  }

  document.getElementById("load-pending")?.addEventListener("click", () => loadRiders("PENDING"));
  document.getElementById("load-verified")?.addEventListener("click", () => loadRiders("VERIFIED"));
  document.getElementById("load-all")?.addEventListener("click", () => loadRiders(""));

  listEl?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-verify]");
    if (!btn) return;
    const card = btn.closest("[data-rider-id]");
    const id = card?.getAttribute("data-rider-id");
    if (!id) return;
    setStatusForRider(id, btn.getAttribute("data-verify"));
  });

  const auditStatusEl = document.getElementById("audit-status");
  const auditListEl = document.getElementById("audit-list");

  function setAuditStatus(msg) {
    if (auditStatusEl) auditStatusEl.textContent = msg || "";
  }

  async function loadAudit() {
    const t = token();
    if (!t) {
      setAuditStatus("Enter admin token first.");
      return;
    }
    const orderId = String(document.getElementById("audit-order")?.value || "").trim();
    setAuditStatus("Loading audit…");
    const q = orderId ? `?orderId=${encodeURIComponent(orderId)}` : "?limit=40";
    try {
      const res = await fetch(`${API_BASE}/admin/boda/otp-audit${q}`, {
        headers: { "X-Admin-Token": t },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuditStatus(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      const entries = data.entries || [];
      setAuditStatus(`${entries.length} log${entries.length === 1 ? "" : "s"}`);
      if (!auditListEl) return;
      if (!entries.length) {
        auditListEl.innerHTML = `<p class="text-sm text-brand-purple/60">No OTP submissions found.</p>`;
        return;
      }
      auditListEl.innerHTML = entries
        .map((e) => {
          const gps =
            e.riderGps != null
              ? `${e.riderGps.lat.toFixed(5)}, ${e.riderGps.lng.toFixed(5)}`
              : "—";
          const dist = e.distanceM != null ? `${Math.round(e.distanceM)} m` : "—";
          const when = e.submissionTime ? new Date(e.submissionTime).toLocaleString() : "—";
          return `<article class="rounded-2xl border border-black/5 bg-brand-cream/60 p-4 text-sm space-y-1">
            <p class="font-bold">${escapeHtml(e.orderRef)} · <span class="text-brand-purple/70">${escapeHtml(
            e.result
          )}</span></p>
            <p>${escapeHtml(e.riderLabel || "Rider —")}</p>
            <p>OTP entered: <code>${escapeHtml(e.otpEntered || "—")}</code> · match ${
            e.otpMatch ? "yes" : "no"
          }</p>
            <p>Time: ${escapeHtml(when)}</p>
            <p>GPS: ${escapeHtml(gps)} · distance ${escapeHtml(dist)} · geofence ${
            e.geofenceOk == null ? "—" : e.geofenceOk ? "ok" : "fail"
          }</p>
            <p>Escrow: ${escapeHtml(e.escrowStatus || "—")}</p>
          </article>`;
        })
        .join("");
    } catch (err) {
      setAuditStatus(err.message || "Audit load failed");
    }
  }

  document.getElementById("load-audit")?.addEventListener("click", () => loadAudit());

  const disputeStatusEl = document.getElementById("dispute-status");
  const disputeListEl = document.getElementById("dispute-list");

  function setDisputeStatus(msg) {
    if (disputeStatusEl) disputeStatusEl.textContent = msg || "";
  }

  function formatWhen(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return String(iso);
    }
  }

  async function loadDisputes() {
    const t = token();
    if (!t) {
      setDisputeStatus("Enter admin token first.");
      return;
    }
    setDisputeStatus("Loading disputes…");
    try {
      const res = await fetch(`${API_BASE}/admin/boda/disputes?limit=40`, {
        headers: { "X-Admin-Token": t },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDisputeStatus(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      const disputes = data.disputes || [];
      setDisputeStatus(
        disputes.length
          ? `${disputes.length} case${disputes.length === 1 ? "" : "s"} pending review`
          : "No active rider disputes or fee holds."
      );
      if (!disputeListEl) return;
      if (!disputes.length) {
        disputeListEl.innerHTML = `<p class="text-sm text-brand-purple/60">Queue is clear.</p>`;
        return;
      }
      disputeListEl.innerHTML = disputes
        .map((item) => {
          const gps =
            item.riderGps != null
              ? `${Number(item.riderGps.lat).toFixed(5)}, ${Number(item.riderGps.lng).toFixed(5)}`
              : "—";
          const fee = Number(item.deliveryFee || 0).toLocaleString();
          return `<article class="rounded-3xl border border-red-200 bg-brand-cream/40 p-5 space-y-4" data-dispute-id="${escapeHtml(
            item.disputeId
          )}" data-rider-id="${escapeHtml(item.riderId || "")}">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span class="inline-flex text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-800">RIDER / FEE HOLD</span>
                <h3 class="font-display font-bold text-lg mt-2">Order ${escapeHtml(item.orderId)} — ${escapeHtml(
            item.itemName || "—"
          )}</h3>
                <p class="text-xs text-brand-purple/55">Updated ${escapeHtml(formatWhen(item.createdAt))}</p>
              </div>
              <p class="text-lg font-bold">KES ${escapeHtml(fee)}</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div>
                <p class="font-semibold">Rider</p>
                <p>${escapeHtml(item.riderName || "—")}</p>
                <p class="text-brand-purple/60">${escapeHtml(item.riderPhone || "")}</p>
                <p class="text-brand-purple/60">Plate: ${escapeHtml(item.motorbikePlate || "—")}</p>
                <p class="text-xs mt-1">${escapeHtml(item.riderStatus || "")}${
            item.suspendReason ? ` · ${escapeHtml(item.suspendReason)}` : ""
          }</p>
              </div>
              <div>
                <p class="font-semibold">Buyer / drop</p>
                <p>${escapeHtml(item.buyerPhone || "—")}</p>
                <p class="text-brand-purple/60">${escapeHtml(item.deliveryAddress || "—")}</p>
                <p class="text-xs mt-1">Payout ${escapeHtml(item.payoutStatus || "—")} · fee ${escapeHtml(
            item.feeStatus || "—"
          )}</p>
              </div>
              <div>
                <p class="font-semibold">OTP / GPS</p>
                <p>OTP: <code class="font-mono font-bold">${escapeHtml(item.otpEntered || "—")}</code></p>
                <p class="text-brand-purple/60">Completed ${escapeHtml(formatWhen(item.completedAt))}</p>
                <p class="text-brand-purple/60">GPS ${escapeHtml(gps)}</p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2 border-t border-black/5 pt-4">
              <button type="button" data-resolve="REACTIVATE_RIDER"
                      class="min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-sm font-bold">
                Clear &amp; reactivate
              </button>
              <button type="button" data-resolve="PERMANENT_BAN"
                      class="min-h-[44px] px-4 rounded-full border border-red-400 text-red-700 text-sm font-bold">
                Ban &amp; forfeit fee
              </button>
            </div>
          </article>`;
        })
        .join("");
    } catch (err) {
      setDisputeStatus(err.message || "Dispute load failed");
    }
  }

  async function resolveDispute(disputeId, riderId, action) {
    const t = token();
    if (!t) return setDisputeStatus("Enter admin token first.");
    const confirmText =
      action === "REACTIVATE_RIDER"
        ? "Reactivate rider and release delivery fee?"
        : "Permanently ban rider and forfeit delivery fee? (Buyer refund via HELP follow-up.)";
    if (!window.confirm(confirmText)) return;

    let reason = "";
    if (action === "PERMANENT_BAN") {
      reason = window.prompt("Ban reason (optional)?") || "";
    }

    setDisputeStatus(`${action} on #${disputeId}…`);
    try {
      const res = await fetch(`${API_BASE}/admin/boda/disputes/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": t,
        },
        body: JSON.stringify({ disputeId, riderId: riderId || undefined, action, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDisputeStatus(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      setDisputeStatus(data.message || "Resolved.");
      loadDisputes();
    } catch (err) {
      setDisputeStatus(err.message || "Resolve failed");
    }
  }

  async function runRiderB2c() {
    const t = token();
    if (!t) return setDisputeStatus("Enter admin token first.");
    if (!window.confirm("Trigger Daraja B2C for CLEARED rider balances (≥ KES 100)?")) return;
    setDisputeStatus("Running rider B2C…");
    try {
      const res = await fetch(`${API_BASE}/admin/boda/payouts/run-b2c`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": t,
        },
        body: JSON.stringify({ minKes: 100, limit: 10 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDisputeStatus(data.message || data.reason || data.error || `HTTP ${res.status}`);
        return;
      }
      setDisputeStatus(
        data.skipped
          ? data.reason || "B2C skipped"
          : `B2C triggered ${data.triggered || 0} rider batch(es). ${data.message || ""}`.trim()
      );
    } catch (err) {
      setDisputeStatus(err.message || "B2C run failed");
    }
  }

  document.getElementById("load-disputes")?.addEventListener("click", () => loadDisputes());
  document.getElementById("run-rider-b2c")?.addEventListener("click", () => runRiderB2c());

  disputeListEl?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-resolve]");
    if (!btn) return;
    const card = btn.closest("[data-dispute-id]");
    const disputeId = card?.getAttribute("data-dispute-id");
    const riderId = card?.getAttribute("data-rider-id");
    if (!disputeId) return;
    resolveDispute(disputeId, riderId, btn.getAttribute("data-resolve"));
  });
})();
