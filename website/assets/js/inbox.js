const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const SOCIAL_API = `${API_BASE}/api/social`;
const PRODUCTS_API = `${API_BASE}/api/products`;
const SELLER_PHONE_KEY = "sokoni-seller-phone";
const SELLER_VERIFY_TOKEN_KEY = "sokoni-seller-verify-token";

const state = {
  viewerId: null,
  peerId: null,
  peerHandle: "",
  productId: "",
  pollTimer: null,
  sellerAuthRequired: false,
  sellerSession: null,
  offers: [],
};

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

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function formatHandle(value) {
  const clean = normalizeHandle(value);
  return clean ? `@${clean}` : "";
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function formatKes(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `KES ${Math.round(amount).toLocaleString()}`;
}

function normalizePhoneInput(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

function isSellerSessionAuthError(payload) {
  const code = String(payload?.error || "")
    .trim()
    .toLowerCase();
  return code === "session_required" || code === "session_invalid" || code === "session_expired";
}

function isSellerAuthQueryFlag(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "seller";
}

function readSellerSessionFromStorage() {
  try {
    const raw =
      sessionStorage.getItem(SELLER_VERIFY_TOKEN_KEY) ||
      localStorage.getItem(SELLER_VERIFY_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = String(parsed?.token || "").trim();
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const phone = normalizePhoneInput(parsed?.phone || localStorage.getItem(SELLER_PHONE_KEY) || "");
    if (!phone) return null;
    // Keep both stores warm so other tabs / navigations stay signed in.
    persistSellerSession({ phone, sessionToken: token, expiresAt });
    return { phone, sessionToken: token };
  } catch {
    return null;
  }
}

function persistSellerSession({ phone, sessionToken, expiresAt } = {}) {
  const digits = normalizePhoneInput(phone);
  const token = String(sessionToken || "").trim();
  if (!digits || !token) return;
  const exp = Number(expiresAt);
  const payload = JSON.stringify({
    phone: digits,
    token,
    expiresAt: Number.isFinite(exp) && exp > Date.now() ? exp : Date.now() + 30 * 60 * 1000,
  });
  try {
    localStorage.setItem(SELLER_PHONE_KEY, digits);
  } catch {}
  try {
    sessionStorage.setItem(SELLER_VERIFY_TOKEN_KEY, payload);
  } catch {}
  try {
    localStorage.setItem(SELLER_VERIFY_TOKEN_KEY, payload);
  } catch {}
}

function readSellerSessionFromQuery(params) {
  const phone = normalizePhoneInput(params.get("phone") || "");
  const sessionToken = String(params.get("sessionToken") || "").trim();
  if (!phone || !sessionToken) return null;
  return { phone, sessionToken };
}

function disableChatComposer() {
  el("chat-form")?.classList.add("opacity-60");
  const input = el("chat-input");
  const sendBtn = el("chat-send-btn");
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  el("inbox-make-offer-btn")?.classList.add("hidden");
}

function setStatus(msg, isError = false) {
  const node = el("inbox-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-400", isError);
  node.classList.toggle("text-[#FF2300]", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(msg));
  node.classList.toggle("text-zinc-400", !isError && !msg);
}

function enableChatComposer() {
  el("chat-form")?.classList.remove("opacity-60");
  const input = el("chat-input");
  const sendBtn = el("chat-send-btn");
  if (input) input.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
}

function renderInboxHomeHint({ signedIn }) {
  const empty = el("chat-empty");
  const thread = el("chat-thread");
  if (thread) thread.innerHTML = "";
  if (!empty) return;
  empty.classList.remove("hidden");
  if (signedIn) {
    empty.innerHTML = `You're signed in. Pick a <strong class="text-white">shop below</strong>, or tap a recently viewed fit — then this thread unlocks.
      <span class="block mt-2"><a href="index.html#deals" class="text-[#FF2300] font-semibold hover:underline">Browse fits</a>
      · <a href="activity.html" class="text-[#FF2300] font-semibold hover:underline">Open activity</a></span>`;
  } else {
    empty.innerHTML = `Verify WhatsApp above, then pick a shop below (or a recently viewed fit) to start chatting.`;
  }
  void loadAvailableShops();
}

function shopPickerVisible(show) {
  const section = el("inbox-shops-section");
  if (!section) return;
  section.classList.toggle("hidden", !show);
}

function collectShopsFromProducts(products) {
  const map = new Map();
  for (const product of products || []) {
    const handle = normalizeHandle(product.sellerHandle || product.shopHandle || product.handle);
    const userId = parsePositiveInt(product.sellerUserId);
    if (!handle && !userId) continue;
    const key = handle || `id:${userId}`;
    const current = map.get(key) || {
      handle,
      userId,
      name: "",
      listings: 0,
      avatarUrl: "",
      sampleProductId: product.id || product.productId || "",
    };
    current.listings += 1;
    if (!current.userId && userId) current.userId = userId;
    if (!current.handle && handle) current.handle = handle;
    if (!current.name) {
      current.name = String(product.shopName || product.sellerName || product.supplierName || "").trim();
    }
    if (!current.avatarUrl) {
      current.avatarUrl = String(product.sellerAvatarUrl || product.avatarUrl || "").trim();
    }
    if (!current.sampleProductId) current.sampleProductId = product.id || product.productId || "";
    map.set(key, current);
  }
  return [...map.values()]
    .filter((s) => s.handle || s.userId)
    .sort((a, b) => b.listings - a.listings || String(a.handle || "").localeCompare(String(b.handle || "")))
    .slice(0, 20);
}

function inboxHrefForShop(shop) {
  const params = new URLSearchParams();
  if (shop.handle) params.set("handle", shop.handle);
  if (shop.userId) params.set("with", String(shop.userId));
  if (shop.sampleProductId) params.set("product", String(shop.sampleProductId));
  return `inbox.html?${params.toString()}`;
}

function renderAvailableShops(shops) {
  const list = el("inbox-shops-list");
  const empty = el("inbox-shops-empty");
  if (!list) return;
  if (!shops.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  list.innerHTML = shops
    .map((shop) => {
      const handle = formatHandle(shop.handle) || (shop.userId ? `Shop #${shop.userId}` : "Shop");
      const name = shop.name || "Sokoni seller";
      const avatar = shop.avatarUrl
        ? `<img src="${escapeHtml(shop.avatarUrl)}" alt="" loading="lazy" decoding="async" />`
        : "🏪";
      return `<a class="inbox-shop-row" role="listitem" href="${escapeHtml(inboxHrefForShop(shop))}">
        <span class="inbox-shop-avatar" aria-hidden="true">${avatar}</span>
        <span class="inbox-shop-meta">
          <strong>${escapeHtml(handle)}</strong>
          <span>${escapeHtml(name)} · ${shop.listings} live listing${shop.listings === 1 ? "" : "s"}</span>
        </span>
        <span class="inbox-shop-cta">Message</span>
      </a>`;
    })
    .join("");
}

async function loadAvailableShops() {
  const list = el("inbox-shops-list");
  if (!list) return;
  // Hide picker once a peer thread is selected.
  if (state.peerId || state.peerHandle) {
    shopPickerVisible(false);
    return;
  }
  shopPickerVisible(true);
  if (!list.dataset.loading) {
    list.dataset.loading = "1";
    list.innerHTML = `<p class="text-sm text-zinc-500 px-1">Loading shops…</p>`;
  }
  try {
    const res = await fetch(`${PRODUCTS_API}?limit=60&offset=0`);
    const data = await res.json().catch(() => ({}));
    const products = Array.isArray(data?.products) ? data.products : [];
    renderAvailableShops(collectShopsFromProducts(products));
  } catch {
    list.innerHTML = "";
    const empty = el("inbox-shops-empty");
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = "Could not load shops right now. Browse the catalog and tap Message on a listing.";
    }
  } finally {
    delete list.dataset.loading;
  }
}

function beginChatIfReady() {
  const buyerSession = !state.sellerAuthRequired ? window.SokoniBuyerAuth?.readSession?.() : null;
  if (!state.viewerId && buyerSession?.userId) {
    state.viewerId = parsePositiveInt(buyerSession.userId);
  }

  if (!state.viewerId || (!state.peerId && !state.peerHandle)) {
    const signedIn = Boolean(state.viewerId);
    if (!signedIn) {
      setStatus(
        state.peerId || state.peerHandle
          ? "Verify your WhatsApp above to open this chat."
          : "Verify WhatsApp above, then pick a shop to message.",
        true
      );
      renderInboxHomeHint({ signedIn: false });
    } else if (!state.peerId && !state.peerHandle) {
      // Signed in, opened Inbox from the tab — not an auth failure.
      setStatus("Signed in. Pick a shop below or tap a recently viewed fit to chat.");
      renderInboxHomeHint({ signedIn: true });
    } else {
      setStatus("Loading shop…");
    }
    disableChatComposer();
    return false;
  }

  if (state.viewerId && state.peerId && state.viewerId === state.peerId) {
    setStatus("You can’t message your own shop in this inbox.", true);
    disableChatComposer();
    shopPickerVisible(true);
    void loadAvailableShops();
    return false;
  }

  shopPickerVisible(false);

  if (state.sellerAuthRequired && (!state.sellerSession?.phone || !state.sellerSession?.sessionToken)) {
    setStatus(
      "Seller session missing — open Sell, verify WhatsApp, then open chat from Offers again.",
      true
    );
    disableChatComposer();
    return false;
  }

  if (!state.peerId) {
    setStatus(
      state.peerHandle
        ? `Couldn’t find shop @${normalizeHandle(state.peerHandle)}. Try opening it from the shop page.`
        : "Pick a shop to message.",
      true
    );
    disableChatComposer();
    return false;
  }

  setStatus("");
  enableChatComposer();
  wireIcebreakers();
  wireMic();
  wireBundle();
  wireBundleCards();
  wireReactions();
  wireSoundToggle();
  wireNudge();
  const empty = el("chat-empty");
  if (empty && !empty.dataset.defaultHtml) {
    empty.dataset.defaultHtml = empty.innerHTML;
  }
  if (empty?.dataset.defaultHtml) empty.innerHTML = empty.dataset.defaultHtml;
  loadThread();
  startPolling();
  return true;
}

function setPeerLabel() {
  const label = el("chat-peer-label");
  const head = el("chat-peer-head");
  const handle = formatHandle(state.peerHandle);
  const text = handle || (state.peerId ? `User #${state.peerId}` : "seller");
  if (label) label.textContent = text;
  if (head) {
    head.textContent = handle
      ? `Chat · ${handle}`
      : text === "seller"
        ? "Pick a shop to message"
        : `Chat · ${text}`;
  }
}

const ESCROW_TONE = {
  awaiting_payment: "inbox-escrow-pending",
  locked: "inbox-escrow-locked",
  dispatched: "inbox-escrow-transit",
  delivered: "inbox-escrow-transit",
  released: "inbox-escrow-locked",
  refunded: "inbox-escrow-pending",
  disputed: "inbox-escrow-alert",
};

function money(n) {
  return `KES ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
}

/**
 * A referee card: full width, centred, visibly not a person talking. The point
 * is that a buyer can tell at a glance this came from Sokoni and not from
 * whoever they are haggling with.
 */
function escrowCard(msg) {
  const p = msg.payload || {};
  const tone = ESCROW_TONE[p.state] || "inbox-escrow-pending";
  return `
    <div class="inbox-escrow-card ${tone}" data-order="${escapeHtml(p.orderRef || "")}">
      <span class="inbox-escrow-badge">SOKONI ESCROW</span>
      <p class="inbox-escrow-line">${escapeHtml(msg.content)}</p>
      <p class="inbox-escrow-meta">${escapeHtml(p.orderRef || "")} · ${formatTime(msg.createdAt)}</p>
    </div>`;
}

/** The pinned ledger, rendered above the scroll rather than inside it. */
function ledgerCard(msg) {
  const p = msg.payload || {};
  const rows = [
    ["Item", escapeHtml(p.itemName || "Item")],
    ["Price", money(p.itemKes)],
    ["Delivery", p.shippingKes > 0 ? `${money(p.shippingKes)} (buyer pays)` : "Free (seller covers)"],
    ["Total", `<strong>${money(p.totalKes)}</strong>`],
    ["Escrow", escapeHtml(String(p.state || "").replace(/_/g, " "))],
  ];
  return `
    <div class="inbox-ledger" role="status" aria-label="Agreed deal terms">
      <div class="inbox-ledger-head">
        <span class="inbox-ledger-pin">📌 Deal</span>
        <span class="inbox-ledger-ref">${escapeHtml(p.orderRef || "")}</span>
      </div>
      <dl class="inbox-ledger-rows">
        ${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
      </dl>
    </div>`;
}

function durationLabel(ms) {
  const total = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(total) || total <= 0) return "";
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Voice note. The src points at our streaming endpoint, not at a file --
 * nothing is downloaded until someone presses play, and the audio passes
 * through the server rather than being stored by it.
 */
function voiceBubble(msg) {
  const mine = Number(msg.senderUserId) === state.viewerId;
  const wrapper = mine ? "items-end" : "items-start";
  const who = mine ? "You" : formatHandle(state.peerHandle) || `User #${state.peerId}`;
  const params = authQueryParams(new URLSearchParams({ userId: String(state.viewerId) }));
  const src = `${SOCIAL_API}/chat/media/${msg.id}?${params.toString()}`;
  const len = durationLabel(msg.payload?.durationMs);
  return `
    <div class="flex flex-col ${wrapper} gap-1">
      <p class="text-[11px] text-zinc-500">${who}</p>
      <div class="inbox-voice ${mine ? "inbox-voice-mine" : ""}">
        <audio controls preload="none" src="${escapeHtml(src)}"></audio>
        ${len ? `<span class="inbox-voice-len">${len}</span>` : ""}
      </div>
      <p class="text-[10px] text-zinc-600 font-mono">${formatTime(msg.createdAt)}</p>
    </div>`;
}

function messageBubble(msg) {
  // Unknown kinds fall through to the text bubble, so a card shipped after
  // this page was loaded still shows its fallback rather than nothing.
  if (msg.kind === "escrow_status") return escrowCard(msg);
  if (msg.kind === "voice") return voiceBubble(msg);
  if (msg.kind === "bundle") return bundleCard(msg);
  if (msg.kind === "scratch_card") return scratchCard(msg);
  if (msg.kind === "nudge") return nudgeCard(msg);
  if (msg.kind === "locked_drop") return lockedDropCard(msg);
  if (msg.kind === "fit_check") return fitCheckCard(msg);
  if (msg.kind === "deal_ledger" && !msg.isPinned) return escrowCard(msg);

  const mine = Number(msg.senderUserId) === state.viewerId;
  const wrapper = mine ? "items-end" : "items-start";
  const bubble = mine ? "inbox-bubble-mine" : "inbox-bubble-theirs";
  const who = mine ? "You" : formatHandle(state.peerHandle) || `User #${state.peerId}`;

  return `
    <div class="flex flex-col ${wrapper} gap-1">
      <p class="text-[11px] text-zinc-500">${who}</p>
      <div class="max-w-[85%] px-3 py-2 text-sm leading-relaxed ${bubble}" data-msg-id="${escapeHtml(String(msg.id))}">
        ${escapeHtml(msg.content)}
      </div>
      ${reactionRow(msg)}
      <p class="text-[10px] text-zinc-600 font-mono">${formatTime(msg.createdAt)}</p>
    </div>`;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function authQueryParams(params = new URLSearchParams()) {
  if (state.sellerAuthRequired && state.sellerSession?.phone && state.sellerSession?.sessionToken) {
    params.set("phone", state.sellerSession.phone);
    params.set("sessionToken", state.sellerSession.sessionToken);
  } else if (window.SokoniBuyerAuth?.appendAuthQuery) {
    window.SokoniBuyerAuth.appendAuthQuery(params);
  }
  return params;
}

function withAuthBody(payload) {
  if (state.sellerAuthRequired && state.sellerSession?.phone && state.sellerSession?.sessionToken) {
    return {
      ...payload,
      phone: state.sellerSession.phone,
      sessionToken: state.sellerSession.sessionToken,
    };
  }
  if (window.SokoniBuyerAuth?.authFields) {
    return window.SokoniBuyerAuth.authFields(payload);
  }
  return payload;
}

/**
 * Openers for an empty thread.
 *
 * An empty chat is intimidating and most buyers just close it. These are the
 * four questions thrift buyers actually ask, in the order they ask them, so
 * the first message costs a tap instead of a sentence.
 *
 * Deliberately not clever: no personalisation, no model call. They are
 * suggestions a person could have typed, and they read that way to the seller
 * because that is exactly what gets sent.
 */
const ICEBREAKERS = [
  "Is the price negotiable?",
  "Any flaws or stains?",
  "Where do you dispatch from?",
  "Do you have more photos?",
];

/* ---- Voice recording ---------------------------------------------------- */

const MAX_RECORD_MS = 30_000;
let recorder = null;
let recorderStream = null;
let recordStartedAt = 0;
let recordTimer = null;

/** Containers worth asking for, best first. Safari refuses webm. */
function pickRecordingMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return null;
}

function setRecordingUi(on, label) {
  const btn = el("chat-mic-btn");
  if (!btn) return;
  btn.classList.toggle("is-recording", Boolean(on));
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.title = label || (on ? "Stop and send" : "Record a voice note");
}

/** Always release the microphone. A live mic indicator nobody asked for is
 *  alarming, and on a phone it keeps the radio awake. */
function releaseMic() {
  try {
    recorderStream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* already gone */
  }
  recorderStream = null;
  recorder = null;
  clearTimeout(recordTimer);
  recordTimer = null;
  setRecordingUi(false);
}

async function startRecording() {
  if (recorder) return;
  const mime = pickRecordingMime();
  if (!mime || !navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser can't record audio. Type instead.", true);
    return;
  }
  try {
    recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // Denied, or no microphone. Not an error worth a stack trace.
    setStatus("Microphone blocked. Allow it in your browser to send a voice note.", true);
    return;
  }

  const chunks = [];
  recorder = new MediaRecorder(recorderStream, { mimeType: mime });
  recordStartedAt = Date.now();
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data?.size) chunks.push(e.data);
  });
  recorder.addEventListener("stop", () => {
    const durationMs = Date.now() - recordStartedAt;
    const blob = new Blob(chunks, { type: mime });
    releaseMic();
    // Under a second is a misfire, not a message.
    if (blob.size > 0 && durationMs >= 1000) void uploadVoiceNote(blob, mime, durationMs);
    else setStatus("");
  });

  recorder.start();
  setRecordingUi(true, "Stop and send");
  setStatus("Recording… tap again to send.");
  // Hard stop, so a forgotten recording cannot run into a rejected upload.
  recordTimer = setTimeout(() => stopRecording(), MAX_RECORD_MS);
}

function stopRecording() {
  if (!recorder) return;
  try {
    recorder.stop();
  } catch {
    releaseMic();
  }
}

async function uploadVoiceNote(blob, mime, durationMs) {
  if (!state.viewerId || !state.peerId) return;
  setStatus("Sending voice note…");
  try {
    const form = new FormData();
    form.append("audio", blob, `voice.${mime.includes("mp4") ? "m4a" : "webm"}`);
    form.append("senderUserId", String(state.viewerId));
    form.append("receiverUserId", String(state.peerId));
    form.append("durationMs", String(Math.round(durationMs)));
    for (const [k, v] of Object.entries(withAuthBody({}) || {})) {
      if (v != null) form.append(k, String(v));
    }

    const res = await fetch(`${SOCIAL_API}/chat/voice`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || "Couldn't send that voice note.", true);
      return;
    }
    setStatus("");
    await loadThread();
  } catch (err) {
    setStatus("Couldn't send that voice note.", true);
    console.warn("[inbox] voice upload failed:", err);
  }
}

