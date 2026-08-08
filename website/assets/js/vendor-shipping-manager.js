/**
 * Path B VendorShippingManager — countrywide rates + Leaflet zone drawer.
 * Progressive enhancement for Seller Hub logistics (no Next.js).
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const VENDOR_API = `${API_BASE}/api/vendor`;
  const MARKER = "data-sokoni-vendor-shipping";

  function auth() {
    if (typeof window.SokoniSellerAuth?.getPhone === "function") {
      return {
        phone: window.SokoniSellerAuth.getPhone(),
        sessionToken: window.SokoniSellerAuth.getSessionToken?.() || "",
      };
    }
    return {
      phone: localStorage.getItem("sokoni-seller-phone") || "",
      sessionToken:
        sessionStorage.getItem("sokoni-seller-verify-token") ||
        localStorage.getItem("sokoni-seller-verify-token") ||
        "",
    };
  }

  function qsAuth() {
    const { phone, sessionToken } = auth();
    const p = new URLSearchParams();
    if (phone) p.set("phone", phone);
    if (sessionToken) p.set("sessionToken", sessionToken);
    return p;
  }

  async function api(path, opts = {}) {
    const q = qsAuth();
    const url = `${VENDOR_API}${path}${path.includes("?") ? "&" : "?"}${q}`;
    const init = {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    };
    if (opts.body) {
      init.body = JSON.stringify({ ...opts.body, ...auth() });
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    return data;
  }

  function ensureShell() {
    const host = document.getElementById("vendor-shipping-manager");
    if (!host || host.getAttribute(MARKER)) return host;
    host.setAttribute(MARKER, "1");
    host.innerHTML = `
      <div class="sell-dash-group space-y-4">
        <div class="sell-dash-group__head">
          <p class="sell-dash-group__label">Shipping rates</p>
          <p class="sell-dash-group__hint">Countrywide tiers + optional local boda zones. Buyers pay via M-Pesa (Daraja). Leave unset to keep today’s “seller arranges delivery” flow.</p>
        </div>
        <div class="flex flex-wrap gap-2" role="tablist" aria-label="Shipping config">
          <button type="button" class="min-h-[44px] px-4 rounded-full bg-[#25D366] text-[#1B1035] text-sm font-semibold" data-ship-tab="rates">Countrywide rates</button>
          <button type="button" class="min-h-[44px] px-4 rounded-full border border-white/20 text-sm font-semibold" data-ship-tab="zones">Local boda map</button>
          <button type="button" class="min-h-[44px] px-4 rounded-full border border-white/20 text-sm font-semibold" data-ship-tab="heat">Demand heatmap</button>
        </div>
        <p id="vsm-status" class="text-xs text-zinc-500" role="status"></p>

        <section id="vsm-panel-rates" class="sell-depop-section p-5 space-y-4">
          <label class="block text-sm text-zinc-300">Pricing mode
            <select id="vsm-type" class="sell-form-input mt-1 w-full">
              <option value="FLAT_RATE">Flat local + upcountry</option>
              <option value="TIERED">4 regional tiers</option>
              <option value="LOCAL_ONLY">Local counties only</option>
              <option value="CUSTOM_ZONES">Zones + tier fallback</option>
            </select>
          </label>
          <div class="grid sm:grid-cols-2 gap-3">
            <label class="block text-sm text-zinc-300">Local rate (KES)<input id="vsm-flat-local" type="number" min="0" class="sell-form-input mt-1" /></label>
            <label class="block text-sm text-zinc-300">Upcountry rate (KES)<input id="vsm-flat-up" type="number" min="0" class="sell-form-input mt-1" /></label>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label class="block text-xs text-zinc-400">Tier 1<input id="vsm-t1" type="number" min="0" class="sell-form-input mt-1" /></label>
            <label class="block text-xs text-zinc-400">Tier 2<input id="vsm-t2" type="number" min="0" class="sell-form-input mt-1" /></label>
            <label class="block text-xs text-zinc-400">Tier 3<input id="vsm-t3" type="number" min="0" class="sell-form-input mt-1" /></label>
            <label class="block text-xs text-zinc-400">Tier 4<input id="vsm-t4" type="number" min="0" class="sell-form-input mt-1" /></label>
          </div>
          <label class="inline-flex items-center gap-2 min-h-[44px] text-sm text-zinc-300">
            <input id="vsm-free" type="checkbox" class="h-5 w-5 accent-[#25D366]" /> Free shipping (absorb fee)
          </label>
          <label class="inline-flex items-center gap-2 min-h-[44px] text-sm text-zinc-300">
            <input id="vsm-express" type="checkbox" class="h-5 w-5 accent-[#25D366]" /> Enable local express map pins
          </label>
          <button type="button" id="vsm-save-rates" class="depop-btn-accent min-h-[44px] px-5 text-sm font-semibold">Save shipping profile</button>
        </section>

        <section id="vsm-panel-zones" class="sell-depop-section p-5 space-y-3 hidden">
          <p class="text-xs text-zinc-400">Click the map to add polygon corners. Double-click / Finish to close the zone. OpenStreetMap tiles — no Google bill.</p>
          <div id="vsm-map" class="w-full h-72 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 z-0"></div>
          <div class="grid sm:grid-cols-2 gap-3">
            <label class="block text-sm text-zinc-300">Zone name<input id="vsm-zone-name" class="sell-form-input mt-1" placeholder="Westlands &amp; Kilimani" /></label>
            <label class="block text-sm text-zinc-300">Delivery fee (KES)<input id="vsm-zone-price" type="number" min="0" class="sell-form-input mt-1" value="150" /></label>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" id="vsm-zone-undo" class="depop-btn-ghost text-sm">Undo point</button>
            <button type="button" id="vsm-zone-clear" class="depop-btn-ghost text-sm">Clear draft</button>
            <button type="button" id="vsm-zone-save" class="depop-btn-accent text-sm font-semibold">Save zone</button>
          </div>
          <ul id="vsm-zone-list" class="space-y-2 text-sm text-zinc-300"></ul>
        </section>

        <section id="vsm-panel-heat" class="sell-depop-section p-5 space-y-3 hidden">
          <div class="grid grid-cols-3 gap-3 text-center">
            <div><p class="text-[11px] uppercase text-zinc-500">Mapped</p><p id="vsm-heat-total" class="text-xl font-bold text-white">0</p></div>
            <div><p class="text-[11px] uppercase text-zinc-500">Top area</p><p id="vsm-heat-top" class="text-sm font-semibold text-white">—</p></div>
            <div><p class="text-[11px] uppercase text-zinc-500">Share</p><p id="vsm-heat-share" class="text-xl font-bold text-white">0%</p></div>
          </div>
          <div id="vsm-heat-map" class="w-full h-72 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 z-0"></div>
          <p class="text-xs text-zinc-500">Shows paid order pins once buyers use map/county checkout. Empty until location data exists.</p>
        </section>
      </div>`;
    return host;
  }

  let draftPoints = [];
  let map = null;
  let draftLayer = null;
  let heatMap = null;
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
      s.onerror = () => reject(new Error("Leaflet failed to load"));
      document.head.appendChild(s);
    });
    return leafletReady;
  }

  function setStatus(msg, isError) {
    const node = document.getElementById("vsm-status");
    if (!node) return;
    node.textContent = msg || "";
    node.classList.toggle("text-red-400", Boolean(isError));
    node.classList.toggle("text-emerald-400", Boolean(msg) && !isError);
  }

  function showTab(name) {
    document.querySelectorAll("[data-ship-tab]").forEach((btn) => {
      const on = btn.getAttribute("data-ship-tab") === name;
      btn.classList.toggle("bg-[#25D366]", on);
      btn.classList.toggle("text-[#1B1035]", on);
      btn.classList.toggle("border", !on);
      btn.classList.toggle("border-white/20", !on);
    });
    document.getElementById("vsm-panel-rates")?.classList.toggle("hidden", name !== "rates");
    document.getElementById("vsm-panel-zones")?.classList.toggle("hidden", name !== "zones");
    document.getElementById("vsm-panel-heat")?.classList.toggle("hidden", name !== "heat");
    if (name === "zones") void initMap();
    if (name === "heat") void initHeat();
  }

  function fillProfile(profile) {
    if (!profile) return;
    const set = (id, v) => {
      const n = document.getElementById(id);
      if (n) n.value = v ?? "";
    };
    set("vsm-type", profile.shippingType || "FLAT_RATE");
    set("vsm-flat-local", profile.flatLocalRateKes);
    set("vsm-flat-up", profile.flatUpcountryRateKes);
    set("vsm-t1", profile.tier1RateKes);
    set("vsm-t2", profile.tier2RateKes);
    set("vsm-t3", profile.tier3RateKes);
    set("vsm-t4", profile.tier4RateKes);
    const free = document.getElementById("vsm-free");
    const expr = document.getElementById("vsm-express");
    if (free) free.checked = Boolean(profile.isFreeShippingEnabled);
    if (expr) expr.checked = Boolean(profile.localExpressEnabled);
  }

  function renderZones(zones) {
    const list = document.getElementById("vsm-zone-list");
    if (!list) return;
    if (!zones?.length) {
      list.innerHTML = `<li class="text-zinc-500">No zones yet.</li>`;
      return;
    }
    list.innerHTML = zones
      .map(
        (z) => `<li class="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 px-3 py-2">
          <span><strong class="text-white">${escapeHtml(z.zoneName)}</strong> · KES ${Math.round(z.priceKes || 0)}</span>
          <button type="button" class="text-xs text-red-400 font-semibold" data-del-zone="${escapeHtml(z.id)}">Remove</button>
        </li>`
      )
      .join("");
    list.querySelectorAll("[data-del-zone]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const data = await api(`/shipping-zones/${btn.getAttribute("data-del-zone")}`, { method: "DELETE" });
          renderZones(data.zones || []);
          setStatus("Zone removed.");
        } catch (err) {
          setStatus(err.message, true);
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function initMap() {
    const L = await loadLeaflet();
    const el = document.getElementById("vsm-map");
    if (!el) return;
    if (!map) {
      map = L.map(el).setView([-1.286389, 36.817223], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);
      draftLayer = L.layerGroup().addTo(map);
      map.on("click", (e) => {
        draftPoints.push([e.latlng.lng, e.latlng.lat]);
        redrawDraft(L);
      });
      map.on("dblclick", (e) => {
        L.DomEvent.stop(e);
        finishDraftRing();
      });
    }
    setTimeout(() => map.invalidateSize(), 50);
  }

  function redrawDraft(L) {
    draftLayer.clearLayers();
    draftPoints.forEach(([lng, lat]) => {
      L.circleMarker([lat, lng], { radius: 5, color: "#25D366" }).addTo(draftLayer);
    });
    if (draftPoints.length >= 2) {
      const latlngs = draftPoints.map(([lng, lat]) => [lat, lng]);
      L.polyline(latlngs, { color: "#FF2300", weight: 2 }).addTo(draftLayer);
    }
  }

  function finishDraftRing() {
    if (draftPoints.length < 3) {
      setStatus("Add at least 3 points for a zone.", true);
      return;
    }
    const first = draftPoints[0];
    const last = draftPoints[draftPoints.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      draftPoints.push([first[0], first[1]]);
    }
    setStatus(`Draft zone ready (${draftPoints.length - 1} corners). Save to keep.`);
  }

  async function initHeat() {
    const L = await loadLeaflet();
    const el = document.getElementById("vsm-heat-map");
    if (!el) return;
    if (!heatMap) {
      heatMap = L.map(el).setView([-1.286389, 36.817223], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(heatMap);
    }
    setTimeout(() => heatMap.invalidateSize(), 50);
    try {
      const data = await api("/analytics/locations");
      document.getElementById("vsm-heat-total").textContent = String(data.stats?.totalMapped || 0);
      document.getElementById("vsm-heat-top").textContent = data.stats?.topLocation || "—";
      document.getElementById("vsm-heat-share").textContent = `${data.stats?.topSharePct || 0}%`;
      (data.points || []).forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 7,
          color: "#25D366",
          fillColor: "#25D366",
          fillOpacity: 0.55,
        })
          .bindPopup(`${p.town || p.county || "Pin"} · ${p.orderId}`)
          .addTo(heatMap);
      });
      if (data.points?.length) {
        heatMap.fitBounds(data.points.map((p) => [p.lat, p.lng]), { padding: [24, 24] });
      }
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  async function load() {
    const host = ensureShell();
    if (!host) return;
    bind();
    const { phone, sessionToken } = auth();
    if (!phone || !sessionToken) {
      setStatus("Sign in to the Seller Hub to edit shipping rates.", true);
      return;
    }
    try {
      const data = await api("/shipping-rules");
      fillProfile(data.profile);
      renderZones(data.zones || []);
      setStatus("Shipping profile loaded.");
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  function bind() {
    const host = document.getElementById("vendor-shipping-manager");
    if (!host || host.dataset.bound) return;
    host.dataset.bound = "1";
    host.querySelectorAll("[data-ship-tab]").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.getAttribute("data-ship-tab")));
    });
    document.getElementById("vsm-save-rates")?.addEventListener("click", async () => {
      try {
        await api("/shipping-rules", {
          method: "POST",
          body: {
            shippingType: document.getElementById("vsm-type")?.value,
            flatLocalRateKes: document.getElementById("vsm-flat-local")?.value,
            flatUpcountryRateKes: document.getElementById("vsm-flat-up")?.value,
            tier1RateKes: document.getElementById("vsm-t1")?.value,
            tier2RateKes: document.getElementById("vsm-t2")?.value,
            tier3RateKes: document.getElementById("vsm-t3")?.value,
            tier4RateKes: document.getElementById("vsm-t4")?.value,
            isFreeShippingEnabled: document.getElementById("vsm-free")?.checked,
            localExpressEnabled: document.getElementById("vsm-express")?.checked,
          },
        });
        setStatus("Shipping profile saved.");
      } catch (err) {
        setStatus(err.message, true);
      }
    });
    document.getElementById("vsm-zone-undo")?.addEventListener("click", () => {
      draftPoints.pop();
      if (window.L && draftLayer) redrawDraft(window.L);
    });
    document.getElementById("vsm-zone-clear")?.addEventListener("click", () => {
      draftPoints = [];
      draftLayer?.clearLayers();
    });
    document.getElementById("vsm-zone-save")?.addEventListener("click", async () => {
      finishDraftRing();
      if (draftPoints.length < 4) return;
      try {
        const data = await api("/shipping-zones", {
          method: "POST",
          body: {
            zoneName: document.getElementById("vsm-zone-name")?.value,
            priceKes: document.getElementById("vsm-zone-price")?.value,
            boundary: { type: "Polygon", coordinates: [draftPoints.slice()] },
          },
        });
        draftPoints = [];
        draftLayer?.clearLayers();
        renderZones(data.zones || []);
        setStatus("Zone saved.");
      } catch (err) {
        setStatus(err.message, true);
      }
    });
  }

  window.SokoniVendorShippingManager = { init: load, reload: load };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.getElementById("vendor-shipping-manager")) load();
    });
  } else if (document.getElementById("vendor-shipping-manager")) {
    load();
  }
})();
