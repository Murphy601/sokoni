/**
 * Path B CheckoutDeliverySelector — hybrid County dropdowns vs Map Pin.
 * Hooks into checkout.js via window.SokoniCheckoutDelivery.
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const CHECKOUT_API = `${API_BASE}/api/checkout`;
  const MARKER = "data-sokoni-delivery-selector";

  let counties = [];
  let map = null;
  let marker = null;
  let pin = null;
  let leafletReady = null;
  let lastCalc = null;

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
      s.onerror = () => reject(new Error("Leaflet failed to load"));
      document.head.appendChild(s);
    });
    return leafletReady;
  }

  function ensureUi() {
    const host = document.getElementById("checkout-delivery-selector");
    if (!host || host.getAttribute(MARKER)) return host;
    host.setAttribute(MARKER, "1");
    host.innerHTML = `
      <div class="depop-card p-5 space-y-4 mb-8">
        <div>
          <p class="depop-label mb-1">Delivery location</p>
          <h2 class="text-lg font-bold text-white">Where should it go?</h2>
          <p class="text-xs text-zinc-500 mt-1">County shipping for countrywide orders. Map pin for local express when the seller supports it. Paid with M-Pesa STK — item + delivery in one prompt.</p>
        </div>
        <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Delivery mode">
          <label class="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-full border border-zinc-700 text-sm text-zinc-200 cursor-pointer">
            <input type="radio" name="cds-mode" value="COUNTY_DROPDOWN" checked class="accent-[#25D366]" /> County shipping
          </label>
          <label class="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-full border border-zinc-700 text-sm text-zinc-200 cursor-pointer">
            <input type="radio" name="cds-mode" value="MAP_PIN" class="accent-[#25D366]" /> Local map pin
          </label>
        </div>

        <div id="cds-county-panel" class="space-y-3">
          <label class="block text-sm text-zinc-300">County
            <select id="cds-county" class="sell-form-input mt-1 w-full"><option value="">Choose county…</option></select>
          </label>
          <label class="block text-sm text-zinc-300">Town / area
            <select id="cds-town" class="sell-form-input mt-1 w-full" disabled><option value="">Choose town…</option></select>
          </label>
          <div class="flex flex-wrap gap-3 text-sm text-zinc-300">
            <label class="inline-flex items-center gap-2 min-h-[44px] cursor-pointer">
              <input type="radio" name="cds-fulfill" value="doorstep" checked class="accent-[#FF2300]" /> Doorstep / landmark
            </label>
            <label class="inline-flex items-center gap-2 min-h-[44px] cursor-pointer">
              <input type="radio" name="cds-fulfill" value="pickup" class="accent-[#FF2300]" /> Pickup station
            </label>
          </div>
        </div>

        <div id="cds-map-panel" class="space-y-3 hidden">
          <div id="cds-map" class="w-full h-64 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 z-0"></div>
          <p class="text-xs text-zinc-500">Tap the map to drop your pin. Add a landmark note so the rider can find you.</p>
        </div>

        <label class="block text-sm text-zinc-300">Landmark / note
          <input id="cds-note" type="text" maxlength="280" class="sell-form-input mt-1" placeholder="Near Quickmart, opposite Stage 46" />
        </label>
        <div id="cds-summary" class="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 space-y-1 text-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Delivery estimate</p>
          <p id="cds-fee" class="text-zinc-300">Choose county or drop a pin to calculate delivery.</p>
          <ul id="cds-vendor-breakdown" class="hidden space-y-1 text-xs text-zinc-400 pt-1" aria-label="Shipping by seller"></ul>
          <p id="cds-grand" class="text-white font-semibold hidden"></p>
        </div>
        <button type="button" id="cds-apply" class="depop-btn-ghost text-sm font-semibold min-h-[44px]">Apply location to order</button>
        <p id="cds-status" class="text-xs text-zinc-500" role="status"></p>
      </div>`;
    return host;
  }

  function mode() {
    return document.querySelector('input[name="cds-mode"]:checked')?.value || "COUNTY_DROPDOWN";
  }

  function setStatus(msg, isError) {
    const n = document.getElementById("cds-status");
    if (!n) return;
    n.textContent = msg || "";
    n.classList.toggle("text-red-400", Boolean(isError));
  }

  async function loadCounties() {
    const res = await fetch(`${CHECKOUT_API}/locations/counties`);
    const data = await res.json();
    counties = data.counties || [];
    const sel = document.getElementById("cds-county");
    if (!sel) return;
    sel.innerHTML =
      `<option value="">Choose county…</option>` +
      counties.map((c) => `<option value="${c.name}">${c.name} (Tier ${c.tier})</option>`).join("");
  }

  async function loadTowns(county) {
    const sel = document.getElementById("cds-town");
    if (!sel) return;
    sel.disabled = true;
    sel.innerHTML = `<option value="">Choose town…</option>`;
    if (!county) return;
    const res = await fetch(`${CHECKOUT_API}/locations/towns?county=${encodeURIComponent(county)}`);
    const data = await res.json();
    const towns = data.towns || [];
    sel.innerHTML =
      `<option value="">Choose town…</option>` +
      towns.map((t) => `<option value="${t.name}">${t.name}</option>`).join("");
    sel.disabled = towns.length === 0;
  }

  async function initMap() {
    const L = await loadLeaflet();
    const el = document.getElementById("cds-map");
    if (!el) return;
    if (!map) {
      map = L.map(el).setView([-1.286389, 36.817223], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);
      map.on("click", (e) => {
        pin = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (marker) marker.setLatLng(e.latlng);
        else marker = L.marker(e.latlng).addTo(map);
        void previewFee();
      });
    }
    setTimeout(() => map.invalidateSize(), 80);
  }

  function locationPayload() {
    const note = document.getElementById("cds-note")?.value || "";
    const isPickup = document.querySelector('input[name="cds-fulfill"]:checked')?.value === "pickup";
    if (mode() === "MAP_PIN") {
      return {
        deliveryMethod: "MAP_PIN",
        buyerCoordinates: pin,
        landmarkNote: note,
        isPickupStation: isPickup,
        deliveryType: "other",
      };
    }
    return {
      deliveryMethod: "COUNTY_DROPDOWN",
      buyerCounty: document.getElementById("cds-county")?.value || "",
      buyerTown: document.getElementById("cds-town")?.value || "",
      landmarkNote: note,
      isPickupStation: isPickup,
      deliveryType: isPickup ? "parcel_hub" : "other",
    };
  }

  function renderVendorBreakdown(calc) {
    const list = document.getElementById("cds-vendor-breakdown");
    if (!list) return;
    const rows = Array.isArray(calc?.vendorBreakdown) ? calc.vendorBreakdown : [];
    if (rows.length < 2) {
      list.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    list.classList.remove("hidden");
    list.innerHTML = rows
      .map((v) => {
        const name = String(v.vendorId || v.shopHandle || "Seller").replace(/^@/, "");
        const fee = Math.round(Number(v.shippingFee) || 0);
        return `<li><span class="text-zinc-300">${escapeHtml(name)}</span> · shipping KES ${fee.toLocaleString()}</li>`;
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function previewFee() {
    const feeEl = document.getElementById("cds-fee");
    const grandEl = document.getElementById("cds-grand");
    const orderId = window.SokoniCheckoutDelivery?.getOrderId?.();
    const cartItems =
      window.SokoniCheckoutDelivery?.getCartItems?.() ||
      [
        {
          productId: "checkout",
          vendorId: window.SokoniCheckoutDelivery?.getVendorId?.() || "unknown",
          qty: 1,
        },
      ];
    const payload = locationPayload();
    if (
      (payload.deliveryMethod === "COUNTY_DROPDOWN" && !payload.buyerCounty) ||
      (payload.deliveryMethod === "MAP_PIN" && !payload.buyerCoordinates)
    ) {
      if (feeEl) feeEl.textContent = "Choose county or drop a pin to calculate delivery.";
      if (grandEl) {
        grandEl.classList.add("hidden");
        grandEl.textContent = "";
      }
      renderVendorBreakdown(null);
      return { orderId, lastCalc: null };
    }
    const body = {
      cartItems,
      ...payload,
    };
    try {
      const res = await fetch(`${CHECKOUT_API}/calculate-shipping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      lastCalc = await res.json();
      const fee = Math.round(Number(lastCalc.totalShippingFee) || 0);
      const vendors = lastCalc.vendorBreakdown || [];
      const place = [payload.buyerCounty, payload.buyerTown].filter(Boolean).join(" · ");
      if (feeEl) {
        feeEl.textContent =
          fee > 0
            ? `Total delivery${place ? ` (${place})` : ""}${vendors.length > 1 ? ` · ${vendors.length} sellers` : ""}: KES ${fee.toLocaleString()}`
            : "Delivery fee: KES 0 — seller arranges (no saved rates yet).";
      }
      renderVendorBreakdown(lastCalc);
      if (grandEl && vendors[0]?.methodUsed) {
        grandEl.textContent =
          vendors.length > 1
            ? "Shipping is calculated per seller and added into one M-Pesa total."
            : `Method: ${String(vendors[0].methodUsed).replace(/_/g, " ")}`;
        grandEl.classList.remove("hidden");
      } else if (grandEl) {
        grandEl.classList.add("hidden");
      }
    } catch {
      if (feeEl) feeEl.textContent = "Shipping preview unavailable.";
      renderVendorBreakdown(null);
    }
    return { orderId, lastCalc };
  }

  async function applyToOrder() {
    const orderId =
      window.SokoniCheckoutDelivery?.getOrderId?.() ||
      new URLSearchParams(location.search).get("order");
    if (!orderId) {
      setStatus("Load an order first.", true);
      return;
    }
    const payload = locationPayload();
    if (payload.deliveryMethod === "MAP_PIN" && !payload.buyerCoordinates) {
      setStatus("Drop a pin on the map first.", true);
      return;
    }
    if (payload.deliveryMethod === "COUNTY_DROPDOWN" && !payload.buyerCounty) {
      setStatus("Choose a county.", true);
      return;
    }
    try {
      const res = await fetch(`${CHECKOUT_API}/${encodeURIComponent(orderId)}/apply-shipping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not apply shipping", true);
        return;
      }
      setStatus(
        data.profilePresent
          ? `Location saved. Total now ${formatKes(data.totalKes)} (shipping KES ${data.shippingKes}).`
          : "Location saved. Total unchanged — seller has not set shipping rates yet."
      );
      if (Array.isArray(data?.calc?.vendorBreakdown) && data.calc.vendorBreakdown.length > 1) {
        renderVendorBreakdown(data.calc);
      }
      window.SokoniCheckoutDelivery?.onApplied?.(data);
    } catch (err) {
      setStatus(err.message || "Apply failed", true);
    }
  }

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function bind() {
    const host = ensureUi();
    if (!host || host.dataset.bound) return;
    host.dataset.bound = "1";
    host.querySelectorAll('input[name="cds-mode"]').forEach((r) => {
      r.addEventListener("change", () => {
        const pinMode = mode() === "MAP_PIN";
        document.getElementById("cds-county-panel")?.classList.toggle("hidden", pinMode);
        document.getElementById("cds-map-panel")?.classList.toggle("hidden", !pinMode);
        if (pinMode) void initMap();
        void previewFee();
      });
    });
    document.getElementById("cds-county")?.addEventListener("change", (e) => {
      void loadTowns(e.target.value);
      void previewFee();
    });
    document.getElementById("cds-town")?.addEventListener("change", () => void previewFee());
    host.querySelectorAll('input[name="cds-fulfill"]').forEach((r) => {
      r.addEventListener("change", () => void previewFee());
    });
    document.getElementById("cds-apply")?.addEventListener("click", () => void applyToOrder());
  }

  async function init() {
    if (!document.getElementById("checkout-delivery-selector")) return;
    bind();
    try {
      await loadCounties();
    } catch {
      setStatus("Could not load counties — free-text landmark still works below.", true);
    }
  }

  window.SokoniCheckoutDeliverySelector = {
    init,
    getLocation: locationPayload,
    getLastCalc: () => lastCalc,
    applyToOrder,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