function wireMic() {
  const btn = el("chat-mic-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  if (!pickRecordingMime()) {
    btn.hidden = true;
    return;
  }
  btn.addEventListener("click", () => {
    if (recorder) stopRecording();
    else void startRecording();
  });
  // Leaving the page mid-recording must not leave the mic open.
  window.addEventListener("pagehide", releaseMic);
}

/* ---- Bundle builder ----------------------------------------------------- */

const MAX_BUNDLE_ITEMS = 8;
let bundlePicked = new Set();
let bundleCatalogue = [];

/** Mirrors suggestBundlePrice on the server: 10% off, rounded down to 50. */
function bundleSuggest(items) {
  const listTotal = items.reduce((s, i) => s + Math.round(Number(i.priceKes) || 0), 0);
  if (listTotal <= 0) return 0;
  return Math.max(items.length, Math.floor((listTotal * 0.9) / 50) * 50);
}

function renderBundlePicker() {
  const body = el("bundle-body");
  if (!body) return;
  if (!bundleCatalogue.length) {
    body.innerHTML = `<p class="text-sm text-zinc-500">This shop has no other items listed right now.</p>`;
    return;
  }
  const picked = bundleCatalogue.filter((p) => bundlePicked.has(p.id));
  const listTotal = picked.reduce((s, p) => s + p.priceKes, 0);
  const suggested = bundleSuggest(picked);
  const tooFew = picked.length < 2;

  body.innerHTML = `
    <div class="bundle-grid">
      ${bundleCatalogue
        .map(
          (p) => `
        <button type="button" class="bundle-tile ${bundlePicked.has(p.id) ? "is-picked" : ""}"
                data-bundle-pick="${escapeHtml(p.id)}"
                aria-pressed="${bundlePicked.has(p.id) ? "true" : "false"}">
          ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy"/>` : `<span class="bundle-noimg"></span>`}
          <span class="bundle-tile-name">${escapeHtml(p.title)}</span>
          <span class="bundle-tile-price">${formatKes(p.priceKes)}</span>
        </button>`
        )
        .join("")}
    </div>
    <div class="bundle-foot">
      <p class="bundle-sum">${picked.length} picked${picked.length ? ` &middot; list ${formatKes(listTotal)}` : ""}</p>
      <label class="bundle-price-row">
        <span>Your price</span>
        <input id="bundle-price" type="number" inputmode="numeric" min="1" max="${listTotal || 1}"
               value="${suggested || ""}" ${tooFew ? "disabled" : ""}/>
      </label>
      <button type="button" id="bundle-send" class="bundle-send" ${tooFew ? "disabled" : ""}>Send bundle offer</button>
    </div>`;
}

