(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/tracking"
      : "https://bot.sokonimall.com/api/tracking";

  const form = document.getElementById("track-form");
  const input = document.getElementById("order-id");
  const statusEl = document.getElementById("track-status");
  const errorEl = document.getElementById("track-error");
  const loadingEl = document.getElementById("track-loading");

  function normalizeOrderId(raw) {
    const t = String(raw || "").trim().toUpperCase();
    if (!t) return "";
    if (t.startsWith("SK-")) return t;
    const digits = t.replace(/\D/g, "");
    return digits ? `SK-${digits}` : t;
  }

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
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

  function renderTracking(data) {
    const t = data.tracking;
    if (!t) return;

    const stepper = renderStepper(t.shipmentTimeline);
    const history = renderHistory(t.history);

    statusEl.innerHTML = `
      <div class="track-panel space-y-5">
        <div class="track-header">
          <p class="track-kicker">Order</p>
          <p class="track-order-id">${t.orderId}</p>
          <p class="track-product">${t.productName || "Sokoni order"}</p>
          ${t.totalKes != null ? `<p class="track-price">${formatKes(t.totalKes)}</p>` : ""}
          <p class="track-meta">${t.paymentLine || ""}${t.fulfillment ? ` · ${t.fulfillment}` : ""}</p>
        </div>

        ${
          t.courier || t.trackingRef
            ? `<div class="track-courier">
                ${t.courier ? `<p>Courier: <strong>${t.courier}</strong></p>` : ""}
                ${t.trackingRef ? `<p>Ref: <strong>${t.trackingRef}</strong></p>` : ""}
              </div>`
            : ""
        }

        ${t.riderName ? `<p class="track-rider">Rider: ${t.riderName}${t.etaNote ? ` · ETA ${t.etaNote}` : ""}</p>` : ""}

        <div class="track-timeline-wrap">
          <p class="track-kicker">Shipment</p>
          ${stepper || `<p class="text-sm">Status: ${t.shipmentStatusLabel || "Pending"}</p>`}
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
  }

  async function fetchTracking(orderId) {
    errorEl.classList.add("hidden");
    statusEl.classList.add("hidden");
    loadingEl.classList.remove("hidden");

    try {
      const res = await fetch(`${API_BASE}/${encodeURIComponent(orderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error === "order_not_found" ? "Order not found. Check your SK-#### number." : "Could not load tracking.");
      }
      renderTracking(data);
    } catch (err) {
      errorEl.textContent = err.message || "Tracking unavailable. Try WhatsApp instead.";
      errorEl.classList.remove("hidden");
    } finally {
      loadingEl.classList.add("hidden");
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

  const params = new URLSearchParams(window.location.search);
  const preset = params.get("order");
  if (preset) {
    input.value = normalizeOrderId(preset);
    fetchTracking(input.value);
  }
})();
