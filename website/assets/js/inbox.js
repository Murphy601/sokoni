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
    const raw = sessionStorage.getItem(SELLER_VERIFY_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = String(parsed?.token || "").trim();
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const phone = normalizePhoneInput(parsed?.phone || localStorage.getItem(SELLER_PHONE_KEY) || "");
    if (!phone) return null;
    return { phone, sessionToken: token };
  } catch {
    return null;
  }
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
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(msg));
}

function setPeerLabel() {
  const label = el("chat-peer-label");
  if (!label) return;
  const handle = formatHandle(state.peerHandle);
  label.textContent = handle || `User #${state.peerId || "?"}`;
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

function messageBubble(msg) {
  const mine = Number(msg.senderUserId) === state.viewerId;
  const wrapper = mine ? "items-end" : "items-start";
  const bubble = mine
    ? "bg-brand-green text-brand-purple rounded-2xl rounded-br-sm"
    : "bg-white dark:bg-brand-purpleLight/55 text-brand-purple dark:text-white rounded-2xl rounded-bl-sm border border-black/5 dark:border-white/10";
  const who = mine ? "You" : formatHandle(state.peerHandle) || `User #${state.peerId}`;

  return `
    <div class="flex flex-col ${wrapper} gap-1">
      <p class="text-[11px] text-brand-purple/50 dark:text-white/55">${who}</p>
      <div class="max-w-[85%] px-3 py-2 text-sm leading-relaxed ${bubble}">
        ${escapeHtml(msg.content)}
      </div>
      <p class="text-[10px] text-brand-purple/45 dark:text-white/45">${formatTime(msg.createdAt)}</p>
    </div>`;
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
  if (status === "accepted") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "declined") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "expired") return "bg-black/5 text-brand-purple/55 dark:bg-white/10 dark:text-white/55";
  return "bg-brand-purple/5 text-brand-purple dark:bg-white/10 dark:text-white";
}

function offerEscrowSummary(offer) {
  const b = offer?.breakdown;
  if (!b || b.totalKes == null || b.sellerNetKes == null) return "";
  const ship =
    b.freeShipping || !b.shippingKes
      ? "shipping free"
      : `shipping ${formatKes(b.shippingKes)}`;
  return `<p class="text-[11px] text-brand-purple/65 dark:text-white/65 mt-1">Buyer pays ${escapeHtml(formatKes(b.totalKes))} into escrow · seller gets ${escapeHtml(formatKes(b.sellerNetKes))} (${escapeHtml(ship)} + fee ${escapeHtml(formatKes(b.platformFeeKes))})</p>`;
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
      <button type="button" class="inbox-offer-respond min-h-[40px] px-3 rounded-full bg-brand-green text-brand-purple text-xs font-bold" data-offer-id="${id}" data-action="accepted">Accept</button>
      <button type="button" class="inbox-offer-respond min-h-[40px] px-3 rounded-full border border-black/10 dark:border-white/20 text-xs font-semibold" data-offer-id="${id}" data-action="declined">Decline</button>
    </div>`;
  } else if (isBuyer && status === "accepted" && Number.isInteger(id)) {
    actions = `<div class="mt-3">
      <a href="checkout.html?offerId=${id}" class="inline-flex min-h-[40px] items-center px-4 rounded-full bg-brand-green text-brand-purple text-xs font-bold">Pay ${escapeHtml(payTotal)} on Sokoni</a>
    </div>`;
  }

  return `<article class="rounded-2xl border border-black/5 dark:border-white/10 bg-brand-cream/60 dark:bg-brand-purple/40 px-4 py-3">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-[10px] uppercase tracking-wide text-brand-purple/50 dark:text-white/50 font-semibold">Bargain offer · buyer total</p>
        <p class="text-sm font-semibold mt-0.5">${title}</p>
      </div>
      <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded ${offerStatusClass(status)}">${escapeHtml(status)}</span>
    </div>
    <p class="text-xl font-bold mt-2">${escapeHtml(amount)}</p>
    ${listed ? `<p class="text-[11px] text-brand-purple/50 dark:text-white/50 line-through">Was ${escapeHtml(listed)}</p>` : ""}
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
    btn.addEventListener("click", () => respondToOffer(btn.dataset.offerId, btn.dataset.action));
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

async function respondToOffer(offerId, action) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return;
  if (!state.sellerAuthRequired || !state.sellerSession) {
    setStatus("Open this chat from the seller dashboard to accept offers.", true);
    return;
  }
  if (action === "accepted") {
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
    const res = await fetch(`${SOCIAL_API}/offers/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        withAuthBody({
          sellerUserId: state.viewerId,
          action,
        })
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || data?.error || "Could not update offer.", true);
      return;
    }
    const net = data.breakdown?.sellerNetKes ?? data.offer?.breakdown?.sellerNetKes;
    setStatus(
      action === "accepted"
        ? net != null
          ? `Offer accepted — you receive ${formatKes(net)} after delivery (buyer pays into escrow).`
          : "Offer accepted — buyer can pay on-site into escrow."
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
  state.sellerSession = state.sellerAuthRequired ? readSellerSessionFromStorage() : null;
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

function init() {
  parseQuery();
  setPeerLabel();
  syncMakeOfferButton();

  if (state.sellerAuthRequired) {
    hideBuyerAuthPanel();
  } else {
    window.SokoniBuyerAuth?.bindPanel?.({
      onVerified: () => {
        state.viewerId = resolveViewerId();
        setPeerLabel();
        syncMakeOfferButton();
        if (state.viewerId && state.peerId && state.viewerId !== state.peerId) {
          setStatus("WhatsApp verified — you can chat now.");
          loadThread();
          startPolling();
        }
      },
    });
  }

  if (!state.viewerId || !state.peerId || state.viewerId === state.peerId) {
    setStatus(
      state.sellerAuthRequired
        ? "Open this page from a shop profile with valid viewer and seller IDs."
        : "Verify your WhatsApp above, or open this page from a shop with a valid seller ID.",
      true
    );
    disableChatComposer();
    return;
  }

  if (state.sellerAuthRequired && (!state.sellerSession?.phone || !state.sellerSession?.sessionToken)) {
    setStatus("Seller session missing - rudi seller dashboard uverify WhatsApp tena.", true);
    disableChatComposer();
    return;
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

  loadThread();
  startPolling();
}

document.addEventListener("DOMContentLoaded", init);