function openBundleDrawer() {
  const drawer = el("bundle-drawer");
  if (!drawer || !state.peerHandle) return;
  drawer.classList.remove("hidden");
  const body = el("bundle-body");
  if (body) body.innerHTML = `<p class="text-sm text-zinc-500">Loading this shop…</p>`;

  const want = normalizeHandle(state.peerHandle);
  fetch(`${PRODUCTS_API}?limit=200&offset=0`)
    .then((r) => r.json())
    .then((data) => {
      const all = Array.isArray(data?.products) ? data.products : [];
      bundleCatalogue = all
        .filter((p) => normalizeHandle(p.shopHandle || "") === want)
        .filter((p) => p.inStock !== false && !p.isSold)
        .map((p) => ({
          id: String(p.id),
          title: String(p.title || "Item"),
          priceKes: Math.round(Number(p.priceKes ?? p.priceKsh ?? p.price) || 0),
          imageUrl: p.imageUrl || p.image || null,
        }))
        .filter((p) => p.priceKes > 0)
        .slice(0, 60);
      renderBundlePicker();
    })
    .catch(() => {
      const b = el("bundle-body");
      if (b) b.innerHTML = `<p class="text-sm text-red-400">Couldn't load this shop.</p>`;
    });
}

function closeBundleDrawer() {
  el("bundle-drawer")?.classList.add("hidden");
  bundlePicked = new Set();
}

