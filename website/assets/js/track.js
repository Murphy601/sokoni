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

  function stepIcon(step) {
    if (step.done) return "✅";
    if (step.active) return "🔵";
    return "⚪";
  }

  function renderTracking(data) {
    const t = data.tracking;
    if (!t) return;

    const timeline = (t.shipmentTimeline || [])
      .map((s) => `<p class="${s.active ? "font-bold text-brand-green" : ""}">${stepIcon(s)} ${s.label}</p>`)
      .join("");

    statusEl.innerHTML = `
      <div class="space-y-4">
        <div>
          <p class="text-xs uppercase tracking-wide text-brand-purple/50 mb-1">Order</p>
          <p class="text-2xl font-bold">${t.orderId}</p>
        </div>
        <div>
          <p class="font-semibold">${t.productName || "Sokoni order"}</p>
          <p class="text-sm text-brand-purple/60 mt-1">${t.paymentLine || ""} · ${t.fulfillment || ""}</p>
        </div>
        ${
          t.courier
            ? `<p class="text-sm">Courier: <strong>${t.courier}</strong>${t.trackingRef ? ` · Ref <strong>${t.trackingRef}</strong>` : ""}</p>`
            : ""
        }
        ${t.riderName ? `<p class="text-sm">Rider: ${t.riderName}${t.etaNote ? ` · ETA ${t.etaNote}` : ""}</p>` : ""}
        <div class="pt-3 border-t border-black/5 dark:border-white/10 space-y-1 text-sm">
          <p class="text-xs uppercase tracking-wide text-brand-purple/50 mb-2">Shipment timeline</p>
          ${timeline || `<p>Status: ${t.shipmentStatusLabel || "Pending"}</p>`}
        </div>
        <p class="text-xs text-brand-purple/40">Updated ${t.updatedAt ? new Date(t.updatedAt).toLocaleString() : "recently"}</p>
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
