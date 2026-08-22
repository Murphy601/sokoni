/**
 * Path B VendorShippingManager — simplified for everyday Kenyan sellers.
 * 3 choices: Standard Kenya rates / Simple flat / Free shipping.
 * Map zones stay behind Advanced. API payload unchanged (TIERED / FLAT_RATE).
 *
 * Auth: uses /api/seller/onboard/* (same OTP session as ledger/orders).
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  /** Same auth surface as Seller Hub ledger / orders / withdraw. */
  const ONBOARD_API = `${API_BASE}/api/seller/onboard`;
  const MARKER = "data-sokoni-vendor-shipping";

  const DEFAULTS = {
    tier1: 200,
    tier2: 350,
    tier3: 450,
    tier4: 750,
    flatLocal: 200,
    flatUpcountry: 400,
  };

  const TIER_COPY = {
    1: {
      title: "Nairobi & Nearby",
      counties: "Nairobi, Kiambu, Machakos, Kajiado (4 counties)",
      summary: "Nairobi Metropolitan (4 counties)",
    },
    2: {
      title: "Major Cities",
      counties:
        "Mombasa, Nakuru, Kisumu, Uasin Gishu (Eldoret), Nyeri, Kilifi, Meru, Kakamega, Bungoma, Kisii, Kericho, Trans Nzoia, Laikipia (13 counties)",
      summary: "Major hubs & cities (13 counties)",
    },
    3: {
      title: "Standard Upcountry Towns",
      counties:
        "Nyandarua, Kirinyaga, Murang'a, Embu, Tharaka-Nithi, Kitui, Makueni, Narok, Bomet, Nandi, Baringo, Elgeyo-Marakwet, Vihiga, Busia, Siaya, Homa Bay, Migori, Nyamira, Kwale, Taita-Taveta (20 counties)",
      summary: "Upcountry towns (20 counties)",
    },
    4: {
      title: "Far / Remote Areas",
      counties:
        "Garissa, Wajir, Mandera, Marsabit, Isiolo, Turkana, West Pokot, Samburu, Tana River, Lamu (10 counties)",
      summary: "Remote & ASAL counties (10 counties)",
    },
  };

  function normalizePhone(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
    if (d.length === 9) d = `254${d}`;
    return d;
  }

  /**
   * Session is stored as JSON `{ phone, token, expiresAt }`.
   * Never send the raw blob. Do not drop tokens for client-side expiry —
   * the bot decides session validity (Seller Hub keeps the in-memory token).
   */
  function readStoredSellerSession() {
    try {
      const raw =
        sessionStorage.getItem("sokoni-seller-verify-token") ||
        localStorage.getItem("sokoni-seller-verify-token") ||
        "";
      if (!raw) {
        return {
          phone: normalizePhone(localStorage.getItem("sokoni-seller-phone") || ""),
          sessionToken: "",
        };
      }
      if (raw.trim().startsWith("{")) {
        const parsed = JSON.parse(raw);
        return {
          phone: normalizePhone(
            parsed.phone || localStorage.getItem("sokoni-seller-phone") || ""
          ),
          sessionToken: String(parsed.token || "").trim(),
        };
      }
      return {
        phone: normalizePhone(localStorage.getItem("sokoni-seller-phone") || ""),
        sessionToken: String(raw).trim(),
      };
    } catch {
      return {
        phone: normalizePhone(localStorage.getItem("sokoni-seller-phone") || ""),
        sessionToken: "",
      };
    }
  }

  function auth() {
    const stored = readStoredSellerSession();
    const bridgePhone = normalizePhone(window.SokoniSellerAuth?.getPhone?.() || "");
    const bridgeToken = String(window.SokoniSellerAuth?.getSessionToken?.() || "").trim();
    return {
      phone: bridgePhone || stored.phone,
      sessionToken: bridgeToken || stored.sessionToken,
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
    const creds = auth();
    if (!creds.phone || !creds.sessionToken) {
      throw new Error("Sign in with your WhatsApp code first, then save again.");
    }
    const q = qsAuth();
    const url = `${ONBOARD_API}${path}${path.includes("?") ? "&" : "?"}${q}`;
    const init = {
      method: opts.method || "GET",
      headers: { ...(opts.headers || {}) },
    };
    if (opts.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({
        ...opts.body,
        phone: creds.phone,
        sessionToken: creds.sessionToken,
      });
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          data.message || "Session expired — verify WhatsApp again in Seller Hub, then save."
        );
      }
      if (res.status === 403) {
        throw new Error(
          data.message || "Finish seller setup (shop + M-Pesa) before setting delivery fees."
        );
      }
      if (res.status === 429) {
        throw new Error("Hub is busy — wait a few seconds, then tap Logistics again to reload.");
      }
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function numVal(id, fallback) {
    const n = Math.round(Number(document.getElementById(id)?.value));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function selectedMode() {
    return document.querySelector('input[name="vsm-mode"]:checked')?.value || "STANDARD_KENYA";
  }

  function ensureShell() {
    const host = document.getElementById("vendor-shipping-manager");
    if (!host || host.getAttribute(MARKER)) return host;
    host.setAttribute(MARKER, "1");
    host.innerHTML = `
      <div class="sell-dash-group space-y-4">
        <div class="sell-dash-group__head">
          <p class="sell-dash-group__label">Delivery fees across Kenya</p>
          <p class="sell-dash-group__hint">Set once — Sokoni charges the right fee from the buyer’s county at checkout (M-Pesa STK). Most sellers pick Standard rates and save.</p>
        </div>

        <div class="flex flex-wrap gap-2" role="tablist" aria-label="Shipping sections">
          <button type="button" class="min-h-[44px] px-4 rounded-full bg-[#25D366] text-[#1B1035] text-sm font-semibold" data-ship-tab="rates">Shipping rates</button>
          <button type="button" class="min-h-[44px] px-4 rounded-full border border-white/20 text-sm font-semibold" data-ship-tab="heat">Buyer demand map</button>
        </div>
        <p id="vsm-status" class="text-xs text-zinc-500" role="status"></p>

        <section id="vsm-panel-rates" class="sell-depop-section p-5 space-y-5">
          <div class="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-sm text-zinc-300">
            Setting these rates covers <strong class="text-white">all 47 counties</strong>. Buyers are charged automatically from their delivery county — you don’t pick a region per order.
          </div>

          <details class="rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3">
            <summary class="cursor-pointer text-sm font-semibold text-white min-h-[44px] flex items-center">
              How are the 47 counties grouped? (tap to view)
            </summary>
            <ul class="mt-3 space-y-2 text-xs text-zinc-400 leading-relaxed">
              <li><strong class="text-zinc-200">Nairobi &amp; Nearby:</strong> ${escapeHtml(TIER_COPY[1].counties)}</li>
              <li><strong class="text-zinc-200">Major Cities:</strong> ${escapeHtml(TIER_COPY[2].counties)}</li>
              <li><strong class="text-zinc-200">Upcountry Towns:</strong> ${escapeHtml(TIER_COPY[3].counties)}</li>
              <li><strong class="text-zinc-200">Far / Remote:</strong> ${escapeHtml(TIER_COPY[4].counties)}</li>
            </ul>
          </details>

          <fieldset class="space-y-3" aria-label="How you charge for shipping">
            <legend class="text-sm font-semibold text-white mb-1">How do you want to charge for shipping?</legend>

            <label class="block rounded-2xl border border-zinc-700 p-4 cursor-pointer has-[:checked]:border-[#25D366] has-[:checked]:bg-emerald-950/30">
              <span class="flex gap-3 items-start">
                <input type="radio" name="vsm-mode" value="STANDARD_KENYA" checked class="mt-1 h-5 w-5 accent-[#25D366]" />
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-white">Standard Sokoni rates <span class="text-[#25D366] font-bold">(Recommended)</span></span>
                  <span class="block text-xs text-zinc-400 mt-1">Auto fees across Kenya. Edit any number if you need to.</span>
                  <ul class="mt-2 text-xs text-zinc-400 space-y-0.5">
                    <li>• Local / Nairobi metro: KES 200</li>
                    <li>• Major cities (Mombasa, Kisumu, Nakuru, Eldoret…): KES 350</li>
                    <li>• Other upcountry towns: KES 450</li>
                    <li>• Remote areas (Lodwar, Garissa, Mandera…): KES 750</li>
                  </ul>
                </span>
              </span>
            </label>

            <label class="block rounded-2xl border border-zinc-700 p-4 cursor-pointer has-[:checked]:border-[#25D366] has-[:checked]:bg-emerald-950/30">
              <span class="flex gap-3 items-start">
                <input type="radio" name="vsm-mode" value="SIMPLE_FLAT" class="mt-1 h-5 w-5 accent-[#25D366]" />
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-white">Simple flat rate</span>
                  <span class="block text-xs text-zinc-400 mt-1">One price for local, one for the rest of Kenya.</span>
                </span>
              </span>
            </label>

            <label class="block rounded-2xl border border-zinc-700 p-4 cursor-pointer has-[:checked]:border-[#25D366] has-[:checked]:bg-emerald-950/30">
              <span class="flex gap-3 items-start">
                <input type="radio" name="vsm-mode" value="FREE_SHIPPING" class="mt-1 h-5 w-5 accent-[#25D366]" />
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-white">Free shipping</span>
                  <span class="block text-xs text-zinc-400 mt-1">You cover delivery — buyers pay KES 0 shipping at checkout.</span>
                </span>
              </span>
            </label>
          </fieldset>

          <div id="vsm-fields-standard" class="space-y-4">
            <div class="grid sm:grid-cols-2 gap-4">
              ${[1, 2, 3, 4]
                .map(
                  (t) => `
                <label class="block rounded-2xl border border-zinc-800 p-3 space-y-1">
                  <span class="block text-sm font-semibold text-white">${escapeHtml(TIER_COPY[t].title)}</span>
                  <span class="flex items-center gap-2">
                    <span class="text-xs text-zinc-500">KES</span>
                    <input id="vsm-t${t}" type="number" min="0" value="${DEFAULTS["tier" + t]}" class="sell-form-input flex-1" />
                  </span>
                  <span class="block text-xs text-zinc-500 leading-snug">Includes: ${escapeHtml(TIER_COPY[t].counties)}</span>
                </label>`
                )
                .join("")}
            </div>
          </div>

          <div id="vsm-fields-flat" class="grid sm:grid-cols-2 gap-4 hidden">
            <label class="block rounded-2xl border border-zinc-800 p-3 space-y-1">
              <span class="block text-sm font-semibold text-white">Local delivery (Nairobi &amp; nearby)</span>
              <span class="flex items-center gap-2">
                <span class="text-xs text-zinc-500">KES</span>
                <input id="vsm-flat-local" type="number" min="0" value="${DEFAULTS.flatLocal}" class="sell-form-input flex-1" />
              </span>
            </label>
            <label class="block rounded-2xl border border-zinc-800 p-3 space-y-1">
              <span class="block text-sm font-semibold text-white">Rest of Kenya</span>
              <span class="flex items-center gap-2">
                <span class="text-xs text-zinc-500">KES</span>
                <input id="vsm-flat-up" type="number" min="0" value="${DEFAULTS.flatUpcountry}" class="sell-form-input flex-1" />
              </span>
            </label>
          </div>

          <p id="vsm-fields-free" class="hidden text-sm text-emerald-300/90 rounded-2xl border border-emerald-800/50 bg-emerald-950/20 px-4 py-3">
            Free shipping is on — buyers won’t be charged a delivery fee. Make sure your product price covers courier cost.
          </p>

          <div id="vsm-ship-payout" class="rounded-2xl border border-zinc-700 bg-black/50 px-4 py-4 space-y-2">
            <p class="text-sm font-semibold text-white">Your shipping payout breakdown</p>
            <p class="text-xs text-zinc-400 leading-relaxed">
              Buyers pay the exact rate you set. Sokoni keeps a <strong class="text-zinc-200">5% service fee</strong> on shipping
              (logistics processing). You receive <strong class="text-zinc-200">95%</strong> of that shipping fee with your item payout after delivery.
            </p>
            <dl id="vsm-ship-payout-lines" class="text-sm text-zinc-300 space-y-1.5 pt-1"></dl>
          </div>

          <div id="vsm-coverage" class="rounded-2xl border border-zinc-700 bg-black/50 px-4 py-4 space-y-2">
            <p class="text-sm font-semibold text-white">Nationwide coverage summary</p>
            <p class="text-xs text-zinc-500">Buyer pays your rate · you receive 95% of shipping.</p>
            <ul id="vsm-coverage-list" class="space-y-1.5 text-sm text-zinc-300"></ul>
          </div>

          <div class="rounded-2xl border border-zinc-800 p-4 space-y-3">
            <label class="inline-flex items-center gap-3 min-h-[44px] text-sm text-zinc-200 cursor-pointer">
              <input id="vsm-advanced-map" type="checkbox" class="h-5 w-5 accent-[#25D366]" />
              <span><strong class="text-white">Advanced (optional):</strong> Draw custom express boda zones on a map</span>
            </label>
            <div id="vsm-advanced-map-panel" class="hidden space-y-3 pt-2 border-t border-zinc-800">
              <p class="text-xs text-zinc-400 rounded-xl border border-amber-900/40 bg-amber-950/20 px-3 py-2">
                Optional: draw neighbourhoods for same-day boda pricing. If you skip this, standard local rates above still apply.
              </p>
              <div id="vsm-map" class="w-full h-72 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 z-0"></div>
              <div class="grid sm:grid-cols-2 gap-3">
                <label class="block text-sm text-zinc-300">Zone name<input id="vsm-zone-name" class="sell-form-input mt-1" placeholder="e.g. CBD &amp; Industrial Area" /></label>
                <label class="block text-sm text-zinc-300">Express fee (KES)<input id="vsm-zone-price" type="number" min="0" class="sell-form-input mt-1" value="150" /></label>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" id="vsm-zone-undo" class="depop-btn-ghost text-sm">Undo point</button>
                <button type="button" id="vsm-zone-clear" class="depop-btn-ghost text-sm">Clear draft</button>
                <button type="button" id="vsm-zone-save" class="depop-btn-accent text-sm font-semibold">Save map zone</button>
              </div>
              <ul id="vsm-zone-list" class="space-y-2 text-sm text-zinc-300"></ul>
            </div>
          </div>

          <button type="button" id="vsm-save-rates" class="depop-btn-accent min-h-[48px] px-6 text-sm font-bold w-full sm:w-auto" data-vsm-save-state="dirty">
            Save all-Kenya shipping rates
          </button>
        </section>

        <section id="vsm-panel-heat" class="sell-depop-section p-5 space-y-3 hidden">
          <p class="text-sm text-zinc-400">Where paid orders with a pin or county have come from. Empty until buyers start checking out with location.</p>
          <div class="grid grid-cols-3 gap-3 text-center">
            <div><p class="text-[11px] uppercase text-zinc-500">Mapped</p><p id="vsm-heat-total" class="text-xl font-bold text-white">0</p></div>
            <div><p class="text-[11px] uppercase text-zinc-500">Top area</p><p id="vsm-heat-top" class="text-sm font-semibold text-white">—</p></div>
            <div><p class="text-[11px] uppercase text-zinc-500">Share</p><p id="vsm-heat-share" class="text-xl font-bold text-white">0%</p></div>
          </div>
          <div id="vsm-heat-map" class="w-full h-72 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 z-0"></div>
        </section>
      </div>`;
    return host;
  }

  let draftPoints = [];
  let map = null;
  let draftLayer = null;
  let heatMap = null;
  let leafletReady = null;
  let savingRates = false;
  /** JSON snapshot of last loaded/saved payload — button shows Saved until edited. */
  let baselinePayloadJson = "";
  let profileConfigured = false;

  function payloadFingerprint(payload) {
    try {
      return JSON.stringify(payload);
    } catch {
      return "";
    }
  }

  function isDirty() {
    if (!baselinePayloadJson) return true;
    return payloadFingerprint(buildSavePayload()) !== baselinePayloadJson;
  }

  function syncSaveButton() {
    const btn = document.getElementById("vsm-save-rates");
    if (!btn) return;
    const dirty = isDirty();
    if (!dirty && profileConfigured) {
      btn.textContent = "Saved";
      btn.disabled = true;
      btn.dataset.vsmSaveState = "saved";
      btn.classList.remove("depop-btn-accent");
      btn.classList.add("depop-btn-ghost", "opacity-90");
      btn.setAttribute("aria-label", "Shipping rates saved");
    } else {
      btn.textContent = "Save all-Kenya shipping rates";
      btn.disabled = false;
      btn.dataset.vsmSaveState = "dirty";
      btn.classList.add("depop-btn-accent");
      btn.classList.remove("depop-btn-ghost", "opacity-90");
      btn.setAttribute("aria-label", "Save all-Kenya shipping rates");
    }
  }

  function markBaselineFromProfile(profile) {
    profileConfigured = Boolean(
      profile &&
        (profile.sellerConfigured === true ||
          (profile.updatedAt && profile.createdAt && profile.updatedAt !== profile.createdAt))
    );
    fillProfile(profile);
    baselinePayloadJson = payloadFingerprint(buildSavePayload());
    syncSaveButton();
  }

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
    document.getElementById("vsm-panel-heat")?.classList.toggle("hidden", name !== "heat");
    if (name === "heat") void initHeat();
  }

  function syncModeUi() {
    const mode = selectedMode();
    document.getElementById("vsm-fields-standard")?.classList.toggle("hidden", mode !== "STANDARD_KENYA");
    document.getElementById("vsm-fields-flat")?.classList.toggle("hidden", mode !== "SIMPLE_FLAT");
    document.getElementById("vsm-fields-free")?.classList.toggle("hidden", mode !== "FREE_SHIPPING");
    updateCoverageSummary();
    syncSaveButton();
  }

  const SHIPPING_COMMISSION_RATE = 0.05;

  function netShipPayout(buyerRate) {
    const rate = Math.max(0, Math.round(Number(buyerRate) || 0));
    const fee = Math.round(rate * SHIPPING_COMMISSION_RATE);
    return { rate, fee, net: Math.max(0, rate - fee) };
  }

  function shipLine(label, buyerRate) {
    const { rate, net } = netShipPayout(buyerRate);
    return `✓ ${label}: buyer pays <strong class="text-white">KES ${rate.toLocaleString()}</strong> · you receive <strong class="text-emerald-300">KES ${net.toLocaleString()}</strong>`;
  }

  function updateShipPayoutBreakdown() {
    const box = document.getElementById("vsm-ship-payout");
    const lines = document.getElementById("vsm-ship-payout-lines");
    if (!box || !lines) return;
    const mode = selectedMode();
    if (mode === "FREE_SHIPPING") {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    const sample =
      mode === "SIMPLE_FLAT"
        ? numVal("vsm-flat-local", DEFAULTS.flatLocal)
        : numVal("vsm-t1", DEFAULTS.tier1);
    const { rate, fee, net } = netShipPayout(sample);
    lines.innerHTML = `
      <div class="flex justify-between gap-3"><dt>Selected sample rate</dt><dd class="text-white font-medium">KES ${rate.toLocaleString()}</dd></div>
      <div class="flex justify-between gap-3"><dt>Buyer pays at checkout</dt><dd class="text-white font-medium">KES ${rate.toLocaleString()}</dd></div>
      <div class="flex justify-between gap-3"><dt>Sokoni platform fee (5%)</dt><dd class="text-zinc-400">− KES ${fee.toLocaleString()}</dd></div>
      <div class="flex justify-between gap-3 border-t border-zinc-800 pt-2"><dt class="font-semibold text-white">Net shipping payout to you</dt><dd class="font-semibold text-emerald-300">KES ${net.toLocaleString()}</dd></div>`;
  }

  function updateCoverageSummary() {
    const list = document.getElementById("vsm-coverage-list");
    if (!list) return;
    updateShipPayoutBreakdown();
    const mode = selectedMode();
    if (mode === "FREE_SHIPPING") {
      list.innerHTML = `<li class="text-emerald-300">✓ Free shipping nationwide — buyers pay KES 0 delivery</li>`;
      return;
    }
    if (mode === "SIMPLE_FLAT") {
      const local = numVal("vsm-flat-local", DEFAULTS.flatLocal);
      const rest = numVal("vsm-flat-up", DEFAULTS.flatUpcountry);
      list.innerHTML = `
        <li>${shipLine("Local / Nairobi &amp; nearby", local)}</li>
        <li>${shipLine("Rest of Kenya", rest)}</li>`;
      return;
    }
    const t1 = numVal("vsm-t1", DEFAULTS.tier1);
    const t2 = numVal("vsm-t2", DEFAULTS.tier2);
    const t3 = numVal("vsm-t3", DEFAULTS.tier3);
    const t4 = numVal("vsm-t4", DEFAULTS.tier4);
    list.innerHTML = `
      <li>${shipLine(escapeHtml(TIER_COPY[1].summary), t1)}</li>
      <li>${shipLine(escapeHtml(TIER_COPY[2].summary), t2)}</li>
      <li>${shipLine(escapeHtml(TIER_COPY[3].summary), t3)}</li>
      <li>${shipLine(escapeHtml(TIER_COPY[4].summary), t4)}</li>`;
  }

  function setMode(mode) {
    const radio = document.querySelector(`input[name="vsm-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    syncModeUi();
  }

  function fillProfile(profile) {
    if (!profile) {
      setMode("STANDARD_KENYA");
      return;
    }
    const set = (id, v, fallback) => {
      const n = document.getElementById(id);
      if (!n) return;
      const num = v == null || v === "" ? fallback : Math.round(Number(v));
      n.value = Number.isFinite(num) ? num : fallback;
    };
    set("vsm-flat-local", profile.flatLocalRateKes, DEFAULTS.flatLocal);
    set("vsm-flat-up", profile.flatUpcountryRateKes, DEFAULTS.flatUpcountry);
    set("vsm-t1", profile.tier1RateKes, DEFAULTS.tier1);
    set("vsm-t2", profile.tier2RateKes, DEFAULTS.tier2);
    set("vsm-t3", profile.tier3RateKes, DEFAULTS.tier3);
    set("vsm-t4", profile.tier4RateKes, DEFAULTS.tier4);

    if (profile.isFreeShippingEnabled) setMode("FREE_SHIPPING");
    else if (profile.shippingType === "FLAT_RATE") setMode("SIMPLE_FLAT");
    else setMode("STANDARD_KENYA");

    const adv = document.getElementById("vsm-advanced-map");
    if (adv && profile.localExpressEnabled) {
      adv.checked = true;
      toggleAdvancedMap(true);
    }
  }

  function buildSavePayload() {
    const mode = selectedMode();
    if (mode === "FREE_SHIPPING") {
      return {
        shippingType: "TIERED",
        isFreeShippingEnabled: true,
        localExpressEnabled: Boolean(document.getElementById("vsm-advanced-map")?.checked),
        tier1RateKes: numVal("vsm-t1", DEFAULTS.tier1),
        tier2RateKes: numVal("vsm-t2", DEFAULTS.tier2),
        tier3RateKes: numVal("vsm-t3", DEFAULTS.tier3),
        tier4RateKes: numVal("vsm-t4", DEFAULTS.tier4),
        flatLocalRateKes: numVal("vsm-flat-local", DEFAULTS.flatLocal),
        flatUpcountryRateKes: numVal("vsm-flat-up", DEFAULTS.flatUpcountry),
        supportedTiers: [1, 2, 3, 4],
      };
    }
    if (mode === "SIMPLE_FLAT") {
      return {
        shippingType: "FLAT_RATE",
        isFreeShippingEnabled: false,
        localExpressEnabled: Boolean(document.getElementById("vsm-advanced-map")?.checked),
        flatLocalRateKes: numVal("vsm-flat-local", DEFAULTS.flatLocal),
        flatUpcountryRateKes: numVal("vsm-flat-up", DEFAULTS.flatUpcountry),
        tier1RateKes: numVal("vsm-flat-local", DEFAULTS.flatLocal),
        tier2RateKes: numVal("vsm-flat-up", DEFAULTS.flatUpcountry),
        tier3RateKes: numVal("vsm-flat-up", DEFAULTS.flatUpcountry),
        tier4RateKes: numVal("vsm-flat-up", DEFAULTS.flatUpcountry),
        supportedTiers: [1, 2, 3, 4],
      };
    }
    return {
      shippingType: "TIERED",
      isFreeShippingEnabled: false,
      localExpressEnabled: Boolean(document.getElementById("vsm-advanced-map")?.checked),
      tier1RateKes: numVal("vsm-t1", DEFAULTS.tier1),
      tier2RateKes: numVal("vsm-t2", DEFAULTS.tier2),
      tier3RateKes: numVal("vsm-t3", DEFAULTS.tier3),
      tier4RateKes: numVal("vsm-t4", DEFAULTS.tier4),
      flatLocalRateKes: numVal("vsm-t1", DEFAULTS.tier1),
      flatUpcountryRateKes: numVal("vsm-t3", DEFAULTS.tier3),
      supportedTiers: [1, 2, 3, 4],
    };
  }

  function renderZones(zones) {
    const list = document.getElementById("vsm-zone-list");
    if (!list) return;
    if (!zones?.length) {
      list.innerHTML = `<li class="text-zinc-500">No custom map zones yet.</li>`;
      return;
    }
    list.innerHTML = zones
      .map(
        (z) => `<li class="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 px-3 py-2">
          <span><strong class="text-white">${escapeHtml(z.zoneName)}</strong> · KES ${Math.round(z.priceKes || 0)}</span>
          <button type="button" class="text-xs text-red-400 font-semibold min-h-[44px] px-2" data-del-zone="${escapeHtml(z.id)}">Remove</button>
        </li>`
      )
      .join("");
    list.querySelectorAll("[data-del-zone]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const data = await api(`/shipping-zones/${btn.getAttribute("data-del-zone")}`, {
            method: "DELETE",
          });
          renderZones(data.zones || []);
          setStatus("Map zone removed.");
        } catch (err) {
          setStatus(err.message, true);
        }
      });
    });
  }

  function toggleAdvancedMap(on) {
    const panel = document.getElementById("vsm-advanced-map-panel");
    panel?.classList.toggle("hidden", !on);
    if (on) void initMap();
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
    setStatus(`Draft zone ready (${draftPoints.length - 1} corners). Tap Save map zone.`);
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
      const data = await api("/shipping-analytics/locations");
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
        heatMap.fitBounds(
          data.points.map((p) => [p.lat, p.lng]),
          { padding: [24, 24] }
        );
      }
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  async function saveRates() {
    if (savingRates) return;
    if (!isDirty() && profileConfigured) {
      setStatus("Already saved.");
      syncSaveButton();
      return;
    }
    savingRates = true;
    const btn = document.getElementById("vsm-save-rates");
    if (btn) btn.disabled = true;
    setStatus("Saving…");
    try {
      const payload = buildSavePayload();
      const data = await api("/shipping-rules", {
        method: "POST",
        body: payload,
      });
      if (!data?.success || !data?.profile) {
        throw new Error(data?.message || "Save did not confirm — try again.");
      }
      markBaselineFromProfile(data.profile);
      updateCoverageSummary();
      setStatus("Saved. All 47 counties use these rates at checkout.");
    } catch (err) {
      setStatus(err.message || "Could not save — try again.", true);
      syncSaveButton();
    } finally {
      savingRates = false;
      syncSaveButton();
    }
  }

  async function load() {
    const host = ensureShell();
    if (!host) return;
    bind();
    syncModeUi();
    const { phone, sessionToken } = auth();
    if (!phone || !sessionToken) {
      setStatus("Sign in to the Seller Hub to set delivery fees.", true);
      return;
    }
    try {
      const data = await api("/shipping-rules");
      markBaselineFromProfile(data.profile);
      renderZones(data.zones || []);
      if (profileConfigured) {
        setStatus("Saved — edit any price to update.");
      } else {
        setStatus("Choose your rates, then save to use them at checkout.");
      }
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

    host.querySelectorAll('input[name="vsm-mode"]').forEach((r) => {
      r.addEventListener("change", () => {
        syncModeUi();
        syncSaveButton();
      });
    });

    ["vsm-t1", "vsm-t2", "vsm-t3", "vsm-t4", "vsm-flat-local", "vsm-flat-up"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", () => {
        updateCoverageSummary();
        syncSaveButton();
      });
    });

    document.getElementById("vsm-advanced-map")?.addEventListener("change", (e) => {
      toggleAdvancedMap(Boolean(e.target.checked));
      syncSaveButton();
    });

    document.getElementById("vsm-save-rates")?.addEventListener("click", () => {
      void saveRates();
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
        setStatus("Map zone saved.");
      } catch (err) {
        setStatus(err.message, true);
      }
    });
  }

  // Document-level save — survives re-renders / missed bind races.
  if (!window.__sokoniVsmSaveBound) {
    window.__sokoniVsmSaveBound = true;
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.id === "vsm-save-rates" || t.closest?.("#vsm-save-rates")) {
        e.preventDefault();
        void saveRates();
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