async function sendBundle() {
  const amountKes = Math.round(Number(el("bundle-price")?.value) || 0);
  const productIds = [...bundlePicked];
  if (productIds.length < 2) return;

  const btn = el("bundle-send");
  if (btn) btn.disabled = true;
  setStatus("Sending bundle…");
  try {
    const res = await fetch(`${SOCIAL_API}/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        withAuthBody({
          buyerUserId: state.viewerId,
          sellerUserId: state.peerId,
          productIds,
          amountKes,
        })
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || "Couldn't send that bundle.", true);
      if (btn) btn.disabled = false;
      return;
    }
    closeBundleDrawer();
    setStatus("");
    await loadThread();
  } catch {
    setStatus("Couldn't send that bundle.", true);
    if (btn) btn.disabled = false;
  }
}

function wireBundle() {
  const openBtn = el("chat-bundle-btn");
  if (openBtn && openBtn.dataset.wired !== "1") {
    openBtn.dataset.wired = "1";
    openBtn.addEventListener("click", openBundleDrawer);
  }
  const drawer = el("bundle-drawer");
  if (!drawer || drawer.dataset.wired === "1") return;
  drawer.dataset.wired = "1";

  // One delegated listener: the grid is rebuilt on every pick.
  drawer.addEventListener("click", (event) => {
    if (event.target.closest("[data-bundle-close]")) return closeBundleDrawer();
    const tile = event.target.closest("[data-bundle-pick]");
    if (tile) {
      const id = tile.dataset.bundlePick;
      if (bundlePicked.has(id)) bundlePicked.delete(id);
      else if (bundlePicked.size >= MAX_BUNDLE_ITEMS) {
        setStatus(`A bundle holds up to ${MAX_BUNDLE_ITEMS} items.`, true);
        return;
      } else bundlePicked.add(id);
      renderBundlePicker();
      return;
    }
    if (event.target.closest("#bundle-send")) void sendBundle();
  });
}

/** Bundle card in the thread: a photo grid, the price, and what it saves. */
function bundleCard(msg) {
  const p = msg.payload || {};
  const items = Array.isArray(p.items) ? p.items : [];
  const mine = Number(msg.senderUserId) === state.viewerId;
  const closed = ["accepted", "declined", "expired"].includes(p.status);
  // Only the side that did not move last may respond, which is the same rule
  // the server enforces. Showing buttons that would be refused is worse than
  // showing none.
  const iMovedLast = mine;
  const myTurn = !closed && !iMovedLast;

  return `
    <div class="inbox-bundle ${mine ? "inbox-bundle-mine" : ""}" data-bundle-id="${escapeHtml(String(p.bundleId || ""))}">
      <p class="inbox-bundle-head">${escapeHtml(msg.content)}</p>
      <div class="inbox-bundle-grid">
        ${items
          .slice(0, 4)
          .map(
            (i) =>
              `<figure>${i.imageUrl ? `<img src="${escapeHtml(i.imageUrl)}" alt="" loading="lazy"/>` : ""}<figcaption>${escapeHtml(i.title || "Item")}</figcaption></figure>`
          )
          .join("")}
        ${items.length > 4 ? `<span class="inbox-bundle-more">+${items.length - 4}</span>` : ""}
      </div>
      ${
        myTurn
          ? `<div class="inbox-bundle-actions">
               <button type="button" class="inbox-bargain-cta" data-bundle-act="accepted">Accept</button>
               <button type="button" class="inbox-bargain-ghost" data-bundle-act="countered">Counter</button>
               <button type="button" class="inbox-bargain-ghost" data-bundle-act="declined">Decline</button>
             </div>`
          : `<p class="inbox-bundle-note">${closed ? "" : "Waiting for the other side."}</p>`
      }
    </div>`;
}

async function respondToBundleCard(bundleId, action) {
  let amountKes;
  if (action === "countered") {
    const raw = window.prompt("Counter with what total (KES)?");
    amountKes = Math.round(Number(raw) || 0);
    if (!amountKes) return;
  }
  setStatus("Sending…");
  try {
    const res = await fetch(`${SOCIAL_API}/bundles/${encodeURIComponent(bundleId)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withAuthBody({ userId: state.viewerId, action, amountKes })),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || "Couldn't do that.", true);
      return;
    }
    setStatus("");
    await loadThread();
  } catch {
    setStatus("Couldn't do that.", true);
  }
}

function wireBundleCards() {
  const wrap = el("chat-thread");
  if (!wrap || wrap.dataset.bundleWired === "1") return;
  wrap.dataset.bundleWired = "1";
  wrap.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-bundle-act]");
    if (!btn) return;
    const id = btn.closest("[data-bundle-id]")?.dataset.bundleId;
    if (id) void respondToBundleCard(id, btn.dataset.bundleAct);
  });
}

/* ---- Scratch cards ------------------------------------------------------ */

/**
 * A card the buyer rubs to reveal.
 *
 * The foil is a canvas the buyer erases with a finger or the mouse. It is
 * theatre, but the perk underneath is real and seller-funded, so the reveal
 * only counts once the server has stamped it -- scratching the pixels alone
 * must never be what grants a discount.
 */
function scratchCard(msg) {
  const p = msg.payload || {};
  const mine = Number(msg.senderUserId) === state.viewerId;
  const revealed = Boolean(p.revealedAt);
  const perk = p.perk || {};

  if (mine) {
    // The seller sees what they sent, with no foil to rub.
    return `
      <div class="inbox-scratch is-sent">
        <p class="inbox-scratch-head">Deal sent</p>
        <p class="inbox-scratch-perk">${escapeHtml(perk.label || "Perk")}</p>
        <p class="inbox-scratch-note">${escapeHtml(p.productTitle || "")}${
      revealed ? " · scratched" : " · not scratched yet"
    }</p>
      </div>`;
  }

  if (revealed) {
    return `
      <div class="inbox-scratch is-revealed" data-scratch-id="${escapeHtml(String(msg.id))}">
        <p class="inbox-scratch-head">You unlocked</p>
        <p class="inbox-scratch-perk">${escapeHtml(perk.label || "Perk")}</p>
        <p class="inbox-scratch-note">${escapeHtml(p.productTitle || "")}${
      p.finalKes ? ` · now ${formatKes(p.finalKes)}` : ""
    }</p>
      </div>`;
  }

  return `
    <div class="inbox-scratch" data-scratch-id="${escapeHtml(String(msg.id))}">
      <p class="inbox-scratch-head">A deal from the seller</p>
      <div class="inbox-scratch-foil" data-scratch-foil>
        <span class="inbox-scratch-hint">Scratch to reveal</span>
      </div>
      <p class="inbox-scratch-note">${escapeHtml(p.productTitle || "")}</p>
    </div>`;
}

/**
 * Turn the foil into something rubbable.
 *
 * Canvas rather than a CSS trick so the erasing follows the finger. Once
 * enough is cleared the server is asked to reveal; the pixels are only the
 * gesture.
 */
function armScratchFoil(foil, attempt = 0) {
  if (!foil || foil.dataset.armed === "1") return;

  const card = foil.closest("[data-scratch-id]");
  const id = card?.dataset.scratchId;
  if (!id) return;

  const rect = foil.getBoundingClientRect();
  // wireScratchCards runs in the same tick as the innerHTML that created this
  // element, so layout may not have happened and the box can still be 0 wide.
  // Wait a couple of frames for it -- but bounded, because a card that is
  // genuinely zero-width would otherwise retry forever and never arm at all,
  // which is worse than arming with an estimate.
  if (rect.width < 8 && attempt < 3) {
    requestAnimationFrame(() => armScratchFoil(foil, attempt + 1));
    return;
  }
  foil.dataset.armed = "1";

  const w = Math.max(1, Math.round(rect.width || card.getBoundingClientRect().width || 240));
  const h = Math.max(1, Math.round(rect.height || 56));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.className = "inbox-scratch-canvas";
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // No canvas: fall back to a plain tap, so the perk is still reachable.
    foil.addEventListener("click", () => void revealScratch(id), { once: true });
    return;
  }
  ctx.fillStyle = "#3f3f46";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  foil.appendChild(canvas);

  let rubbing = false;
  let cleared = 0;
  let done = false;
  const threshold = Math.max(12, Math.round((w * h) / 2600));

  const rub = (event) => {
    if (!rubbing || done) return;
    const box = canvas.getBoundingClientRect();
    const point = event.touches ? event.touches[0] : event;
    const x = point.clientX - box.left;
    const y = point.clientY - box.top;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    cleared += 1;
    // Roughly a third of the surface. Counting strokes rather than reading
    // pixels back: getImageData on every move is expensive on a cheap phone.
    // The floor matters as much as the ratio -- without it a small or
    // mismeasured card would open on a single touch.
    if (cleared > threshold) {
      done = true;
      canvas.classList.add("is-cleared");
      void revealScratch(id);
    }
  };

  const start = (e) => {
    rubbing = true;
    rub(e);
  };
  const stop = () => {
    rubbing = false;
  };

  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", rub);
  window.addEventListener("pointerup", stop);
  canvas.addEventListener("touchstart", start, { passive: true });
  canvas.addEventListener("touchmove", rub, { passive: true });
  canvas.addEventListener("touchend", stop);
}

