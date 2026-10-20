(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/tracking"
      : "https://bot.sokonimall.com/api/tracking";
  const DISPUTES_API =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/disputes"
      : "https://bot.sokonimall.com/api/disputes";

  const form = document.getElementById("track-form");
  const input = document.getElementById("order-id");
  const statusEl = document.getElementById("track-status");
  const disputeEl = document.getElementById("track-dispute");
  const errorEl = document.getElementById("track-error");
  const loadingEl = document.getElementById("track-loading");

  let currentOrderId = "";
  let trackPollTimer = null;
  let riderPollTimer = null;
  let liveMap = null;
  let riderMarker = null;
  let dropMarker = null;
  let leafletReady = null;

  function loadLeaflet() {
    if (leafletReady) return leafletReady;
    leafletReady = new Promise((resolve, reject) => {
      if (window.L) return resolve(window.L);
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error("Leaflet failed"));
      document.head.appendChild(s);
    });
    return leafletReady;
  }

  function normalizeOrderId(raw) {
    return globalThis.SokoniOrderId?.normalizeOrderId(raw) || "";
  }

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderStepper(steps) {
    if (!steps?.length) return "";
    return `
      <ol class="track-stepper" aria-label="Shipment progress">
        ${steps
          .map((step) => {
            const state = step.done ? "done" : step.active ? "active" : "pending";
            return `
          <li class="track-step track-step--${state}">
            <span class="track-step-dot" aria-hidden="true"></span>
            <div class="track-step-body">
              <p class="track-step-label">${step.label}</p>
              ${step.active ? `<p class="track-step-hint">Current step</p>` : ""}
            </div>
          </li>`;
          })
          .join("")}
      </ol>`;
  }

  function renderHistory(history) {
    if (!history?.length) return "";
    const rows = history
      .slice()
      .reverse()
      .map(
        (h) =>
          `<li><span class="track-history-status">${h.label || h.status}</span>${h.hub ? ` · ${h.hub}` : ""}<time>${h.at ? new Date(h.at).toLocaleString() : ""}</time></li>`
      )
      .join("");
    return `
      <details class="track-history">
        <summary>Recent updates</summary>
        <ul>${rows}</ul>
      </details>`;
  }

  function renderDisputePanel(tracking) {
    if (!disputeEl) return;
    if (!tracking?.paid) {
      disputeEl.classList.add("hidden");
      disputeEl.innerHTML = "";
      return;
    }

    disputeEl.classList.remove("hidden");
    disputeEl.innerHTML = `
      <h2 class="text-xl font-black text-white">Something wrong?</h2>
      <p class="text-sm text-zinc-400">
        Open a dispute if the item never arrived, arrived damaged, or doesn’t match the listing.
        Escrow stays held while Sokoni reviews tracking + your note.
        Contact within <strong class="text-zinc-200">48 hours of delivery</strong> for wrong/damaged items
        (<a href="terms.html" class="text-[#FF2300] font-semibold hover:underline">Terms §7</a>).
      </p>
      <div id="buyer-auth-panel" class="depop-card !bg-black p-4 space-y-3">
        <p class="text-sm font-semibold text-white">Verify WhatsApp to open a dispute</p>
        <div class="flex flex-col sm:flex-row gap-2">
          <label class="flex-1 text-xs font-medium text-zinc-300">
            WhatsApp number
            <input id="buyer-auth-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07XXXXXXXX"
              class="mt-1 w-full min-h-[44px] rounded-2xl border border-zinc-800 bg-black px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF2300]" />
          </label>
          <label class="sm:w-36 text-xs font-medium text-zinc-300">
            Code
            <input id="buyer-auth-code" type="text" inputmode="numeric" maxlength="6" placeholder="6 digits"
              class="mt-1 w-full min-h-[44px] rounded-2xl border border-zinc-800 bg-black px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF2300]" />
          </label>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="buyer-auth-send-btn" type="button" class="depop-btn-ghost">Send code</button>
          <button id="buyer-auth-verify-btn" type="button" class="depop-btn-accent">Verify</button>
        </div>
        <p id="buyer-auth-status" class="text-xs text-zinc-400"></p>
      </div>
      <form id="dispute-form" class="space-y-3">
        <label class="block text-sm font-medium text-zinc-300">
          Reason
          <select id="dispute-reason" class="mt-1 w-full min-h-[48px] rounded-2xl border border-zinc-800 bg-black px-4 text-sm text-white">
            <option value="not_received">Not delivered</option>
            <option value="damaged">Arrived damaged</option>
            <option value="not_as_described">Not as described</option>
            <option value="wrong_item">Wrong item</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label class="block text-sm font-medium text-zinc-300">
          What happened
          <textarea id="dispute-statement" rows="3" maxlength="2000" placeholder="Short facts help — photos/tracking are attached for admin."
            class="mt-1 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm text-white placeholder:text-zinc-600"></textarea>
        </label>
        <button type="submit" id="dispute-submit" class="depop-btn-accent">
          Open dispute
        </button>
        <p id="dispute-status" class="text-sm text-zinc-400"></p>
      </form>`;

    window.SokoniBuyerAuth?.bindPanel?.({});

    document.getElementById("dispute-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const status = document.getElementById("dispute-status");
      const btn = document.getElementById("dispute-submit");
      const session = window.SokoniBuyerAuth?.readSession?.();
      if (!session?.userId) {
        if (status) status.textContent = "Verify WhatsApp above first.";
        return;
      }
      if (btn) btn.disabled = true;
      if (status) status.textContent = "Opening dispute…";
      try {
        const body = window.SokoniBuyerAuth?.authFields
          ? window.SokoniBuyerAuth.authFields({
              orderId: currentOrderId,
              buyerUserId: session.userId,
              reason: document.getElementById("dispute-reason")?.value || "other",
              statement: document.getElementById("dispute-statement")?.value || "",
            })
          : {
              orderId: currentOrderId,
              buyerUserId: session.userId,
              reason: document.getElementById("dispute-reason")?.value || "other",
              statement: document.getElementById("dispute-statement")?.value || "",
            };
        const res = await fetch(DISPUTES_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (status) status.textContent = data.message || data.error || "Could not open dispute.";
          return;
        }
        if (status) {
          status.textContent = `Dispute #${data.dispute?.id || ""} open — escrow held while Sokoni reviews.`;
          status.classList.add("text-emerald-400");
        }
      } catch {
        if (status) status.textContent = "Network error. Try again or WhatsApp Sokoni.";
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderTracking(data) {
    const t = data.tracking;
    if (!t) return;

    const journey = renderStepper(t.buyerJourneyTimeline);
    const stepper = renderStepper(t.shipmentTimeline);
    const history = renderHistory(t.history);
    currentOrderId = t.orderId || currentOrderId;

    statusEl.innerHTML = `
      <div class="track-panel space-y-5">
        <div class="track-header">
          <p class="track-kicker">Order</p>
          <p class="track-order-id">${escapeHtml(t.orderId)}</p>
          <p class="track-product">${escapeHtml(t.productName || "Sokoni order")}</p>
          ${t.totalKes != null ? `<p class="track-price">${formatKes(t.totalKes)}</p>` : ""}
          <p class="track-meta">${escapeHtml(t.paymentLine || "")}${t.fulfillment ? ` · ${escapeHtml(t.fulfillment)}` : ""}</p>
        </div>

        ${
          t.courier || t.trackingRef
            ? `<div class="track-courier">
                ${t.courier ? `<p>Courier: <strong>${escapeHtml(t.courier)}</strong></p>` : ""}
                ${t.trackingRef ? `<p>Ref: <strong>${escapeHtml(t.trackingRef)}</strong></p>` : ""}
              </div>`
            : ""
        }

        ${t.riderName ? `<p class="track-rider">Rider: ${escapeHtml(t.riderName)}${t.etaNote ? ` · ETA ${escapeHtml(t.etaNote)}` : ""}</p>` : ""}

        <div class="track-timeline-wrap">
          <p class="track-kicker">Order progress</p>
          ${
            journey ||
            stepper ||
            `<p class="text-sm">Status: ${escapeHtml(t.shipmentStatusLabel || "Pending")}</p>`
          }
        </div>

        ${
          journey && stepper
            ? `<details class="track-history">
                <summary>Logistics detail</summary>
                ${stepper}
              </details>`
            : ""
        }

        <div id="track-live-map-wrap" class="hidden space-y-2">
          <p class="track-kicker">Live map</p>
          <div id="track-live-map" class="w-full h-56 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 z-0"></div>
          <p id="track-live-map-hint" class="text-xs text-zinc-500">Shows your drop-off pin and rider when GPS is available.</p>
        </div>

        ${history}

        <p class="track-updated">Updated ${t.updatedAt ? new Date(t.updatedAt).toLocaleString() : "recently"}</p>

        ${
          !t.paid && t.orderId
            ? `<p class="pt-2"><a href="checkout.html?order=${encodeURIComponent(t.orderId)}" class="track-pay-btn">Pay order</a></p>`
            : t.paid
              ? `<p class="pt-2"><a href="checkout.html?order=${encodeURIComponent(t.orderId)}" class="track-pay-btn track-pay-btn--ghost">View receipt</a></p>`
              : ""
        }
      </div>
    `;
    statusEl.classList.remove("hidden");
    renderDisputePanel(t);
    void setupLiveMap(data);
  }

  function stopRiderPolling() {
    if (riderPollTimer) {
      window.clearInterval(riderPollTimer);
      riderPollTimer = null;
    }
  }

  async function setupLiveMap(data) {
    const t = data.tracking || {};
    const rider = data.rider || {};
    const wrap = document.getElementById("track-live-map-wrap");
    const mapEl = document.getElementById("track-live-map");
    if (!wrap || !mapEl) return;

    const hasDrop = t.buyerLat != null && t.buyerLng != null;
    const hasRider = rider.hasRider && rider.lat != null && rider.lng != null;
    if (!hasDrop && !hasRider) {
      wrap.classList.add("hidden");
      stopRiderPolling();
      return;
    }
    wrap.classList.remove("hidden");

    try {
      const L = await loadLeaflet();
      if (!liveMap) {
        liveMap = L.map(mapEl).setView(
          hasRider ? [rider.lat, rider.lng] : [t.buyerLat, t.buyerLng],
          13
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
          maxZoom: 18,
        }).addTo(liveMap);
      }
      setTimeout(() => liveMap.invalidateSize(), 60);

      if (hasDrop) {
        if (dropMarker) dropMarker.setLatLng([t.buyerLat, t.buyerLng]);
        else dropMarker = L.marker([t.buyerLat, t.buyerLng], { title: "Drop-off" }).addTo(liveMap);
      }
      if (hasRider) {
        if (riderMarker) riderMarker.setLatLng([rider.lat, rider.lng]);
        else {
          riderMarker = L.circleMarker([rider.lat, rider.lng], {
            radius: 8,
            color: "#25D366",
            fillColor: "#25D366",
            fillOpacity: 0.9,
          }).addTo(liveMap);
        }
      }

      const bounds = [];
      if (hasDrop) bounds.push([t.buyerLat, t.buyerLng]);
      if (hasRider) bounds.push([rider.lat, rider.lng]);
      if (bounds.length) liveMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });

      stopRiderPolling();
      if (!isTerminalTracking(t)) {
        riderPollTimer = window.setInterval(() => {
          if (document.hidden || !currentOrderId) return;
          void refreshRider(currentOrderId);
        }, 8000);
      }

      // Optional Socket.io when bot exposes it (fail-soft).
      try {
        if (window.io && currentOrderId) {
          const socket = window.io(
            API_BASE.replace(/\/api\/tracking$/, ""),
            { path: "/socket.io", transports: ["websocket", "polling"] }
          );
          socket.emit("order:subscribe", currentOrderId);
          socket.on("rider:location-update", (loc) => {
            if (!loc?.hasRider || !liveMap || !window.L) return;
            if (riderMarker) riderMarker.setLatLng([loc.lat, loc.lng]);
            else {
              riderMarker = window.L.circleMarker([loc.lat, loc.lng], {
                radius: 8,
                color: "#25D366",
                fillColor: "#25D366",
                fillOpacity: 0.9,
              }).addTo(liveMap);
            }
          });
        }
      } catch {
        /* poll only */
      }
    } catch {
      wrap.classList.add("hidden");
    }
  }

  async function refreshRider(orderId) {
    try {
      const res = await fetch(`${API_BASE}/${encodeURIComponent(orderId)}/rider`);
      const data = await res.json().catch(() => ({}));
      const loc = data.location;
      if (!loc?.hasRider || !liveMap || !window.L) return;
      if (riderMarker) riderMarker.setLatLng([loc.lat, loc.lng]);
      else {
        riderMarker = window.L.circleMarker([loc.lat, loc.lng], {
          radius: 8,
          color: "#25D366",
          fillColor: "#25D366",
          fillOpacity: 0.9,
        }).addTo(liveMap);
      }
    } catch {
      /* ignore */
    }
  }

  function isTerminalTracking(t) {
    if (!t) return false;
    const ship = String(t.shipmentStatus || t.shipmentStatusLabel || "").toLowerCase();
    const escrow = String(t.escrowStatus || "").toLowerCase();
    const status = String(t.status || "").toLowerCase();
    return (
      escrow === "released" ||
      escrow === "refunded" ||
      status === "delivered" ||
      status === "cancelled" ||
      ship === "delivered" ||
      ship.includes("delivered") ||
      ship.includes("complete")
    );
  }

  function stopTrackPolling() {
    if (trackPollTimer) {
      window.clearInterval(trackPollTimer);
      trackPollTimer = null;
    }
    stopRiderPolling();
  }

  function startTrackPolling(orderId) {
    stopTrackPolling();
    if (!orderId) return;
    trackPollTimer = window.setInterval(() => {
      if (document.hidden || !currentOrderId) return;
      void fetchTracking(currentOrderId, { silent: true });
    }, 30000);
  }

  async function fetchTracking(orderId, { silent = false } = {}) {
    if (!silent) {
      errorEl.classList.add("hidden");
      statusEl.classList.add("hidden");
      disputeEl?.classList.add("hidden");
      loadingEl.classList.remove("hidden");
    }

    try {
      const res = await fetch(`${API_BASE}/${encodeURIComponent(orderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error === "order_not_found" ? "Order not found. Check your SKN-#### number." : "Could not load tracking.");
      }
      renderTracking(data);
      if (isTerminalTracking(data.tracking)) stopTrackPolling();
      else startTrackPolling(orderId);
    } catch (err) {
      if (!silent) {
        errorEl.textContent = err.message || "Tracking unavailable. Try WhatsApp instead.";
        errorEl.classList.remove("hidden");
      }
    } finally {
      if (!silent) loadingEl.classList.add("hidden");
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = normalizeOrderId(input.value);
    if (!id) return;
    input.value = id;
    const url = new URL(window.location.href);
    url.searchParams.set("order", id);
    window.history.replaceState({}, "", url);
    fetchTracking(id);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !currentOrderId) return;
    void fetchTracking(currentOrderId, { silent: true });
  });

  const params = new URLSearchParams(window.location.search);
  const preset = params.get("order");
  if (preset) {
    input.value = normalizeOrderId(preset);
    fetchTracking(input.value);
  }
})();
