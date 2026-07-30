const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const SOCIAL_API = `${API_BASE}/api/social`;
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
    empty.innerHTML = `You're signed in. Tap a <strong class="text-white">recently viewed</strong> fit above, or open a shop and hit Message — then this thread unlocks.
      <span class="block mt-2"><a href="index.html#deals" class="text-[#FF2300] font-semibold hover:underline">Browse fits</a>
      · <a href="activity.html" class="text-[#FF2300] font-semibold hover:underline">Open activity</a></span>`;
  } else {
    empty.innerHTML = `Verify WhatsApp above, then open a shop (or tap a recently viewed fit) to start chatting.`;
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
    return false;
  }

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

function messageBubble(msg) {
  const mine = Number(msg.senderUserId) === state.viewerId;
  const wrapper = mine ? "items-end" : "items-start";
  const bubble = mine ? "inbox-bubble-mine" : "inbox-bubble-theirs";
  const who = mine ? "You" : formatHandle(state.peerHandle) || `User #${state.peerId}`;

  return `
    <div class="flex flex-col ${wrapper} gap-1">
      <p class="text-[11px] text-zinc-500">${who}</p>
      <div class="max-w-[85%] px-3 py-2 text-sm leading-relaxed ${bubble}">
        ${escapeHtml(msg.content)}
      </div>
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
  wrap.innerHTML = list.map(messageBubble).join("");
  wrap.scrollTop = wrap.scrollHeight;
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
  const ship =
    b.freeShipping || !b.shippingKes
      ? "shipping free"
      : `shipping ${formatKes(b.shippingKes)}`;
  return `<p class="text-[11px] text-zinc-400 mt-1">Buyer pays ${escapeHtml(formatKes(b.totalKes))} into escrow · seller gets ${escapeHtml(formatKes(b.sellerNetKes))} (${escapeHtml(ship)} + fee ${escapeHtml(formatKes(b.platformFeeKes))})</p>`;
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
          ` (shipping ${b.freeShipping || !b.shippingKes ? "free" : formatKes(b.shippingKes)},` +
          ` Sokoni fee ${formatKes(b.platformFeeKes)}).\n\nAccept this offer?`
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
    beginChatIfReady();
  })();
}

document.addEventListener("DOMContentLoaded", init);