async function revealScratch(messageId) {
  try {
    const res = await fetch(
      `${SOCIAL_API}/chat/scratch-card/${encodeURIComponent(messageId)}/reveal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withAuthBody({ userId: state.viewerId })),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || "Couldn't open that deal.", true);
      return;
    }
    setStatus(
      data.minutesLeft
        ? `Unlocked: ${data.perk?.label || "deal"} — ${Math.round(data.minutesLeft / 60)}h left.`
        : `Unlocked: ${data.perk?.label || "deal"}.`
    );
    await loadThread();
  } catch {
    setStatus("Couldn't open that deal.", true);
  }
}

/** Arm any foil that appears after a thread render. */
function wireScratchCards() {
  const wrap = el("chat-thread");
  if (!wrap) return;
  wrap.querySelectorAll("[data-scratch-foil]").forEach(armScratchFoil);
}

/* ---- Reactions ---------------------------------------------------------- */

/** Must match ALLOWED_REACTIONS on the server. */
const REACTIONS = ["🔥", "🤝", "👀", "❤️", "😂", "😭"];

/**
 * A short sound per reaction, generated rather than fetched.
 *
 * No audio files: a soundboard of downloads would cost bandwidth on every
 * thread open and would be the heaviest thing on the page for a half-second
 * of noise. These are a couple of oscillator notes through WebAudio, built on
 * first use and never stored.
 */
const REACTION_TONES = {
  "🔥": [660, 880],
  "🤝": [440, 587],
  "👀": [523, 523],
  "❤️": [587, 784],
  "😂": [784, 988, 784],
  "😭": [392, 294],
};

let audioCtx = null;
let soundOn = true;

function readSoundPref() {
  try {
    soundOn = localStorage.getItem("sokoni:inbox:sound") !== "off";
  } catch {
    // Private windows and blocked storage both land here. Sound on is the
    // friendlier default, and the toggle still works for this session.
    soundOn = true;
  }
}

function setSoundPref(on) {
  soundOn = Boolean(on);
  try {
    localStorage.setItem("sokoni:inbox:sound", soundOn ? "on" : "off");
  } catch {
    /* not fatal */
  }
  const btn = el("chat-sound-btn");
  if (btn) {
    btn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    btn.textContent = soundOn ? "🔈" : "🔇";
    btn.title = soundOn ? "Sound on" : "Sound off";
  }
}

/**
 * Play the note for a reaction.
 *
 * Silent unless the tap came from a real gesture -- browsers block audio
 * otherwise, and a console full of autoplay warnings helps nobody.
 */
function playReactionTone(emoji) {
  if (!soundOn) return;
  const notes = REACTION_TONES[emoji];
  if (!notes) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();

    const now = audioCtx.currentTime;
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = now + i * 0.085;
      // Short, and faded at both ends: a square edge on a phone speaker
      // clicks, which reads as a glitch rather than a sound effect.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
  } catch {
    /* audio is decoration; never let it break a tap */
  }
}

/** The reactions already on a message, as chips under the bubble. */
function reactionRow(msg) {
  const list = Array.isArray(msg.reactions) ? msg.reactions : [];
  if (!list.length) return "";
  return `
    <div class="inbox-reacts">
      ${list
        .map((r) => {
          const mine = (r.userIds || []).includes(state.viewerId);
          return `<button type="button" class="inbox-react ${mine ? "is-mine" : ""}"
                    data-react-msg="${escapeHtml(String(msg.id))}"
                    data-react-emoji="${escapeHtml(r.emoji)}"
                    aria-pressed="${mine ? "true" : "false"}">${escapeHtml(r.emoji)} ${r.count}</button>`;
        })
        .join("")}
    </div>`;
}

/** The picker, opened by double-tapping a bubble. */
function reactionPicker(messageId) {
  return `
    <div class="inbox-react-picker" data-react-picker="${escapeHtml(String(messageId))}">
      ${REACTIONS.map(
        (e) =>
          `<button type="button" class="inbox-react-opt" data-react-msg="${escapeHtml(String(messageId))}" data-react-emoji="${escapeHtml(e)}">${e}</button>`
      ).join("")}
    </div>`;
}

function closeReactionPicker() {
  document.querySelectorAll("[data-react-picker]").forEach((n) => n.remove());
}

async function toggleReaction(messageId, emoji) {
  playReactionTone(emoji);
  closeReactionPicker();
  try {
    const res = await fetch(`${SOCIAL_API}/chat/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withAuthBody({ messageId: Number(messageId), userId: state.viewerId, emoji })),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus(data?.message || "Couldn't react.", true);
      return;
    }
    await loadThread();
  } catch {
    setStatus("Couldn't react.", true);
  }
}

/**
 * Double-tap to open the picker, one tap on a chip to toggle.
 *
 * dblclick covers the mouse; on touch it does not fire reliably, so two taps
 * inside 300ms are counted by hand.
 */
function wireReactions() {
  const wrap = el("chat-thread");
  if (!wrap || wrap.dataset.reactWired === "1") return;
  wrap.dataset.reactWired = "1";

  let lastTap = 0;
  let lastTarget = null;

  const openPicker = (bubble) => {
    const id = bubble?.dataset.msgId;
    if (!id) return;
    closeReactionPicker();
    bubble.insertAdjacentHTML("beforeend", reactionPicker(id));
  };

  wrap.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-react-emoji]");
    if (chip) {
      void toggleReaction(chip.dataset.reactMsg, chip.dataset.reactEmoji);
      return;
    }
    const bubble = event.target.closest("[data-msg-id]");
    const now = Date.now();
    if (bubble && bubble === lastTarget && now - lastTap < 300) {
      lastTap = 0;
      openPicker(bubble);
      return;
    }
    lastTap = now;
    lastTarget = bubble;
    if (!bubble) closeReactionPicker();
  });

  wrap.addEventListener("dblclick", (event) => {
    const bubble = event.target.closest("[data-msg-id]");
    if (bubble) openPicker(bubble);
  });
}

function wireSoundToggle() {
  const btn = el("chat-sound-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  readSoundPref();
  setSoundPref(soundOn);
  btn.addEventListener("click", () => setSoundPref(!soundOn));
}

/* ---- Nudge -------------------------------------------------------------- */

/**
 * Shake the window when a nudge arrives.
 *
 * Only for nudges newer than the last render. Replaying every nudge in the
 * history on each thread reload would shake the page on every poll, which
 * reads as a fault rather than a feature.
 */
let lastNudgeSeen = 0;

function playNudge(messages) {
  const nudges = (Array.isArray(messages) ? messages : []).filter(
    (m) => m.kind === "nudge" && Number(m.senderUserId) !== state.viewerId
  );
  if (!nudges.length) return;
  const newest = nudges[nudges.length - 1];
  const at = new Date(newest.createdAt).getTime();
  if (!Number.isFinite(at) || at <= lastNudgeSeen) return;

  // The first render of a thread sets the baseline instead of replaying.
  const first = lastNudgeSeen === 0;
  lastNudgeSeen = at;
  if (first) return;

  const shell = document.querySelector(".inbox-shell") || document.body;
  shell.classList.remove("is-nudged");
  // Force a reflow, or re-adding the class in the same frame does not restart
  // the animation.
  void shell.offsetWidth;
  shell.classList.add("is-nudged");
  setTimeout(() => shell.classList.remove("is-nudged"), 700);
  playReactionTone("👀");
}

function nudgeCard(msg) {
  const mine = Number(msg.senderUserId) === state.viewerId;
  return `
    <div class="inbox-nudge ${mine ? "inbox-nudge-mine" : ""}">
      👋 ${mine ? "You nudged" : "Nudged you"}
    </div>`;
}

async function sendNudge() {
  const btn = el("chat-nudge-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${SOCIAL_API}/chat/nudge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        withAuthBody({ senderUserId: state.viewerId, receiverUserId: state.peerId })
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Being on cooldown is a normal answer, not a failure worth alarming
      // anyone about.
      setStatus(data?.message || "Couldn't nudge.", data?.error !== "nudge_cooldown");
      return;
    }
    setStatus("Nudged.");
    await loadThread();
  } catch {
    setStatus("Couldn't nudge.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireNudge() {
  const btn = el("chat-nudge-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", () => void sendNudge());
}

/* ---- Locked drops ------------------------------------------------------- */

function countdownLabel(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A drop card: blurred until the window opens.
 *
 * The blur is decoration, not protection -- the photo is in the payload and
 * anyone can read it. That is fine, because what the window actually gates is
 * the item being public, which the server controls. A card that pretended the
 * image was secret would be lying about something checkable.
 */
function lockedDropCard(msg) {
  const p = msg.payload || {};
  const mine = Number(msg.senderUserId) === state.viewerId;
  const left = Math.max(0, Math.round((new Date(p.unlocksAt).getTime() - Date.now()) / 1000));
  const open = left <= 0;

  return `
    <div class="inbox-drop ${open ? "is-open" : ""} ${mine ? "inbox-drop-mine" : ""}"
         data-drop-unlocks="${escapeHtml(String(p.unlocksAt || ""))}">
      <p class="inbox-drop-head">${mine ? "Drop sent" : open ? "Yours to buy" : "Early access"}</p>
      <div class="inbox-drop-art">
        ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy"/>` : ""}
        ${open ? "" : `<span class="inbox-drop-lock">🔒</span>`}
      </div>
      <p class="inbox-drop-name">${escapeHtml(p.productTitle || "Item")}</p>
      <p class="inbox-drop-meta">
        ${p.priceKes ? formatKes(p.priceKes) : ""}
        ${open ? "" : ` · unlocks in <span data-drop-timer>${countdownLabel(left)}</span>`}
      </p>
    </div>`;
}

/**
 * One timer for every drop on screen.
 *
 * A setInterval per card would leave one running behind each thread reload;
 * a single tick that reads the DOM cannot leak that way.
 */
let dropTimer = null;

function wireDropTimers() {
  if (dropTimer) clearInterval(dropTimer);
  const tick = () => {
    const cards = document.querySelectorAll("[data-drop-unlocks]");
    if (!cards.length) {
      clearInterval(dropTimer);
      dropTimer = null;
      return;
    }
    let anyOpened = false;
    cards.forEach((card) => {
      const left = Math.max(
        0,
        Math.round((new Date(card.dataset.dropUnlocks).getTime() - Date.now()) / 1000)
      );
      const label = card.querySelector("[data-drop-timer]");
      if (label) label.textContent = countdownLabel(left);
      if (left <= 0 && !card.classList.contains("is-open")) {
        card.classList.add("is-open");
        anyOpened = true;
      }
    });
    // Redraw once when something opens, so the card switches to its unlocked
    // wording rather than just losing the blur.
    if (anyOpened) void loadThread();
  };
  dropTimer = setInterval(tick, 1000);
  tick();
}

/* ---- Fit check ---------------------------------------------------------- */

/**
 * The post-sale prompt, and the shared photo once it exists.
 *
 * Declining is a normal outcome: there is no nagging, no second ask, and the
 * card simply sits there. The reward is stated before the buyer decides,
 * because a discount hinted at and then not honoured costs more trust than
 * the photo is worth.
 */
function fitCheckCard(msg) {
  const p = msg.payload || {};
  const mine = Number(msg.receiverUserId) === state.viewerId;
  const shared = Boolean(p.photoUrl);

  if (shared) {
    return `
      <div class="inbox-fit is-shared">
        <img class="inbox-fit-photo" src="${escapeHtml(p.photoUrl)}" alt="Fit check" loading="lazy"/>
        <p class="inbox-fit-note">Shared as a verified review${
          p.orderRef ? ` · ${escapeHtml(p.orderRef)}` : ""
        }</p>
        <button type="button" class="inbox-fit-share" data-fit-share="${escapeHtml(p.photoUrl)}"
                data-fit-title="${escapeHtml(p.productTitle || "")}">Share</button>
      </div>`;
  }

  if (!mine) {
    // The seller sees that it was asked, not a button they cannot press.
    return `<div class="inbox-fit is-waiting"><p class="inbox-fit-note">Buyer was invited to share a fit pic.</p></div>`;
  }

  return `
    <div class="inbox-fit" data-fit-id="${escapeHtml(String(msg.id))}">
      <p class="inbox-fit-head">📸 Fit check</p>
      <p class="inbox-fit-copy">${escapeHtml(msg.content)}</p>
      <label class="inbox-fit-pick">
        Add a photo
        <input type="file" accept="image/jpeg,image/png,image/webp" data-fit-input hidden/>
      </label>
    </div>`;
}

async function uploadFitPhoto(messageId, file) {
  if (!file) return;
  setStatus("Sharing…");
  try {
    const form = new FormData();
    form.append("photo", file, file.name || "fit.jpg");
    for (const [k, v] of Object.entries(withAuthBody({ userId: state.viewerId }) || {})) {
      if (v != null) form.append(k, String(v));
    }
    const res = await fetch(`${SOCIAL_API}/chat/fit-check/${encodeURIComponent(messageId)}`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || "Couldn't share that photo.", true);
      return;
    }
    setStatus(
      data.published
        ? `Shared. KES ${data.rewardKes} off your next order.`
        : `Shared. KES ${data.rewardKes} off your next order.`
    );
    await loadThread();
  } catch {
    setStatus("Couldn't share that photo.", true);
  }
}

/** Hand the card to the OS share sheet, or copy the link where there isn't one. */
async function shareFitCard(photoUrl, title) {
  const text = `${title || "My Sokoni find"} — bought on Sokoni Mall`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Sokoni Mall", text, url: photoUrl });
      return;
    }
    await navigator.clipboard?.writeText(`${text}\n${photoUrl}`);
    setStatus("Link copied.");
  } catch {
    // Cancelling a share sheet lands here and is not a failure.
  }
}

function wireFitCheck() {
  const wrap = el("chat-thread");
  if (!wrap || wrap.dataset.fitWired === "1") return;
  wrap.dataset.fitWired = "1";

  wrap.addEventListener("click", (event) => {
    const share = event.target.closest("[data-fit-share]");
    if (share) {
      void shareFitCard(share.dataset.fitShare, share.dataset.fitTitle);
    }
  });

  wrap.addEventListener("change", (event) => {
    const input = event.target.closest("[data-fit-input]");
    if (!input) return;
    const id = input.closest("[data-fit-id]")?.dataset.fitId;
    const file = input.files?.[0];
    if (id && file) void uploadFitPhoto(id, file);
    // Clear it, so picking the same file twice still fires a change.
    input.value = "";
  });
}

function renderIcebreakers(messages) {
  const slot = el("chat-icebreakers");
  if (!slot) return;

  // Only on a truly empty thread. Once two people are talking, a row of
  // canned questions is clutter.
  const empty = !Array.isArray(messages) || messages.length === 0;
  if (!empty || !state.viewerId || !state.peerId) {
    slot.innerHTML = "";
    slot.classList.add("hidden");
    return;
  }

  slot.innerHTML = ICEBREAKERS.map(
    (q) => `<button type="button" class="inbox-chip" data-chip="${escapeHtml(q)}">${escapeHtml(q)}</button>`
  ).join("");
  slot.classList.remove("hidden");
}

/**
 * One listener on the container rather than one per chip, so re-rendering the
 * row never leaves handlers behind.
 */
function wireIcebreakers() {
  const slot = el("chat-icebreakers");
  if (!slot || slot.dataset.wired === "1") return;
  slot.dataset.wired = "1";
  slot.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-chip]");
    if (!btn) return;
    const input = el("chat-input");
    if (!input) return;
    input.value = btn.dataset.chip || "";
    // Hide immediately: the row is about to be wrong either way, and a chip
    // that stays tappable invites a double send.
    slot.classList.add("hidden");
    const form = el("chat-form");
    if (form?.requestSubmit) form.requestSubmit();
    else void sendMessage();
  });
}

function renderMessages(messages) {
  const wrap = el("chat-thread");
  const empty = el("chat-empty");
  if (!wrap || !empty) return;

  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) {
    wrap.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  // The pinned ledger is drawn once above the thread, never inline, so it
  // stays visible while the conversation scrolls under it.
  wrap.innerHTML = list.filter((m) => !m.isPinned).map(messageBubble).join("");
  wrap.scrollTop = wrap.scrollHeight;
  wireScratchCards();
  wireDropTimers();
  wireFitCheck();
}

function renderLedger(pinned) {
  const slot = el("chat-ledger");
  if (!slot) return;
  const card = (Array.isArray(pinned) ? pinned : []).find((m) => m.kind === "deal_ledger");
  if (!card) {
    slot.innerHTML = "";
    slot.classList.add("hidden");
    return;
  }
  slot.innerHTML = ledgerCard(card);
  slot.classList.remove("hidden");
}

function isBuyerSessionAuthError(payload) {
  const code = String(payload?.error || "")
    .trim()
    .toLowerCase();
  return (
    code === "session_required" ||
    code === "session_invalid" ||
    code === "session_expired" ||
    code === "buyer_session_mismatch"
  );
}

function resolveViewerId() {
  if (state.sellerAuthRequired) {
    return parsePositiveInt(
      new URLSearchParams(window.location.search).get("viewer") ||
        new URLSearchParams(window.location.search).get("viewerUserId")
    );
  }
  const sessionUserId = window.SokoniBuyerAuth?.readSession?.()?.userId;
  if (Number.isInteger(sessionUserId) && sessionUserId > 0) return sessionUserId;
  return parsePositiveInt(
    new URLSearchParams(window.location.search).get("viewer") ||
      new URLSearchParams(window.location.search).get("viewerUserId")
  );
}

function offerStatusClass(status) {
  if (status === "accepted") return "bg-emerald-500/10 text-emerald-400";
  if (status === "declined") return "bg-[#FF2300]/10 text-[#FF2300]";
  if (status === "expired") return "bg-zinc-800 text-zinc-400";
  return "bg-zinc-900 text-zinc-200";
}

function offerEscrowSummary(offer) {
  const b = offer?.breakdown;
  if (!b || b.totalKes == null || b.sellerNetKes == null) return "";
  return `<p class="text-[11px] text-zinc-400 mt-1">Buyer pays ${escapeHtml(formatKes(b.totalKes))} into escrow · seller gets ${escapeHtml(formatKes(b.sellerNetKes))} (fee ${escapeHtml(formatKes(b.platformFeeKes))}) · seller handles dispatch</p>`;
}

function offerCard(offer) {
  const id = Number(offer?.id);
  const status = String(offer?.status || "pending").toLowerCase();
  const title = escapeHtml(offer?.product?.title || offer?.productId || "Listing");
  const amount = formatKes(offer?.amountKsh);
  const listed = formatKes(offer?.product?.priceKsh);
  const isSeller = Number(offer?.sellerUserId) === state.viewerId;
  const isBuyer = Number(offer?.buyerUserId) === state.viewerId;
  const payTotal = formatKes(offer?.breakdown?.totalKes ?? offer?.amountKsh);

  let actions = "";
  if (isSeller && status === "pending" && Number.isInteger(id)) {
    actions = `<div class="mt-3 flex flex-wrap gap-2">
      <button type="button" class="inbox-offer-respond inbox-bargain-cta" data-offer-id="${id}" data-action="accepted">Accept bargain</button>
      <button type="button" class="inbox-offer-respond inbox-bargain-ghost" data-offer-id="${id}" data-action="countered" data-offer-amount="${escapeHtml(String(offer?.amountKsh || ""))}" data-list-price="${escapeHtml(String(offer?.product?.priceKsh || ""))}">Counter</button>
      <button type="button" class="inbox-offer-respond inbox-bargain-ghost" data-offer-id="${id}" data-action="declined">Decline</button>
    </div>`;
  } else if (isBuyer && status === "accepted" && Number.isInteger(id)) {
    actions = `<div class="mt-3">
      <a href="checkout.html?offerId=${id}" class="inbox-bargain-cta">Checkout at ${escapeHtml(payTotal)}</a>
    </div>`;
  }

  return `<article class="inbox-bargain-card">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">Bargain offer · buyer total</p>
        <p class="text-sm font-semibold mt-0.5 text-white">${title}</p>
      </div>
      <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded ${offerStatusClass(status)}">${escapeHtml(status)}</span>
    </div>
    <p class="text-xl font-black font-mono mt-2 text-white">${escapeHtml(amount)}</p>
    ${listed ? `<p class="text-[11px] text-zinc-500 line-through">Was ${escapeHtml(listed)}</p>` : ""}
    ${offerEscrowSummary(offer)}
    ${actions}
  </article>`;
}

function renderOffers(offers) {
  const wrap = el("inbox-offers");
  if (!wrap) return;
  state.offers = Array.isArray(offers) ? offers : [];
  if (!state.offers.length) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = state.offers.map(offerCard).join("");
  wrap.querySelectorAll(".inbox-offer-respond").forEach((btn) => {
    btn.addEventListener("click", () => respondToOffer(btn.dataset.offerId, btn.dataset.action, btn));
  });
}

function syncMakeOfferButton() {
  const btn = el("inbox-make-offer-btn");
  if (!btn) return;
  const canOffer = !state.sellerAuthRequired && Boolean(state.productId) && Boolean(state.viewerId);
  btn.classList.toggle("hidden", !canOffer);
}

async function loadOffers() {
  if (!state.viewerId || !state.peerId) return;
  try {
    const params = authQueryParams(
      new URLSearchParams({
        userAId: String(state.viewerId),
        userBId: String(state.peerId),
        limit: "12",
      })
    );
    const res = await fetch(`${SOCIAL_API}/chat/offers?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    renderOffers(data.offers || []);
    if (!state.productId) {
      const firstProduct = (data.offers || []).find((o) => o?.productId)?.productId;
      if (firstProduct) {
        state.productId = String(firstProduct);
        syncMakeOfferButton();
      }
    }
  } catch {
    /* offers are optional beside chat */
  }
}

async function loadThread() {
  if (!state.viewerId || !state.peerId) return;
  try {
    const params = authQueryParams(
      new URLSearchParams({
        userAId: String(state.viewerId),
        userBId: String(state.peerId),
        limit: "80",
      })
    );
    const res = await fetch(`${SOCIAL_API}/chat/thread?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && isSellerSessionAuthError(data)) {
        setStatus(data?.message || "Seller session imeexpire - rudi dashboard uverify tena.", true);
        return;
      }
      if (isBuyerSessionAuthError(data)) {
        setStatus(data?.message || "Verify your WhatsApp above to open this chat.", true);
        return;
      }
      setStatus(data?.message || data?.error || "Could not load inbox thread.", true);
      return;
    }
    renderMessages(data.messages || []);
    renderLedger(data.pinned || []);
    renderIcebreakers(data.messages || []);
    playNudge(data.messages || []);
    void loadOffers();
  } catch {
    setStatus("Could not load chat right now. Check your connection.", true);
  }
}

async function sendMessage(text) {
  const body = String(text || "").trim();
  if (!body || !state.viewerId || !state.peerId) return;

  const btn = el("chat-send-btn");
  if (btn) btn.disabled = true;
  try {
    const payload = withAuthBody({
      senderUserId: state.viewerId,
      receiverUserId: state.peerId,
      content: body,
    });
    const res = await fetch(`${SOCIAL_API}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && isSellerSessionAuthError(data)) {
        setStatus(data?.message || "Seller session imeexpire - rudi dashboard uverify tena.", true);
        return;
      }
      if (isBuyerSessionAuthError(data)) {
        setStatus(data?.message || "Verify your WhatsApp above to send messages.", true);
        return;
      }
      setStatus(data?.message || data?.error || "Message not sent.", true);
      return;
    }
    setStatus("");
    await loadThread();
  } catch {
    setStatus("Could not send message right now.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function respondToOffer(offerId, action, button) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return;
  if (!state.sellerAuthRequired || !state.sellerSession) {
    setStatus("Open this chat from the seller dashboard to accept offers.", true);
    return;
  }
  let counterAmountKsh = null;
  if (action === "countered") {
    const offer = state.offers.find((o) => Number(o?.id) === id);
    const buyerOffer = Math.round(
      Number(button?.dataset?.offerAmount || offer?.amountKsh) || 0
    );
    const listPrice = Math.round(
      Number(button?.dataset?.listPrice || offer?.product?.priceKsh) || 0
    );
    const suggested =
      listPrice > buyerOffer + 1
        ? Math.round((buyerOffer + listPrice) / 2)
        : buyerOffer + 100;
    const raw = window.prompt(
      `Counter offer (buyer all-in KES).\nBuyer offered ${buyerOffer > 0 ? formatKes(buyerOffer) : "—"}${
        listPrice > 0 ? ` · Listed ${formatKes(listPrice)}` : ""
      }`,
      String(suggested)
    );
    if (raw == null) return;
    counterAmountKsh = Math.round(Number(String(raw).replace(/[^\d.]/g, "")));
    if (!Number.isFinite(counterAmountKsh) || counterAmountKsh < 1) {
      setStatus("Enter a valid counter amount in KES.", true);
      return;
    }
    if (buyerOffer > 0 && counterAmountKsh <= buyerOffer) {
      setStatus("Counter must be higher than the buyer's offer.", true);
      return;
    }
    const ok = window.confirm(
      `Lock counter at ${formatKes(counterAmountKsh)}? Buyer can checkout for 24 hours.`
    );
    if (!ok) return;
  } else if (action === "accepted") {
    const offer = state.offers.find((o) => Number(o?.id) === id);
    const b = offer?.breakdown;
    if (b?.sellerNetKes != null) {
      const ok = window.confirm(
        `Buyer pays ${formatKes(b.totalKes)} into escrow.\n` +
          `You receive ${formatKes(b.sellerNetKes)} after delivery` +
          ` (Sokoni fee ${formatKes(b.platformFeeKes)}; you arrange dispatch).\n\nAccept this offer?`
      );
      if (!ok) return;
    }
  }
  try {
    const payload = withAuthBody({
      sellerUserId: state.viewerId,
      action,
    });
    if (action === "countered") payload.amountKsh = counterAmountKsh;
    const res = await fetch(`${SOCIAL_API}/offers/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || data?.error || "Could not update offer.", true);
      return;
    }
    const net = data.breakdown?.sellerNetKes ?? data.offer?.breakdown?.sellerNetKes;
    const counterAmt = data.offer?.amountKsh;
    setStatus(
      action === "accepted"
        ? net != null
          ? `Offer accepted — you receive ${formatKes(net)} after delivery (buyer pays into escrow).`
          : "Offer accepted — buyer can pay on-site into escrow."
        : action === "countered"
          ? net != null
            ? `Counter locked at ${formatKes(counterAmt)} — you receive ${formatKes(net)} after delivery.`
            : `Counter sent${counterAmt != null ? ` at ${formatKes(counterAmt)}` : ""}.`
          : "Offer declined."
    );
    await loadOffers();
  } catch {
    setStatus("Could not update offer right now.", true);
  }
}

async function sendInboxOffer() {
  const statusNode = el("inbox-offer-composer-status");
  const amount = Number(el("inbox-offer-amount")?.value);
  if (!state.productId) {
    if (statusNode) statusNode.textContent = "Open this chat from a listing to send an offer.";
    return;
  }
  if (!Number.isFinite(amount) || amount < 1) {
    if (statusNode) statusNode.textContent = "Enter a valid offer amount in KES.";
    return;
  }
  if (statusNode) statusNode.textContent = "Sending offer…";
  try {
    const payload = withAuthBody({
      productId: state.productId,
      buyerUserId: state.viewerId,
      sellerUserId: state.peerId,
      amountKsh: Math.round(amount),
    });
    const res = await fetch(`${SOCIAL_API}/offers/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (statusNode) statusNode.textContent = data?.message || data?.error || "Could not send offer.";
      return;
    }
    const b = data.breakdown || data.offer?.breakdown;
    if (statusNode) {
      statusNode.textContent =
        b?.sellerNetKes != null
          ? `Offer sent — you pay ${formatKes(b.totalKes)}, seller gets ${formatKes(b.sellerNetKes)} after delivery.`
          : "Offer sent — waiting for the seller.";
    }
    const amountInput = el("inbox-offer-amount");
    if (amountInput) amountInput.value = "";
    el("inbox-offer-composer")?.classList.add("hidden");
    await loadOffers();
  } catch {
    if (statusNode) statusNode.textContent = "Network error while sending offer.";
  }
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  state.peerId = parsePositiveInt(params.get("with") || params.get("peer") || params.get("receiver"));
  state.peerHandle = normalizeHandle(params.get("handle") || "");
  state.productId = String(params.get("product") || params.get("productId") || "").trim();
  state.sellerAuthRequired = isSellerAuthQueryFlag(params.get("sellerAuth"));
  if (state.sellerAuthRequired) {
    // Prefer live storage; fall back to deep-link token from the seller dashboard.
    state.sellerSession = readSellerSessionFromStorage() || readSellerSessionFromQuery(params);
    if (state.sellerSession?.phone && state.sellerSession?.sessionToken) {
      persistSellerSession(state.sellerSession);
      // Drop token from the address bar so it isn't left in history.
      if (params.has("sessionToken") || params.has("phone")) {
        params.delete("sessionToken");
        params.delete("phone");
        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
        try {
          window.history.replaceState({}, "", next);
        } catch {}
      }
    }
  } else {
    state.sellerSession = null;
  }
  state.viewerId = resolveViewerId();
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    loadThread();
  }, 7000);
}

function hideBuyerAuthPanel() {
  el("buyer-auth-panel")?.classList.add("hidden");
}

async function resolvePeerFromHandle() {
  if (state.peerId || !state.peerHandle) return state.peerId;
  try {
    const res = await fetch(`${SOCIAL_API}/shop/${encodeURIComponent(state.peerHandle)}?limit=1`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const userId = parsePositiveInt(data?.shop?.userId);
    if (userId) {
      state.peerId = userId;
      setPeerLabel();
    }
    return userId;
  } catch {
    return null;
  }
}

function init() {
  parseQuery();
  setPeerLabel();
  syncMakeOfferButton();
  window.SokoniRecentlyViewed?.renderCarousel?.("inbox-recently-viewed", {
    onSelect: ({ id, handle, sellerUserId }) => {
      const params = new URLSearchParams();
      if (id) params.set("product", id);
      if (handle) params.set("handle", handle);
      if (sellerUserId) params.set("with", String(sellerUserId));
      if (handle || sellerUserId) {
        window.location.href = `inbox.html?${params.toString()}`;
        return;
      }
      window.location.href = `index.html?q=${encodeURIComponent(id || "")}`;
    },
  });

  if (state.sellerAuthRequired) {
    hideBuyerAuthPanel();
  } else {
    window.SokoniBuyerAuth?.bindPanel?.({
      onVerified: () => {
        state.viewerId = resolveViewerId();
        setPeerLabel();
        syncMakeOfferButton();
        void resolvePeerFromHandle().then(() => {
          if (beginChatIfReady()) {
            setStatus("WhatsApp verified — you can chat now.");
          }
        });
      },
    });
  }

  const form = el("chat-form");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = el("chat-input");
    const text = input?.value || "";
    if (!text.trim()) return;
    input.value = "";
    await sendMessage(text);
  });

  el("inbox-make-offer-btn")?.addEventListener("click", () => {
    el("inbox-offer-composer")?.classList.toggle("hidden");
  });
  el("inbox-offer-send-btn")?.addEventListener("click", () => {
    void sendInboxOffer();
  });

  void (async () => {
    if (!state.peerId && state.peerHandle) {
      setStatus("Loading shop…");
      await resolvePeerFromHandle();
    }
    const ready = beginChatIfReady();
    if (!ready && !(state.peerId || state.peerHandle)) {
      void loadAvailableShops();
    }
  })();
}

document.addEventListener("DOMContentLoaded", init);
